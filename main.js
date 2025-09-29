// main.js
document.addEventListener('DOMContentLoaded', () => {
  /* =========================
   * CONFIG
   * ======================= */
  const SHEET_ENDPOINT   = "https://script.google.com/macros/s/AKfycbw-lyhe7RCJX-G6hegkB5ud9oJXxD8qrWhwH76zNJ5tZlZ2QoImt2t4UqWvuyeYd6f-WA/exec";
  const MAX_EXPORT_WIDTH = 900;           // max signature export width (px)
  const EXPORT_MIME      = "image/png";   // PNG so GAS data-URL fallback matches server regex
  const EXPORT_QUALITY   = 0.92;          // used if JPEG; harmless for PNG
  const QUEUE_KEY        = "nb2025_queue";

  /* =========================
   * DOM
   * ======================= */
  const form        = document.getElementById("regForm");
  const statusEl    = document.getElementById("formStatus");
  const retryBtn    = document.getElementById("retryBtn");

  const ageAdult    = form.querySelector('input[name="ageType"][value="adult"]');
  const ageMinor    = form.querySelector('input[name="ageType"][value="minor"]');
  const guardianFS  = document.getElementById("guardianFields");
  const guardInputs = guardianFS.querySelectorAll('input[name="guardName"], input[name="guardDate"]');

  const waiverBox   = document.getElementById('waiverText');
  const waiverAgree = document.getElementById('waiverAgree');

  // Hidden inputs + optional preview imgs
  const participantHidden = document.getElementById('participantSignature');
  const guardianHidden    = document.getElementById('guardianSignature');

  const pCanvas   = document.getElementById('participantSig');
  const pUndo     = document.getElementById('participantUndo');
  const pClear    = document.getElementById('participantClear');
  const pPrevWrap = document.getElementById('sigPreviewWrap');
  const pPrevImg  = document.getElementById('participantPreview');

  const gCanvas   = document.getElementById('guardianSig');
  const gUndo     = document.getElementById('guardianUndo');
  const gClear    = document.getElementById('guardianClear');
  const gPrevWrap = document.getElementById('guardPreviewWrap');
  const gPrevImg  = document.getElementById('guardianPreview');

  /* =========================
   * Utils
   * ======================= */
  function formatPhone(el) {
    let v = el.value.replace(/\D/g,'').slice(0,10);
    if (v.length >= 7) el.value = `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
    else if (v.length >= 4) el.value = `(${v.slice(0,3)}) ${v.slice(3)}`;
    else if (v.length >= 1) el.value = `(${v}`;
    else el.value = '';
  }
  ['phone','ecPhone'].forEach(name=>{
    const el = form.querySelector(`input[name="${name}"]`);
    if (!el) return;
    el.addEventListener('input', ()=>formatPhone(el));
    el.addEventListener('blur',  ()=>formatPhone(el));
  });

  function validatePrograms() {
    const any = form.querySelectorAll('input[name="programs"]:checked').length > 0;
    if (!any) {
      statusEl.className = "status warn";
      statusEl.textContent = "Please select at least one program.";
    }
    return any;
  }

  function enqueue(entry){
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    q.push(entry);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }
  function dequeueAll(){
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    localStorage.removeItem(QUEUE_KEY);
    return q;
  }
  function hasQueue(){ return (JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]").length > 0); }
  function showRetryIfNeeded(){
    retryBtn.style.display = hasQueue() ? "inline-block" : "none";
    if (hasQueue()) {
      const n = JSON.parse(localStorage.getItem(QUEUE_KEY)).length;
      retryBtn.textContent = `Retry Pending (${n})`;
    }
  }
  function fdToObj(fd){
    const obj={};
    fd.forEach((v,k)=>{ if (obj[k]) { Array.isArray(obj[k]) ? obj[k].push(v) : obj[k] = [obj[k], v]; } else obj[k]=v; });
    return obj;
  }

  // Post with timeout (prevents stuck "Submitting…")
  async function postWithRetry(fd, tries = 0){
    const max = 3;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try{
      await fetch(SHEET_ENDPOINT, { method: "POST", body: fd, mode: "no-cors", signal: controller.signal });
      clearTimeout(timeoutId);
      return { ok: true };
    }catch(e){
      clearTimeout(timeoutId);
      if (tries >= max) throw e;
      await new Promise(r=>setTimeout(r, 800 * (2 ** tries)));
      return postWithRetry(fd, tries+1);
    }
  }

  function dataUrlToBlob(dataUrl){
    const m = String(dataUrl).match(/^data:(.+?);base64,(.*)$/);
    if (!m) return null;
    const mime = m[1];
    const bin  = atob(m[2]);
    const len  = bin.length;
    const arr  = new Uint8Array(len);
    for (let i=0;i<len;i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* =========================
   * Signature Pad
   * ======================= */
  class ProSignaturePad {
    constructor(canvas, onChange) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onChange = onChange || (()=>{});
      this.strokes = [];
      this.current = null;
      this.baseWidth = 2;
      this.bg = '#ffffff';
      this.ink = '#111827';
      this._resize = this._resize.bind(this);
      this._attach();
      this._resize();
    }
    _attach(){
      window.addEventListener('resize', this._resize);
      const c = this.canvas;
      c.addEventListener('pointerdown', e=>{
        e.preventDefault(); c.setPointerCapture(e.pointerId);
        const pt = this._pos(e);
        this.current = [pt];
      });
      c.addEventListener('pointermove', e=>{
        if (!this.current) return;
        const pt = this._pos(e);
        this.current.push(pt);
        this._redraw();
        this.onChange(false);
      });
      const end = ()=>{
        if (this.current && this.current.length>0) this.strokes.push(this.current);
        this.current = null;
        this.onChange(this.isEmpty());
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointerleave', end);
      c.addEventListener('pointercancel', end);
    }
    _pos(e){
      const r = this.canvas.getBoundingClientRect();
      const p = (typeof e.pressure === 'number' && e.pressure>0) ? e.pressure : 0.5;
      return { x: e.clientX - r.left, y: e.clientY - r.top, p };
    }
    _resize(){
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width  = Math.round(rect.width * ratio);
      this.canvas.height = Math.round(rect.height * ratio);
      this.ctx.setTransform(ratio,0,0,ratio,0,0);
      this._paintBg();
      this._redraw(true);
    }
    _paintBg(){
      this.ctx.save();
      this.ctx.fillStyle = this.bg;
      this.ctx.fillRect(0,0,this.canvas.width, this.canvas.height);
      this.ctx.restore();
    }
    _drawStroke(points){
      if (points.length<2) {
        const p = points[0];
        this.ctx.beginPath();
        this.ctx.fillStyle = this.ink;
        this.ctx.arc(p.x, p.y, this.baseWidth, 0, Math.PI*2);
        this.ctx.fill(); this.ctx.closePath();
        return;
      }
      this.ctx.strokeStyle = this.ink;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      const mid = (a,b)=>({x:(a.x+b.x)/2, y:(a.y+b.y)/2, p:(a.p+b.p)/2});
      let prev = points[0], mPrev = prev;
      for (let i=1; i<points.length; i++){
        const curr = points[i];
        const mCurr = mid(prev, curr);
        const w = this.baseWidth * (0.65 + (curr.p||0.5));
        this.ctx.lineWidth = Math.max(1.2, Math.min(5, w));
        this.ctx.beginPath();
        this.ctx.moveTo(mPrev.x, mPrev.y);
        this.ctx.quadraticCurveTo(prev.x, prev.y, mCurr.x, mCurr.y);
        this.ctx.stroke();
        this.ctx.closePath();
        mPrev = mCurr;
        prev = curr;
      }
    }
    _redraw(clear=false){
      if (clear) this._paintBg(); else this._paintBg();
      for (const s of this.strokes) this._drawStroke(s);
      if (this.current) this._drawStroke(this.current);
    }
    clear(){
      this.strokes = [];
      this.current = null;
      this._paintBg();
      this.onChange(true);
    }
    undo(){
      this.strokes.pop();
      this._redraw(true);
      this.onChange(this.strokes.length===0);
    }
    isEmpty(){ return this.strokes.length===0 && (!this.current || this.current.length===0); }
    _exportScaled(mime=EXPORT_MIME, quality=EXPORT_QUALITY){
      const rect = this.canvas.getBoundingClientRect();
      const scale = Math.min(1, MAX_EXPORT_WIDTH / rect.width);
      const outW = Math.round(rect.width * scale);
      const outH = Math.round(rect.height * scale);
      const off = document.createElement('canvas');
      off.width = outW; off.height = outH;
      const octx = off.getContext('2d');
      octx.fillStyle = '#fff'; octx.fillRect(0,0,outW,outH);
      const s = scale;
      octx.lineCap = 'round'; octx.lineJoin = 'round'; octx.strokeStyle = this.ink;
      const drawScaled = (pts)=>{
        if (pts.length<2){
          const p = pts[0]; octx.beginPath(); octx.arc(p.x*s, p.y*s, this.baseWidth*s, 0, Math.PI*2); octx.fill(); octx.closePath(); return;
        }
        const mid=(a,b)=>({x:(a.x+b.x)/2, y:(a.y+b.y)/2, p:(a.p+b.p)/2});
        let prev=pts[0], mPrev=prev;
        for (let i=1; i<pts.length; i++){
          const curr=pts[i], mCurr=mid(prev,curr);
          const w = this.baseWidth*(0.65 + (curr.p||0.5));
          octx.lineWidth = Math.max(1, Math.min(5, w))*s;
          octx.beginPath();
          octx.moveTo(mPrev.x*s, mPrev.y*s);
          octx.quadraticCurveTo(prev.x*s, prev.y*s, mCurr.x*s, mCurr.y*s);
          octx.stroke(); octx.closePath();
          mPrev=mCurr; prev=curr;
        }
      };
      for (const stroke of this.strokes) drawScaled(stroke);
      if (this.current) drawScaled(this.current);
      return off.toDataURL(mime, quality);
    }
    toDataURL(){ return this._exportScaled(); }
  }

  /* =========================
   * Signature previews
   * ======================= */
  function refreshSignaturePreviews() {
    if (pPrevWrap && pPrevImg) {
      if (participantHidden && participantHidden.value) {
        pPrevImg.src = participantHidden.value;
        pPrevWrap.style.display = 'block';
      } else {
        pPrevWrap.style.display = 'none';
        pPrevImg.removeAttribute('src');
      }
    }
    if (gPrevWrap && gPrevImg) {
      const guardianVisible = guardianFS.style.display !== 'none';
      if (guardianVisible && guardianHidden && guardianHidden.value) {
        gPrevImg.src = guardianHidden.value;
        gPrevWrap.style.display = 'block';
      } else {
        gPrevWrap.style.display = 'none';
        gPrevImg.removeAttribute('src');
      }
    }
  }

  /* =========================
   * Pad wiring
   * ======================= */
  function setParticipantSigFromPad(pad){
    if (pad && !pad.isEmpty()) {
      // keep a PNG dataURL fallback in the hidden input
      participantHidden.value = pad._exportScaled("image/png", 0.92);
      refreshSignaturePreviews();
    }
  }
  function setGuardianSigFromPad(pad){
    if (pad && !pad.isEmpty()) {
      guardianHidden.value = pad._exportScaled("image/png", 0.92);
      refreshSignaturePreviews();
    }
  }

  const participantPad = new ProSignaturePad(pCanvas, ()=>{});
  pCanvas.addEventListener('pointerup', ()=> setParticipantSigFromPad(participantPad));
  pUndo.addEventListener('click', ()=>{ participantPad.undo(); setParticipantSigFromPad(participantPad); });
  pClear.addEventListener('click', ()=>{
    participantPad.clear();
    participantHidden.value = '';
    refreshSignaturePreviews();
  });

  let guardianPad = null;
  if (gCanvas) {
    guardianPad = new ProSignaturePad(gCanvas, ()=>{});
    gCanvas.addEventListener('pointerup', ()=> setGuardianSigFromPad(guardianPad));
    gUndo.addEventListener('click', ()=>{ guardianPad.undo(); setGuardianSigFromPad(guardianPad); });
    gClear.addEventListener('click', ()=>{
      guardianPad.clear();
      guardianHidden.value = '';
      refreshSignaturePreviews();
    });
  }

  /* =========================
   * Guardian toggle
   * ======================= */
  function toggleGuardian() {
    if (ageMinor.checked) {
      guardianFS.style.display = "block";
      guardInputs.forEach(i => i.required = true);
      if (guardianHidden) guardianHidden.required = true;
    } else {
      guardianFS.style.display = "none";
      guardInputs.forEach(i => i.required = false);
      if (guardianHidden) guardianHidden.required = false;
    }
    refreshSignaturePreviews();
  }
  ageAdult.addEventListener("change", toggleGuardian);
  ageMinor.addEventListener("change", toggleGuardian);
  toggleGuardian();

  /* =========================
   * Waiver scroll-to-enable
   * ======================= */
  function checkWaiverScrolled() {
    const sentinel = document.getElementById('waiverSentinel');
    const atBottom = sentinel
      ? (sentinel.getBoundingClientRect().top <= waiverBox.getBoundingClientRect().bottom)
      : (waiverBox.scrollTop + waiverBox.clientHeight >= waiverBox.scrollHeight - 4);
    if (atBottom) waiverAgree.disabled = false;
  }
  waiverBox.addEventListener('scroll', checkWaiverScrolled);
  window.addEventListener('load', checkWaiverScrolled);

  /* =========================
   * Export to Blob for upload
   * ======================= */
  function sigPadToBlob(pad, mime = EXPORT_MIME, quality = EXPORT_QUALITY, maxW = MAX_EXPORT_WIDTH){
    return new Promise(resolve => {
      const rect = pad.canvas.getBoundingClientRect();
      const scale = Math.min(1, maxW / rect.width);
      const outW = Math.round(rect.width * scale);
      const outH = Math.round(rect.height * scale);

      const off = document.createElement('canvas');
      off.width = outW; off.height = outH;
      const octx = off.getContext('2d');
      octx.fillStyle = '#fff';
      octx.fillRect(0,0,outW,outH);

      const s = scale;
      octx.lineCap = 'round'; octx.lineJoin = 'round'; octx.strokeStyle = pad.ink || '#111827';
      const drawScaled = (pts)=>{
        if (pts.length<2){
          const p = pts[0]; octx.beginPath(); octx.arc(p.x*s, p.y*s, (pad.baseWidth||2)*s, 0, Math.PI*2); octx.fill(); octx.closePath(); return;
        }
        const mid=(a,b)=>({x:(a.x+b.x)/2, y:(a.y+b.y)/2, p:(a.p+b.p)/2});
        let prev=pts[0], mPrev=prev;
        for (let i=1; i<pts.length; i++){
          const curr=pts[i], mCurr=mid(prev,curr);
          const w = (pad.baseWidth||2)*(0.65 + (curr.p||0.5));
          octx.lineWidth = Math.max(1, Math.min(5, w))*s;
          octx.beginPath();
          octx.moveTo(mPrev.x*s, mPrev.y*s);
          octx.quadraticCurveTo(prev.x*s, prev.y*s, mCurr.x*s, mCurr.y*s);
          octx.stroke(); octx.closePath();
          mPrev=mCurr; prev=curr;
        }
      };
      for (const stroke of pad.strokes) drawScaled(stroke);
      if (pad.current) drawScaled(pad.current);

      off.toBlob(blob => resolve(blob), mime, quality);
    });
  }

  /* =========================
   * Submit
   * ======================= */
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();

    if (!validatePrograms()) return;

    // Signature validity + make sure the hidden input contains a PNG dataURL fallback
    if (participantPad.isEmpty()) {
      participantHidden.setCustomValidity('Please provide your signature.');
    } else {
      participantHidden.setCustomValidity('');
      participantHidden.value = participantPad._exportScaled("image/png", 0.92);
    }
    if (guardianPad) {
      if (ageMinor.checked && guardianPad.isEmpty()) {
        guardianHidden.setCustomValidity('Parent/Guardian signature required for minors.');
      } else {
        guardianHidden.setCustomValidity('');
        if (!guardianPad.isEmpty()) guardianHidden.value = guardianPad._exportScaled("image/png", 0.92);
      }
    }

    if (!form.checkValidity()) { form.reportValidity(); return; }
    refreshSignaturePreviews();

    // Build payload
    const fd = new FormData(form);

    // normalize programs
    const programs = Array.from(form.querySelectorAll('input[name="programs"]:checked')).map(i=>i.value);
    fd.delete("programs"); programs.forEach(v=>fd.append("programs", v));

    // metadata
    if (!fd.get("_ts"))         fd.append("_ts", Date.now().toString());
    if (!fd.get("submittedAt")) fd.append("submittedAt", new Date().toISOString());
    if (!fd.get("website"))     fd.append("website", ""); // honeypot
    fd.append("_ua", navigator.userAgent);

    // IMPORTANT: keep the hidden PNG data-URL AND also attach a Blob file with the same field name.
    // GAS will see e.files.participantSignature for Drive upload,
    // and still have e.parameter.participantSignature as a fallback string.
    if (!participantPad.isEmpty()) {
      const pBlob = await sigPadToBlob(participantPad, "image/png", 0.92);
      fd.append('participantSignature', pBlob, 'participant-signature.png');
    }
    if (guardianPad && (!ageAdult.checked || !guardianPad.isEmpty())) {
      if (!guardianPad.isEmpty()) {
        const gBlob = await sigPadToBlob(guardianPad, "image/png", 0.92);
        fd.append('guardianSignature', gBlob, 'guardian-signature.png');
      }
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true; submitBtn.textContent = "Submitting…";

    try{
      if(!navigator.onLine){
        const cache = fdToObj(fd);
        if (!participantPad.isEmpty()) cache.participantSignature = participantHidden.value;
        if (guardianPad && !guardianPad.isEmpty()) cache.guardianSignature = guardianHidden.value;
        enqueue(cache);

        statusEl.className = "status success";
        statusEl.textContent = "Saved offline. We’ll auto-send when you’re back online.";
        form.reset(); participantPad.clear(); guardianPad && guardianPad.clear(); toggleGuardian();
      } else {
        await postWithRetry(fd);
        statusEl.className = "status success";
        statusEl.textContent = "Thanks! Your registration has been submitted.";
        form.reset(); participantPad.clear(); guardianPad && guardianPad.clear(); toggleGuardian();
      }
    }catch(err){
      const cache = fdToObj(fd);
      if (!participantPad.isEmpty()) cache.participantSignature = participantHidden.value;
      if (guardianPad && !guardianPad.isEmpty()) cache.guardianSignature = guardianHidden.value;
      enqueue(cache);

      statusEl.className = "status error";
      statusEl.textContent = "Couldn’t reach server. Saved offline; retry later.";
    }finally{
      submitBtn.disabled = false; submitBtn.textContent = "Submit Registration";
      showRetryIfNeeded();
    }
  });

  /* =========================
   * Retry pending
   * ======================= */
  retryBtn.addEventListener("click", async ()=>{
    const pending = dequeueAll(); const remain = [];
    for (const entry of pending){
      try{
        const fd = new FormData();
        Object.entries(entry).forEach(([k,v])=>{
          if (Array.isArray(v)) v.forEach(x=>fd.append(k,x)); else fd.append(k,v);
        });
        // If data-URL fields are present, also reattach files for best chance
        if (entry.participantSignature && /^data:image\//.test(entry.participantSignature)) {
          const b = dataUrlToBlob(entry.participantSignature);
          if (b) fd.append('participantSignature', b, 'participant-signature.png');
        }
        if (entry.guardianSignature && /^data:image\//.test(entry.guardianSignature)) {
          const b = dataUrlToBlob(entry.guardianSignature);
          if (b) fd.append('guardianSignature', b, 'guardian-signature.png');
        }
        await postWithRetry(fd);
      }catch(e){
        remain.push(entry);
      }
    }
    if (remain.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(remain));
    showRetryIfNeeded();
    statusEl.className = remain.length ? "status warn" : "status success";
    statusEl.textContent = remain.length ? `Retry finished. ${remain.length} left.` : "All pending submissions sent.";
  });

  // init
  showRetryIfNeeded();
});

