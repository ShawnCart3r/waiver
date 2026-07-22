// main.js
document.addEventListener("DOMContentLoaded", () => {
  /* =========================
   * CONFIG
   * ======================= */
  const SHEET_ENDPOINT =
    "https://script.google.com/macros/s/AKfycbyvI7YV1xXFrrNlw1PznWFe6pei58SvATFk0FjEFfOxMYrVFKYCZC_tdowVQlfaBnyO3g/exec";

  const MAX_EXPORT_WIDTH = 900;
  const EXPORT_MIME = "image/png";
  const EXPORT_QUALITY = 0.92;
  const QUEUE_KEY = "nb2025_queue";

  /* =========================
   * DOM
   * ======================= */
  const form = document.getElementById("regForm");
  const statusEl = document.getElementById("formStatus");
  const retryBtn = document.getElementById("retryBtn");

  if (!form) {
    console.error('Registration form with id="regForm" was not found.');
    return;
  }

  const ageAdult = form.querySelector(
    'input[name="ageType"][value="adult"]'
  );

  const ageMinor = form.querySelector(
    'input[name="ageType"][value="minor"]'
  );

  const guardianFS = document.getElementById("guardianFields");

  const guardInputs = guardianFS
    ? guardianFS.querySelectorAll(
        'input[name="guardName"], input[name="guardDate"]'
      )
    : [];

  const waiverBox = document.getElementById("waiverText");
  const waiverAgree = document.getElementById("waiverAgree");

  const participantHidden =
    document.getElementById("participantSignature");

  const guardianHidden =
    document.getElementById("guardianSignature");

  /*
   * FormData reads form controls using their name attributes.
   * These assignments ensure the signatures are included.
   */
  if (participantHidden) {
    participantHidden.name = "participantSignature";
  }

  if (guardianHidden) {
    guardianHidden.name = "guardianSignature";
  }

  const pCanvas = document.getElementById("participantSig");
  const pUndo = document.getElementById("participantUndo");
  const pClear = document.getElementById("participantClear");
  const pPrevWrap = document.getElementById("sigPreviewWrap");
  const pPrevImg = document.getElementById("participantPreview");

  const gCanvas = document.getElementById("guardianSig");
  const gUndo = document.getElementById("guardianUndo");
  const gClear = document.getElementById("guardianClear");
  const gPrevWrap = document.getElementById("guardPreviewWrap");
  const gPrevImg = document.getElementById("guardianPreview");

  if (!pCanvas || !participantHidden) {
    console.error(
      "Participant signature canvas or hidden field is missing."
    );
    return;
  }

  /* =========================
   * UTILITIES
   * ======================= */

  function setStatus(type, message) {
    if (!statusEl) {
      return;
    }

    statusEl.className = `status ${type}`.trim();
    statusEl.textContent = message;
  }

  function formatPhone(element) {
    const digits = element.value
      .replace(/\D/g, "")
      .slice(0, 10);

    if (digits.length >= 7) {
      element.value =
        `(${digits.slice(0, 3)}) ` +
        `${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else if (digits.length >= 4) {
      element.value =
        `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else if (digits.length >= 1) {
      element.value = `(${digits}`;
    } else {
      element.value = "";
    }
  }

  ["phone", "ecPhone"].forEach((name) => {
    const element = form.querySelector(
      `input[name="${name}"]`
    );

    if (!element) {
      return;
    }

    element.addEventListener("input", () => {
      formatPhone(element);
    });

    element.addEventListener("blur", () => {
      formatPhone(element);
    });
  });

  function validatePrograms() {
    const selectedPrograms = form.querySelectorAll(
      'input[name="programs"]:checked'
    );

    if (selectedPrograms.length === 0) {
      setStatus(
        "warn",
        "Please select at least one program."
      );

      return false;
    }

    return true;
  }

  function getQueue() {
    try {
      const stored = localStorage.getItem(QUEUE_KEY);
      const queue = stored ? JSON.parse(stored) : [];

      return Array.isArray(queue) ? queue : [];
    } catch (error) {
      console.error("Could not read submission queue:", error);
      return [];
    }
  }

  function saveQueue(queue) {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(queue)
    );
  }

  function enqueue(entry) {
    const queue = getQueue();
    queue.push(entry);
    saveQueue(queue);
  }

  function dequeueAll() {
    const queue = getQueue();
    localStorage.removeItem(QUEUE_KEY);
    return queue;
  }

  function hasQueue() {
    return getQueue().length > 0;
  }

  function showRetryIfNeeded() {
    if (!retryBtn) {
      return;
    }

    const queueLength = getQueue().length;

    retryBtn.style.display =
      queueLength > 0 ? "inline-block" : "none";

    if (queueLength > 0) {
      retryBtn.textContent =
        `Retry Pending (${queueLength})`;
    }
  }

  function formDataToObject(formData) {
    const object = {};

    formData.forEach((value, key) => {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        if (Array.isArray(object[key])) {
          object[key].push(value);
        } else {
          object[key] = [
            object[key],
            value
          ];
        }
      } else {
        object[key] = value;
      }
    });

    return object;
  }

  function objectToFormData(object) {
    const formData = new FormData();

    Object.entries(object).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          formData.append(key, item);
        });
      } else if (value !== null && value !== undefined) {
        formData.append(key, value);
      }
    });

    return formData;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  /*
   * Google Apps Script web apps commonly require no-cors
   * when called directly from an external static website.
   *
   * An opaque response means JavaScript cannot inspect the
   * response body or HTTP status. A successful fetch here
   * confirms the request was sent, not that Apps Script
   * returned valid JSON.
   */
  async function postWithRetry(
    formData,
    attempt = 0
  ) {
    const maxRetries = 3;
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 12000);

    try {
      await fetch(SHEET_ENDPOINT, {
        method: "POST",
        body: formData,
        mode: "no-cors",
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      return {
        ok: true
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (attempt >= maxRetries) {
        throw error;
      }

      await delay(800 * 2 ** attempt);

      return postWithRetry(
        formData,
        attempt + 1
      );
    }
  }

  /* =========================
   * SIGNATURE PAD
   * ======================= */

  class ProSignaturePad {
    constructor(canvas, onChange) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.onChange = onChange || (() => {});
      this.strokes = [];
      this.current = null;
      this.baseWidth = 2;
      this.backgroundColor = "#ffffff";
      this.inkColor = "#111827";

      this.resize = this.resize.bind(this);

      this.attachEvents();
      this.resize();
    }

    attachEvents() {
      window.addEventListener(
        "resize",
        this.resize
      );

      this.canvas.addEventListener(
        "pointerdown",
        (event) => {
          event.preventDefault();

          this.canvas.setPointerCapture(
            event.pointerId
          );

          this.current = [
            this.getPosition(event)
          ];
        }
      );

      this.canvas.addEventListener(
        "pointermove",
        (event) => {
          if (!this.current) {
            return;
          }

          this.current.push(
            this.getPosition(event)
          );

          this.redraw();
          this.onChange(false);
        }
      );

      const finishStroke = () => {
        if (
          this.current &&
          this.current.length > 0
        ) {
          this.strokes.push(this.current);
        }

        this.current = null;
        this.onChange(this.isEmpty());
      };

      this.canvas.addEventListener(
        "pointerup",
        finishStroke
      );

      this.canvas.addEventListener(
        "pointerleave",
        finishStroke
      );

      this.canvas.addEventListener(
        "pointercancel",
        finishStroke
      );
    }

    getPosition(event) {
      const rect =
        this.canvas.getBoundingClientRect();

      const pressure =
        typeof event.pressure === "number" &&
        event.pressure > 0
          ? event.pressure
          : 0.5;

      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        pressure
      };
    }

    resize() {
      const ratio = Math.max(
        1,
        window.devicePixelRatio || 1
      );

      const rect =
        this.canvas.getBoundingClientRect();

      this.canvas.width = Math.round(
        rect.width * ratio
      );

      this.canvas.height = Math.round(
        rect.height * ratio
      );

      this.ctx.setTransform(
        ratio,
        0,
        0,
        ratio,
        0,
        0
      );

      this.redraw();
    }

    paintBackground() {
      const rect =
        this.canvas.getBoundingClientRect();

      this.ctx.save();

      this.ctx.fillStyle =
        this.backgroundColor;

      this.ctx.fillRect(
        0,
        0,
        rect.width,
        rect.height
      );

      this.ctx.restore();
    }

    drawStroke(points) {
      if (!points || points.length === 0) {
        return;
      }

      if (points.length < 2) {
        const point = points[0];

        this.ctx.beginPath();
        this.ctx.fillStyle = this.inkColor;

        this.ctx.arc(
          point.x,
          point.y,
          this.baseWidth,
          0,
          Math.PI * 2
        );

        this.ctx.fill();
        this.ctx.closePath();

        return;
      }

      this.ctx.strokeStyle = this.inkColor;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";

      const midpoint = (a, b) => ({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        pressure:
          (a.pressure + b.pressure) / 2
      });

      let previous = points[0];
      let previousMidpoint = previous;

      for (
        let index = 1;
        index < points.length;
        index += 1
      ) {
        const current = points[index];

        const currentMidpoint = midpoint(
          previous,
          current
        );

        const pressure =
          current.pressure || 0.5;

        const width =
          this.baseWidth *
          (0.65 + pressure);

        this.ctx.lineWidth = Math.max(
          1.2,
          Math.min(5, width)
        );

        this.ctx.beginPath();

        this.ctx.moveTo(
          previousMidpoint.x,
          previousMidpoint.y
        );

        this.ctx.quadraticCurveTo(
          previous.x,
          previous.y,
          currentMidpoint.x,
          currentMidpoint.y
        );

        this.ctx.stroke();
        this.ctx.closePath();

        previousMidpoint =
          currentMidpoint;

        previous = current;
      }
    }

    redraw() {
      this.paintBackground();

      this.strokes.forEach((stroke) => {
        this.drawStroke(stroke);
      });

      if (this.current) {
        this.drawStroke(this.current);
      }
    }

    clear() {
      this.strokes = [];
      this.current = null;
      this.redraw();
      this.onChange(true);
    }

    undo() {
      this.strokes.pop();
      this.redraw();
      this.onChange(this.isEmpty());
    }

    isEmpty() {
      return (
        this.strokes.length === 0 &&
        (
          !this.current ||
          this.current.length === 0
        )
      );
    }

    exportScaled(
      mime = EXPORT_MIME,
      quality = EXPORT_QUALITY
    ) {
      const rect =
        this.canvas.getBoundingClientRect();

      const scale = Math.min(
        1,
        MAX_EXPORT_WIDTH / rect.width
      );

      const outputWidth = Math.round(
        rect.width * scale
      );

      const outputHeight = Math.round(
        rect.height * scale
      );

      const outputCanvas =
        document.createElement("canvas");

      outputCanvas.width = outputWidth;
      outputCanvas.height = outputHeight;

      const outputContext =
        outputCanvas.getContext("2d");

      outputContext.fillStyle = "#ffffff";

      outputContext.fillRect(
        0,
        0,
        outputWidth,
        outputHeight
      );

      outputContext.lineCap = "round";
      outputContext.lineJoin = "round";
      outputContext.strokeStyle =
        this.inkColor;

      const drawScaledStroke = (points) => {
        if (!points || points.length === 0) {
          return;
        }

        if (points.length < 2) {
          const point = points[0];

          outputContext.beginPath();
          outputContext.fillStyle =
            this.inkColor;

          outputContext.arc(
            point.x * scale,
            point.y * scale,
            this.baseWidth * scale,
            0,
            Math.PI * 2
          );

          outputContext.fill();
          outputContext.closePath();

          return;
        }

        const midpoint = (a, b) => ({
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          pressure:
            (a.pressure + b.pressure) / 2
        });

        let previous = points[0];
        let previousMidpoint = previous;

        for (
          let index = 1;
          index < points.length;
          index += 1
        ) {
          const current = points[index];

          const currentMidpoint = midpoint(
            previous,
            current
          );

          const pressure =
            current.pressure || 0.5;

          const width =
            this.baseWidth *
            (0.65 + pressure);

          outputContext.lineWidth =
            Math.max(
              1,
              Math.min(5, width)
            ) * scale;

          outputContext.beginPath();

          outputContext.moveTo(
            previousMidpoint.x * scale,
            previousMidpoint.y * scale
          );

          outputContext.quadraticCurveTo(
            previous.x * scale,
            previous.y * scale,
            currentMidpoint.x * scale,
            currentMidpoint.y * scale
          );

          outputContext.stroke();
          outputContext.closePath();

          previousMidpoint =
            currentMidpoint;

          previous = current;
        }
      };

      this.strokes.forEach((stroke) => {
        drawScaledStroke(stroke);
      });

      if (this.current) {
        drawScaledStroke(this.current);
      }

      return outputCanvas.toDataURL(
        mime,
        quality
      );
    }

    toDataURL() {
      return this.exportScaled();
    }
  }

  /* =========================
   * SIGNATURE PREVIEWS
   * ======================= */

  function refreshSignaturePreviews() {
    if (pPrevWrap && pPrevImg) {
      if (
        participantHidden &&
        participantHidden.value
      ) {
        pPrevImg.src =
          participantHidden.value;

        pPrevWrap.style.display =
          "block";
      } else {
        pPrevWrap.style.display =
          "none";

        pPrevImg.removeAttribute("src");
      }
    }

    if (gPrevWrap && gPrevImg) {
      const guardianVisible =
        guardianFS &&
        guardianFS.style.display !== "none";

      if (
        guardianVisible &&
        guardianHidden &&
        guardianHidden.value
      ) {
        gPrevImg.src =
          guardianHidden.value;

        gPrevWrap.style.display =
          "block";
      } else {
        gPrevWrap.style.display =
          "none";

        gPrevImg.removeAttribute("src");
      }
    }
  }

  /* =========================
   * SIGNATURE PAD WIRING
   * ======================= */

  function updateParticipantSignature(pad) {
    if (!participantHidden) {
      return;
    }

    if (pad && !pad.isEmpty()) {
      participantHidden.value =
        pad.exportScaled(
          "image/png",
          0.92
        );
    } else {
      participantHidden.value = "";
    }

    refreshSignaturePreviews();
  }

  function updateGuardianSignature(pad) {
    if (!guardianHidden) {
      return;
    }

    if (pad && !pad.isEmpty()) {
      guardianHidden.value =
        pad.exportScaled(
          "image/png",
          0.92
        );
    } else {
      guardianHidden.value = "";
    }

    refreshSignaturePreviews();
  }

  const participantPad =
    new ProSignaturePad(
      pCanvas,
      () => {}
    );

  pCanvas.addEventListener(
    "pointerup",
    () => {
      updateParticipantSignature(
        participantPad
      );
    }
  );

  pCanvas.addEventListener(
    "pointercancel",
    () => {
      updateParticipantSignature(
        participantPad
      );
    }
  );

  if (pUndo) {
    pUndo.addEventListener(
      "click",
      (event) => {
        event.preventDefault();

        participantPad.undo();

        updateParticipantSignature(
          participantPad
        );
      }
    );
  }

  if (pClear) {
    pClear.addEventListener(
      "click",
      (event) => {
        event.preventDefault();

        participantPad.clear();
        participantHidden.value = "";

        refreshSignaturePreviews();
      }
    );
  }

  let guardianPad = null;

  if (gCanvas) {
    guardianPad =
      new ProSignaturePad(
        gCanvas,
        () => {}
      );

    gCanvas.addEventListener(
      "pointerup",
      () => {
        updateGuardianSignature(
          guardianPad
        );
      }
    );

    gCanvas.addEventListener(
      "pointercancel",
      () => {
        updateGuardianSignature(
          guardianPad
        );
      }
    );

    if (gUndo) {
      gUndo.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          guardianPad.undo();

          updateGuardianSignature(
            guardianPad
          );
        }
      );
    }

    if (gClear) {
      gClear.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          guardianPad.clear();

          if (guardianHidden) {
            guardianHidden.value = "";
          }

          refreshSignaturePreviews();
        }
      );
    }
  }

  /* =========================
   * GUARDIAN TOGGLE
   * ======================= */

  function toggleGuardian() {
    if (!guardianFS) {
      return;
    }

    const isMinor =
      ageMinor && ageMinor.checked;

    guardianFS.style.display =
      isMinor ? "block" : "none";

    guardInputs.forEach((input) => {
      input.required = isMinor;
    });

    if (guardianHidden) {
      guardianHidden.required = isMinor;

      if (!isMinor) {
        guardianHidden.setCustomValidity("");
      }
    }

    refreshSignaturePreviews();
  }

  if (ageAdult) {
    ageAdult.addEventListener(
      "change",
      toggleGuardian
    );
  }

  if (ageMinor) {
    ageMinor.addEventListener(
      "change",
      toggleGuardian
    );
  }

  toggleGuardian();

  /* =========================
   * WAIVER SCROLL
   * ======================= */

  function checkWaiverScrolled() {
    if (!waiverBox || !waiverAgree) {
      return;
    }

    const sentinel =
      document.getElementById(
        "waiverSentinel"
      );

    const atBottom = sentinel
      ? sentinel.getBoundingClientRect().top <=
        waiverBox.getBoundingClientRect().bottom
      : waiverBox.scrollTop +
          waiverBox.clientHeight >=
        waiverBox.scrollHeight - 4;

    if (atBottom) {
      waiverAgree.disabled = false;
    }
  }

  if (waiverBox) {
    waiverBox.addEventListener(
      "scroll",
      checkWaiverScrolled
    );
  }

  window.addEventListener(
    "load",
    checkWaiverScrolled
  );

  /* =========================
   * FORM RESET
   * ======================= */

  function resetFormAfterSubmission() {
    form.reset();

    participantPad.clear();

    if (guardianPad) {
      guardianPad.clear();
    }

    if (participantHidden) {
      participantHidden.value = "";
      participantHidden.setCustomValidity("");
    }

    if (guardianHidden) {
      guardianHidden.value = "";
      guardianHidden.setCustomValidity("");
    }

    toggleGuardian();
    refreshSignaturePreviews();
  }

  /* =========================
   * SUBMIT
   * ======================= */

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      if (!validatePrograms()) {
        return;
      }

      if (participantPad.isEmpty()) {
        participantHidden.setCustomValidity(
          "Please provide your signature."
        );
      } else {
        participantHidden.setCustomValidity("");

        participantHidden.value =
          participantPad.exportScaled(
            "image/png",
            0.92
          );
      }

      if (
        guardianPad &&
        ageMinor &&
        ageMinor.checked
      ) {
        if (guardianPad.isEmpty()) {
          guardianHidden.setCustomValidity(
            "Parent or guardian signature is required for minors."
          );
        } else {
          guardianHidden.setCustomValidity("");

          guardianHidden.value =
            guardianPad.exportScaled(
              "image/png",
              0.92
            );
        }
      } else if (guardianHidden) {
        guardianHidden.setCustomValidity("");
        guardianHidden.value = "";
      }

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      refreshSignaturePreviews();

      const formData =
        new FormData(form);

      const programs = Array.from(
        form.querySelectorAll(
          'input[name="programs"]:checked'
        )
      ).map((input) => input.value);

      formData.delete("programs");

      programs.forEach((program) => {
        formData.append(
          "programs",
          program
        );
      });

      formData.set(
        "_ts",
        Date.now().toString()
      );

      formData.set(
        "submittedAt",
        new Date().toISOString()
      );

      formData.set(
        "website",
        formData.get("website") || ""
      );

      formData.set(
        "_ua",
        navigator.userAgent
      );

      /*
       * Send exactly one text value for each signature.
       * The Apps Script reads these from:
       *
       * e.parameter.participantSignature
       * e.parameter.guardianSignature
       */
      formData.set(
        "participantSignature",
        participantHidden.value
      );

      if (
        guardianPad &&
        ageMinor &&
        ageMinor.checked &&
        !guardianPad.isEmpty()
      ) {
        formData.set(
          "guardianSignature",
          guardianHidden.value
        );
      } else {
        formData.delete(
          "guardianSignature"
        );
      }

      const submitButton =
        form.querySelector(
          'button[type="submit"]'
        );

      const originalButtonText =
        submitButton
          ? submitButton.textContent
          : "Submit Registration";

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent =
          "Submitting…";
      }

      try {
        if (!navigator.onLine) {
          enqueue(
            formDataToObject(formData)
          );

          setStatus(
            "success",
            "Saved offline. Use Retry Pending when you are back online."
          );

          resetFormAfterSubmission();
        } else {
          await postWithRetry(formData);

          setStatus(
            "success",
            "Thanks! Your registration has been submitted."
          );

          resetFormAfterSubmission();
        }
      } catch (error) {
        console.error(
          "Submission failed:",
          error
        );

        enqueue(
          formDataToObject(formData)
        );

        setStatus(
          "error",
          "Could not reach the server. The registration was saved locally so you can retry it."
        );
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent =
            originalButtonText;
        }

        showRetryIfNeeded();
      }
    }
  );

  /* =========================
   * RETRY PENDING
   * ======================= */

  if (retryBtn) {
    retryBtn.addEventListener(
      "click",
      async () => {
        const pending = dequeueAll();
        const remaining = [];

        retryBtn.disabled = true;
        retryBtn.textContent = "Retrying…";

        for (const entry of pending) {
          try {
            const formData =
              objectToFormData(entry);

            await postWithRetry(formData);
          } catch (error) {
            console.error(
              "Pending submission failed:",
              error
            );

            remaining.push(entry);
          }
        }

        if (remaining.length > 0) {
          saveQueue(remaining);
        }

        retryBtn.disabled = false;
        showRetryIfNeeded();

        if (remaining.length > 0) {
          setStatus(
            "warn",
            `Retry finished. ${remaining.length} submission(s) are still pending.`
          );
        } else {
          setStatus(
            "success",
            "All pending submissions were sent."
          );
        }
      }
    );
  }

  /* =========================
   * INIT
   * ======================= */

  showRetryIfNeeded();
  refreshSignaturePreviews();
  checkWaiverScrolled();
});
