/**
 * Sahayak — ScreenshotView Component (Slice 2.3)
 *
 * Implements Screenshot-and-Ask:
 *  - Captures visible tab screenshot via background service worker
 *  - Displays captured image in an interactive HTML5 canvas
 *  - Click-and-drag rectangle crop tool with real-time visual overlay
 *  - Downscales oversized (4K/high-DPI) images to max 1920px wide
 *  - Submits cropped region or full screenshot + question to Gemini multimodal
 *  - Displays structured visual analysis answer with model badge and copy button
 *
 * Edge cases covered:
 *  2.3.1 — Restricted pages (chrome://, Web Store) handled with friendly error
 *  2.3.2 — High-DPI displays (retina, scaling): coordinates normalized via scale ratios
 *  2.3.3 — Large 4K monitor screenshots downscaled to max 1920px before sending
 *  2.3.4 — Full-page vague question hint encouraging targeted crop
 *  2.3.6 — Captures visible tab content
 *  2.3.7 — Sensitive domain protection
 */

const ScreenshotView = (() => {
  let _container = null;
  let _currentRawImage = null;       // Image element of the captured screenshot
  let _currentDataUrl = null;        // Full base64 screenshot data URL
  let _isDragging = false;
  let _cropRect = null;              // { startX, startY, width, height } in canvas coordinate space
  let _dragStart = { x: 0, y: 0 };
  let _isAnalyzing = false;

  const MAX_IMAGE_WIDTH = 1920;

  /**
   * Render the Screenshot & Ask component.
   * @param {HTMLElement} container
   */
  function render(container) {
    _container = container;

    container.innerHTML = `
      <div class="screenshot-view-root">
        <!-- Top Controls / Capture Banner -->
        <div class="screenshot-header">
          <div class="screenshot-header-text">
            <h3>📸 Screenshot &amp; Ask</h3>
            <p>Capture the visible screen to inspect charts, diagrams, tables, or visual errors.</p>
          </div>
          <button id="btn-capture-screen" class="btn btn-primary">
            📷 Capture Screenshot
          </button>
        </div>

        <!-- Capture Error Banner -->
        <div id="screenshot-error-banner" class="chat-banner chat-banner-warning" style="display: none;">
          <span id="screenshot-error-msg">⚠️ Cannot capture screenshot on this page.</span>
        </div>

        <!-- Canvas & Crop Studio (hidden until screenshot captured) -->
        <div id="screenshot-studio" class="screenshot-studio" style="display: none;">
          <div class="studio-toolbar">
            <span id="crop-status-badge" class="crop-badge">Full Screenshot</span>
            <div class="studio-toolbar-actions">
              <button id="btn-reset-crop" class="btn btn-secondary btn-sm" title="Clear crop selection">
                ↺ Reset Crop
              </button>
              <button id="btn-retake-screen" class="btn btn-secondary btn-sm" title="Capture new screenshot">
                🔄 Retake
              </button>
            </div>
          </div>

          <!-- Canvas Interactive Workspace -->
          <div class="canvas-scroll-wrapper">
            <div class="canvas-container">
              <canvas id="screenshot-canvas"></canvas>
            </div>
          </div>
          <div class="crop-hint">
            <span>🖱️ Click &amp; drag over the image to crop a specific area.</span>
          </div>

          <!-- Question Input Box -->
          <div class="screenshot-query-section">
            <div class="suggestion-chips-row">
              <button class="screenshot-chip" data-q="What does this chart or diagram show?">📊 Explain this chart</button>
              <button class="screenshot-chip" data-q="What does this error message mean and how do I fix it?">⚠️ Explain this error</button>
              <button class="screenshot-chip" data-q="Summarise the key visual details and data shown here.">📝 Summarise visual data</button>
            </div>

            <div class="screenshot-input-wrapper">
              <textarea
                id="screenshot-question-input"
                class="form-input screenshot-textarea"
                placeholder="Ask anything about this screenshot..."
                rows="2"
              ></textarea>
              <button id="btn-submit-screenshot-ask" class="btn btn-primary screenshot-submit-btn">
                Ask AI ➤
              </button>
            </div>

            <div id="crop-vague-hint" class="crop-vague-hint" style="display: none;">
              💡 <em>Tip: For more precise answers on busy pages, drag a box over the specific diagram or text you are asking about.</em>
            </div>
          </div>

          <!-- Analysis Loading State -->
          <div id="screenshot-loading" class="loading-area" style="display: none;">
            <div class="loading-spinner"></div>
            <span class="loading-text">Analyzing image with Gemini Vision…</span>
          </div>

          <!-- Analysis Result Card -->
          <div id="screenshot-result-card" class="result-area" style="display: none;">
            <div class="result-header">
              <h3 class="section-title">🔍 Visual Analysis</h3>
              <div class="result-actions">
                <button id="btn-copy-screenshot-result" class="btn btn-secondary btn-sm" title="Copy to clipboard">
                  📋 Copy
                </button>
                <button id="btn-clear-screenshot-result" class="btn btn-secondary btn-sm" title="Close answer">
                  ✕
                </button>
              </div>
            </div>
            <div id="screenshot-result-text" class="result-text"></div>
            <div id="screenshot-model-badge" class="model-badge">⚡ gemini-2.0-flash</div>
          </div>

          <!-- Analysis Error State -->
          <div id="screenshot-query-error" class="error-area" style="display: none;">
            <div id="screenshot-query-error-text" class="error-text"></div>
            <button id="btn-retry-screenshot-ask" class="btn btn-secondary btn-sm">🔄 Retry</button>
          </div>
        </div>

        <!-- Initial Empty State -->
        <div id="screenshot-empty-state" class="screenshot-empty-state">
          <div class="empty-icon">🖼️</div>
          <h3>Inspect visible screen content</h3>
          <p>Take a snapshot of the current webpage, crop any diagram, graph, or error, and get an instant AI breakdown.</p>
        </div>
      </div>
    `;

    bindEvents();
  }

  /**
   * Bind DOM event listeners.
   */
  function bindEvents() {
    const btnCapture = _container.querySelector('#btn-capture-screen');
    const btnRetake = _container.querySelector('#btn-retake-screen');
    const btnResetCrop = _container.querySelector('#btn-reset-crop');
    const btnSubmit = _container.querySelector('#btn-submit-screenshot-ask');
    const btnRetry = _container.querySelector('#btn-retry-screenshot-ask');
    const btnCopy = _container.querySelector('#btn-copy-screenshot-result');
    const btnClear = _container.querySelector('#btn-clear-screenshot-result');
    const questionInput = _container.querySelector('#screenshot-question-input');
    const canvas = _container.querySelector('#screenshot-canvas');

    btnCapture.addEventListener('click', captureTab);
    btnRetake.addEventListener('click', captureTab);
    btnResetCrop.addEventListener('click', resetCrop);

    btnSubmit.addEventListener('click', submitQuestion);
    btnRetry.addEventListener('click', submitQuestion);

    // Enter to submit (Shift+Enter for newline)
    questionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitQuestion();
      }
    });

    // Suggestion chips click
    _container.querySelectorAll('.screenshot-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        questionInput.value = chip.dataset.q || '';
        questionInput.focus();
      });
    });

    // Copy result button
    btnCopy.addEventListener('click', async () => {
      const text = _container.querySelector('#screenshot-result-text').textContent || '';
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        btnCopy.textContent = '✅ Copied';
        setTimeout(() => { btnCopy.textContent = '📋 Copy'; }, 1500);
      } catch (err) {
        // Fallback
        const range = document.createRange();
        range.selectNodeContents(_container.querySelector('#screenshot-result-text'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        btnCopy.textContent = '✅ Copied';
        setTimeout(() => { btnCopy.textContent = '📋 Copy'; }, 1500);
      }
    });

    // Clear result button
    btnClear.addEventListener('click', () => {
      _container.querySelector('#screenshot-result-card').style.display = 'none';
      _container.querySelector('#screenshot-query-error').style.display = 'none';
    });

    // Setup interactive canvas crop events
    setupCanvasEvents(canvas);
  }

  /**
   * Request background script to capture active browser tab.
   */
  async function captureTab() {
    const errorBanner = _container.querySelector('#screenshot-error-banner');
    const errorMsg = _container.querySelector('#screenshot-error-msg');
    const studio = _container.querySelector('#screenshot-studio');
    const emptyState = _container.querySelector('#screenshot-empty-state');
    const btnCapture = _container.querySelector('#btn-capture-screen');

    errorBanner.style.display = 'none';
    btnCapture.disabled = true;
    btnCapture.textContent = '⏳ Capturing…';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' });

      if (response && response.success && response.data?.dataUrl) {
        _currentDataUrl = response.data.dataUrl;
        await loadScreenshotIntoCanvas(_currentDataUrl);

        studio.style.display = 'block';
        emptyState.style.display = 'none';
        _container.querySelector('#screenshot-question-input').focus();
      } else {
        const msg = response?.error?.message || 'Could not capture screenshot of this page.';
        errorMsg.textContent = `⚠️ ${msg}`;
        errorBanner.style.display = 'flex';
      }
    } catch (err) {
      errorMsg.textContent = `⚠️ Screenshot capture failed: ${err.message}`;
      errorBanner.style.display = 'flex';
    } finally {
      btnCapture.disabled = false;
      btnCapture.textContent = '📷 Capture Screenshot';
    }
  }

  /**
   * Load base64 screenshot image and set up canvas dimensions.
   * Downscales 4K / oversized displays to max 1920px (Edge case 2.3.3).
   */
  function loadScreenshotIntoCanvas(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        _currentRawImage = img;
        _cropRect = null;

        const canvas = _container.querySelector('#screenshot-canvas');
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Downscale large 4K images to max 1920px (Edge case 2.3.3)
        if (width > MAX_IMAGE_WIDTH) {
          const ratio = MAX_IMAGE_WIDTH / width;
          width = MAX_IMAGE_WIDTH;
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        drawCanvas();
        updateCropBadge();
        resolve();
      };
      img.src = dataUrl;
    });
  }

  /**
   * Setup mouse drag events for rectangle crop tool on canvas.
   * Handles devicePixelRatio and CSS scaling (Edge case 2.3.2).
   */
  function setupCanvasEvents(canvas) {
    function getCanvasCoordinates(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
      };
    }

    canvas.addEventListener('mousedown', (e) => {
      if (!_currentRawImage) return;
      _isDragging = true;
      const pos = getCanvasCoordinates(e);
      _dragStart = pos;
      _cropRect = { startX: pos.x, startY: pos.y, width: 0, height: 0 };
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!_isDragging) return;
      const pos = getCanvasCoordinates(e);

      const x = Math.min(_dragStart.x, pos.x);
      const y = Math.min(_dragStart.y, pos.y);
      const width = Math.abs(pos.x - _dragStart.x);
      const height = Math.abs(pos.y - _dragStart.y);

      _cropRect = { startX: x, startY: y, width, height };
      drawCanvas();
    });

    window.addEventListener('mouseup', () => {
      if (!_isDragging) return;
      _isDragging = false;

      // Discard tiny accidental drags (< 15x15 pixels)
      if (_cropRect && (_cropRect.width < 15 || _cropRect.height < 15)) {
        _cropRect = null;
      }

      drawCanvas();
      updateCropBadge();
    });
  }

  /**
   * Redraw image onto canvas with crop dimming overlay and selection border.
   */
  function drawCanvas() {
    const canvas = _container.querySelector('#screenshot-canvas');
    if (!canvas || !_currentRawImage) return;
    const ctx = canvas.getContext('2d');

    // 1. Draw base image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(_currentRawImage, 0, 0, canvas.width, canvas.height);

    // 2. If crop region active, draw dark scrim with clear crop window
    if (_cropRect && _cropRect.width > 0 && _cropRect.height > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';

      // Outer dimming
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(
        _cropRect.startX,
        _cropRect.startY,
        _cropRect.width,
        _cropRect.height
      );
      ctx.fill('evenodd');

      // Crop border outline
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1a73e8';
      ctx.strokeRect(
        _cropRect.startX,
        _cropRect.startY,
        _cropRect.width,
        _cropRect.height
      );

      // Corner handles
      ctx.fillStyle = '#ffffff';
      const handleSize = 6;
      drawHandle(ctx, _cropRect.startX, _cropRect.startY, handleSize);
      drawHandle(ctx, _cropRect.startX + _cropRect.width, _cropRect.startY, handleSize);
      drawHandle(ctx, _cropRect.startX, _cropRect.startY + _cropRect.height, handleSize);
      drawHandle(ctx, _cropRect.startX + _cropRect.width, _cropRect.startY + _cropRect.height, handleSize);

      ctx.restore();
    }
  }

  function drawHandle(ctx, x, y, size) {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
  }

  /**
   * Reset crop box to full screenshot.
   */
  function resetCrop() {
    _cropRect = null;
    drawCanvas();
    updateCropBadge();
  }

  function updateCropBadge() {
    const badge = _container.querySelector('#crop-status-badge');
    const canvas = _container.querySelector('#screenshot-canvas');
    const vagueHint = _container.querySelector('#crop-vague-hint');

    if (_cropRect && _cropRect.width > 0 && _cropRect.height > 0) {
      badge.textContent = `✂️ Cropped (${_cropRect.width} × ${_cropRect.height} px)`;
      badge.classList.add('active-crop');
      if (vagueHint) vagueHint.style.display = 'none';
    } else {
      const w = canvas ? canvas.width : 0;
      const h = canvas ? canvas.height : 0;
      badge.textContent = `Full Screenshot (${w} × ${h} px)`;
      badge.classList.remove('active-crop');
      if (vagueHint) vagueHint.style.display = 'block';
    }
  }

  /**
   * Produce the final base64 image data URL (cropped or full).
   */
  function getPreparedImageData() {
    const canvas = _container.querySelector('#screenshot-canvas');
    if (!canvas) return null;

    if (_cropRect && _cropRect.width > 0 && _cropRect.height > 0) {
      // Export cropped sub-region
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = _cropRect.width;
      cropCanvas.height = _cropRect.height;
      const cropCtx = cropCanvas.getContext('2d');

      cropCtx.drawImage(
        canvas,
        _cropRect.startX,
        _cropRect.startY,
        _cropRect.width,
        _cropRect.height,
        0,
        0,
        _cropRect.width,
        _cropRect.height
      );

      return cropCanvas.toDataURL('image/png');
    }

    // Export whole canvas (already downscaled to max 1920px if necessary)
    return canvas.toDataURL('image/png');
  }

  /**
   * Submit screenshot and question to Gemini Vision multimodal endpoint.
   */
  async function submitQuestion() {
    const input = _container.querySelector('#screenshot-question-input');
    const question = (input.value || '').trim();

    if (!question || _isAnalyzing) return;

    const imageDataUrl = getPreparedImageData();
    if (!imageDataUrl) {
      showError('Please capture a screenshot first.');
      return;
    }

    _isAnalyzing = true;
    setLoadingState(true);

    const currentLang = window.SahayakApp ? window.SahayakApp.getCurrentLanguage() : 'en';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SCREENSHOT_ASK',
        payload: {
          image: imageDataUrl,
          question,
          language: currentLang
        }
      });

      if (response && response.success) {
        showResult(response.data.text, response.data.model);
      } else {
        const errMsg = response?.error?.message || 'Could not analyze screenshot.';
        showError(errMsg);
      }
    } catch (err) {
      showError(err.message || 'Failed to reach background service.');
    } finally {
      _isAnalyzing = false;
      setLoadingState(false);
    }
  }

  function setLoadingState(isLoading) {
    const loadingArea = _container.querySelector('#screenshot-loading');
    const resultCard = _container.querySelector('#screenshot-result-card');
    const errorArea = _container.querySelector('#screenshot-query-error');
    const btnSubmit = _container.querySelector('#btn-submit-screenshot-ask');

    if (isLoading) {
      loadingArea.style.display = 'flex';
      resultCard.style.display = 'none';
      errorArea.style.display = 'none';
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Thinking…';
    } else {
      loadingArea.style.display = 'none';
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Ask AI ➤';
    }
  }

  function showResult(text, model) {
    const resultCard = _container.querySelector('#screenshot-result-card');
    const resultText = _container.querySelector('#screenshot-result-text');
    const modelBadge = _container.querySelector('#screenshot-model-badge');

    resultText.innerHTML = formatMarkdown(text);
    modelBadge.textContent = `⚡ ${model || 'gemini-2.0-flash'}`;
    resultCard.style.display = 'block';

    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showError(msg) {
    const errorArea = _container.querySelector('#screenshot-query-error');
    const errorText = _container.querySelector('#screenshot-query-error-text');

    errorText.textContent = msg;
    errorArea.style.display = 'flex';
  }

  function formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/### (.*?)\n/g, '<h4>$1</h4>')
      .replace(/## (.*?)\n/g, '<h3>$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '<p></p>')
      .replace(/\n- (.*?)/g, '<br/>• $1')
      .replace(/\n/g, '<br/>');
  }

  return {
    render,
    captureTab
  };
})();

// Export globally
globalThis.ScreenshotView = ScreenshotView;
