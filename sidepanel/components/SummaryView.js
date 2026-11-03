/**
 * Sahayak — SummaryView Component
 *
 * Manages the "Summary" interface in the side panel:
 *  - Active tab detection (articles vs YouTube videos)
 *  - Dynamic button ("Summarise This Page" vs "Summarise Video")
 *  - Triggering SUMMARIZE_PAGE or SUMMARIZE_YOUTUBE
 *  - Loading states & progress indications
 *  - Structured display (TL;DR, Key Points / Takeaways, Chapters with timestamps)
 *  - Interactive timestamp seek handler (jumps video player to timestamp)
 *  - Copy to clipboard & error handling
 *
 * Edge cases covered:
 *  1.4.1 — Fallback to URL direct video analysis when no captions
 *  1.4.2 — Restricted/private video messaging
 *  1.4.3 — Livestream rejection notice
 *  1.4.4 — Long video transcript truncation warning
 *  1.4.8 — Missing video player error feedback toast
 *  1.4.9 — Auto-generated captions accuracy pill
 */

const SummaryView = (() => {
  let _container = null;
  let _isSummarizing = false;
  let _lastSummaryData = null;
  let _summaryRequestId = 0;
  let _isYouTubePage = false;
  let _currentTabUrl = '';

  /**
   * Render the Summary view into the target container.
   * @param {HTMLElement} container
   */
  function render(container) {
    _container = container;

    container.innerHTML = `
      <div class="page-summary-section">
        <div class="summary-section-header">
          <div class="summary-title-row">
            <h3 id="summary-main-heading" class="section-title">📄 Page Summary</h3>
            <span id="page-summary-status-badge" class="badge-tag">Checking page...</span>
          </div>
          <p id="summary-main-desc" class="section-desc">Extract the main article from the current tab and generate a structured 3-part brief.</p>
        </div>

        <!-- Page Preview Card -->
        <div id="page-preview-box" class="page-preview-box">
          <div class="page-preview-title" id="page-preview-title">Detecting active page...</div>
          <div class="page-preview-url" id="page-preview-url"></div>
        </div>

        <!-- Action Button Row -->
        <div class="page-summary-actions">
          <button id="btn-summarize-page" class="btn btn-primary btn-full">
            ⚡ Summarise This Page
          </button>
        </div>

        <!-- Feedback Toast for Timestamp Seek & Other Actions -->
        <div id="summary-feedback-toast" class="feedback-toast" style="display: none;"></div>

        <!-- Loading State -->
        <div id="summary-loading-area" class="loading-area" style="display: none;">
          <div class="loading-spinner"></div>
          <div class="loading-text-group">
            <span id="summary-loading-status" class="loading-text">Reading page content…</span>
            <span id="summary-loading-subtext" class="loading-subtext">Cleaned with Mozilla Readability</span>
          </div>
        </div>

        <!-- Error State -->
        <div id="summary-error-area" class="error-area" style="display: none;">
          <div id="summary-error-text" class="error-text"></div>
          <button id="btn-retry-summary" class="btn btn-secondary btn-sm">🔄 Retry</button>
        </div>

        <!-- Result Container -->
        <div id="summary-result-container" class="summary-result-container" style="display: none;">
          <!-- Content Metadata Banner -->
          <div class="article-meta-card">
            <h4 id="article-meta-title" class="article-meta-title"></h4>
            <div class="article-meta-details">
              <span id="article-meta-source" class="meta-item"></span>
              <span id="article-meta-words" class="meta-item"></span>
              <span id="article-meta-readtime" class="meta-item"></span>
            </div>
            <div id="article-warning-pill" class="warning-pill" style="display: none;"></div>
          </div>

          <!-- Structured Summary Content -->
          <div class="summary-content-card">
            <div class="summary-toolbar">
              <span id="summary-toolbar-label" class="toolbar-label">Structured Brief</span>
              <div class="toolbar-actions">
                <button id="btn-copy-summary" class="btn btn-secondary btn-sm" title="Copy entire summary">
                  📋 Copy
                </button>
                <button id="btn-clear-summary" class="btn btn-secondary btn-sm" title="Clear summary">
                  ✕
                </button>
              </div>
            </div>

            <div id="summary-sections-output" class="summary-sections-output"></div>

            <div class="summary-footer">
              <span id="summary-model-badge" class="model-badge"></span>
            </div>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    refreshActiveTabInfo();
  }

  function bindEvents() {
    const btnSummarize = _container.querySelector('#btn-summarize-page');
    const btnRetry = _container.querySelector('#btn-retry-summary');
    const btnCopy = _container.querySelector('#btn-copy-summary');
    const btnClear = _container.querySelector('#btn-clear-summary');

    btnSummarize.addEventListener('click', () => handleSummarize());
    btnRetry.addEventListener('click', () => handleSummarize());

    btnCopy.addEventListener('click', async () => {
      if (!_lastSummaryData) return;
      try {
        const textToCopy = formatSummaryForCopy(_lastSummaryData);
        await navigator.clipboard.writeText(textToCopy);
        btnCopy.textContent = '✅ Copied';
        btnCopy.classList.add('copied');
        setTimeout(() => {
          btnCopy.textContent = '📋 Copy';
          btnCopy.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.warn('[Sahayak] Clipboard write failed:', err);
      }
    });

    btnClear.addEventListener('click', () => {
      _lastSummaryData = null;
      _container.querySelector('#summary-result-container').style.display = 'none';
      _container.querySelector('#summary-error-area').style.display = 'none';
    });

    // Delegated click handler for timestamp seek buttons (Slice 1.4, Step 4)
    _container.addEventListener('click', async (e) => {
      const timestampBtn = e.target.closest('.timestamp-btn');
      if (!timestampBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const secondsStr = timestampBtn.dataset.seconds;
      if (secondsStr !== undefined && secondsStr !== null && !isNaN(Number(secondsStr))) {
        await seekVideo(Number(secondsStr), timestampBtn);
      }
    });

    // Notify user on language toggle change (Slice 1.5)
    window.addEventListener('sahayak:language-changed', (e) => {
      const newLang = e.detail?.language;
      const langName = newLang === 'hi-en' ? 'Hinglish' : 'English';
      showFeedbackToast(`🌐 Output language: ${langName}`);
    });
  }

  /**
   * Send seek request to content script to update video currentTime.
   * Handles edge case 1.4.8 (video player not found or navigated away).
   */
  async function seekVideo(seconds, btnEl) {
    if (btnEl) btnEl.classList.add('seeking');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEEK_VIDEO',
        payload: { seconds }
      });

      if (btnEl) btnEl.classList.remove('seeking');

      if (response && response.success) {
        if (btnEl) {
          btnEl.classList.add('jump-success');
          setTimeout(() => btnEl.classList.remove('jump-success'), 1200);
        }
        showFeedbackToast(`▶ Jumped to ${formatSecondsToDisplay(seconds)}`);
      } else {
        const errMsg = response?.error?.message || 'Could not find the video player on this page.';
        showFeedbackToast(`⚠️ ${errMsg}`);
      }
    } catch (err) {
      if (btnEl) btnEl.classList.remove('seeking');
      showFeedbackToast('⚠️ Lost connection to video player. Please refresh the page.');
    }
  }

  /**
   * Display a non-intrusive floating feedback toast.
   */
  function showFeedbackToast(message) {
    const toast = _container.querySelector('#summary-feedback-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.style.display = 'block';
    toast.classList.remove('toast-fadeout');

    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.add('toast-fadeout');
      setTimeout(() => {
        toast.style.display = 'none';
        toast.classList.remove('toast-fadeout');
      }, 300);
    }, 2400);
  }

  /**
   * Check active tab details and update preview box & buttons.
   */
  async function refreshActiveTabInfo() {
    if (!_container) return;

    const titleEl = _container.querySelector('#page-preview-title');
    const urlEl = _container.querySelector('#page-preview-url');
    const badgeEl = _container.querySelector('#page-summary-status-badge');
    const btnSummarize = _container.querySelector('#btn-summarize-page');
    const headingEl = _container.querySelector('#summary-main-heading');
    const descEl = _container.querySelector('#summary-main-desc');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' });
      if (response && response.success && response.data) {
        const tab = response.data;
        _currentTabUrl = tab.url || '';
        titleEl.textContent = tab.title || 'Untitled Tab';
        urlEl.textContent = tab.url || '';

        if (tab.isRestricted) {
          _isYouTubePage = false;
          headingEl.textContent = '📄 Page Summary';
          descEl.textContent = 'Extract the main article from the current tab and generate a structured brief.';
          badgeEl.textContent = 'Restricted Page';
          badgeEl.className = 'badge-tag badge-warning';
          btnSummarize.disabled = true;
          btnSummarize.textContent = '⚡ Summarise This Page';
          btnSummarize.title = 'Cannot summarise browser-internal or Web Store pages';
        } else if (tab.isYouTube) {
          // YouTube Video Mode
          _isYouTubePage = true;
          headingEl.textContent = '📺 Video Summary';
          descEl.textContent = 'Extract timed captions and generate chapter notes with clickable timestamps.';
          badgeEl.textContent = 'Ready to Summarise';
          badgeEl.className = 'badge-tag badge-info';
          btnSummarize.disabled = false;
          btnSummarize.textContent = '⚡ Summarise Video';
          btnSummarize.title = '';
        } else {
          // Regular Web Page Mode
          _isYouTubePage = false;
          headingEl.textContent = '📄 Page Summary';
          descEl.textContent = 'Extract the main article from the current tab and generate a structured 3-part brief.';
          badgeEl.textContent = 'Ready to Read';
          badgeEl.className = 'badge-tag badge-success';
          btnSummarize.disabled = false;
          btnSummarize.textContent = '⚡ Summarise This Page';
          btnSummarize.title = '';
        }
      }
    } catch (err) {
      titleEl.textContent = 'Active tab unavailable';
      urlEl.textContent = '';
      badgeEl.textContent = 'Disconnected';
      badgeEl.className = 'badge-tag badge-warning';
    }
  }

  /**
   * Run full summarisation flow (article or YouTube video).
   */
  async function handleSummarize() {
    if (_isSummarizing) return;

    const btnSummarize = _container.querySelector('#btn-summarize-page');
    const loadingArea = _container.querySelector('#summary-loading-area');
    const loadingStatus = _container.querySelector('#summary-loading-status');
    const loadingSubtext = _container.querySelector('#summary-loading-subtext');
    const errorArea = _container.querySelector('#summary-error-area');
    const errorText = _container.querySelector('#summary-error-text');
    const resultContainer = _container.querySelector('#summary-result-container');

    _isSummarizing = true;
    const thisRequestId = ++_summaryRequestId;

    btnSummarize.disabled = true;
    errorArea.style.display = 'none';
    resultContainer.style.display = 'none';
    loadingArea.style.display = 'flex';

    if (_isYouTubePage) {
      btnSummarize.textContent = '⏳ Reading Video Captions…';
      loadingStatus.textContent = 'Extracting timed captions…';
      loadingSubtext.textContent = 'Fetching YouTube transcript tracks';
    } else {
      btnSummarize.textContent = '⏳ Reading & Summarising…';
      loadingStatus.textContent = 'Extracting article with Readability…';
      loadingSubtext.textContent = 'Cleaned with Mozilla Readability';
    }

    // Progress update simulation
    const progressTimer = setTimeout(() => {
      if (thisRequestId === _summaryRequestId && _isSummarizing) {
        if (_isYouTubePage) {
          loadingStatus.textContent = 'Generating chapter notes with timestamps…';
        } else {
          loadingStatus.textContent = 'Generating structured summary…';
        }
      }
    }, 1200);

    try {
      const currentLanguage = window.SahayakApp ? window.SahayakApp.getCurrentLanguage() : 'en';

      let response;
      if (_isYouTubePage) {
        response = await chrome.runtime.sendMessage({
          type: 'SUMMARIZE_YOUTUBE',
          payload: { videoUrl: _currentTabUrl, language: currentLanguage }
        });
      } else {
        response = await chrome.runtime.sendMessage({
          type: 'SUMMARIZE_PAGE',
          payload: { language: currentLanguage }
        });
      }

      clearTimeout(progressTimer);

      if (thisRequestId !== _summaryRequestId) return; // Stale request check

      if (response && response.success) {
        _lastSummaryData = response.data;
        displaySummary(response.data);
      } else {
        const errorMsg = response?.error?.message || 'Could not summarise this content.';
        errorText.textContent = errorMsg;
        errorArea.style.display = 'flex';
      }
    } catch (err) {
      clearTimeout(progressTimer);
      if (thisRequestId !== _summaryRequestId) return;
      errorText.textContent = 'Could not contact the extension service. Please reload the extension.';
      errorArea.style.display = 'flex';
    } finally {
      if (thisRequestId === _summaryRequestId) {
        _isSummarizing = false;
        loadingArea.style.display = 'none';
        btnSummarize.disabled = false;
        btnSummarize.textContent = _isYouTubePage ? '⚡ Summarise Video' : '⚡ Summarise This Page';
      }
    }
  }

  /**
   * Render the structured summary and metadata.
   */
  function displaySummary(data) {
    const resultContainer = _container.querySelector('#summary-result-container');
    const titleEl = _container.querySelector('#article-meta-title');
    const sourceEl = _container.querySelector('#article-meta-source');
    const wordsEl = _container.querySelector('#article-meta-words');
    const readTimeEl = _container.querySelector('#article-meta-readtime');
    const warningPill = _container.querySelector('#article-warning-pill');
    const outputEl = _container.querySelector('#summary-sections-output');
    const modelBadge = _container.querySelector('#summary-model-badge');
    const toolbarLabel = _container.querySelector('#summary-toolbar-label');

    const isVideo = Boolean(data.video);

    if (isVideo) {
      const video = data.video || {};
      titleEl.textContent = video.title || 'YouTube Video';
      sourceEl.textContent = video.author ? `📺 ${video.author}` : '📺 YouTube';
      wordsEl.textContent = video.hasCaptions ? '📜 Captions Extracted' : '🎥 Direct Video Analysis';
      readTimeEl.textContent = '';
      toolbarLabel.textContent = 'Video Chapter Notes';

      // YouTube-specific warning pills
      if (video.isAutoGenerated) {
        warningPill.textContent = 'ℹ️ Note: Summary is based on auto-generated captions.';
        warningPill.style.display = 'block';
      } else if (video.isTruncated) {
        warningPill.textContent = 'ℹ️ Long video: Summary covers the first portion of the transcript.';
        warningPill.style.display = 'block';
      } else if (video.usedDirectUrl) {
        warningPill.textContent = 'ℹ️ No captions found; processed via Gemini direct video analysis.';
        warningPill.style.display = 'block';
      } else {
        warningPill.style.display = 'none';
      }
    } else {
      const article = data.article || {};
      titleEl.textContent = article.title || 'Extracted Article';
      sourceEl.textContent = article.siteName ? `🌐 ${article.siteName}` : '';
      toolbarLabel.textContent = 'Structured Brief';

      if (article.wordCount) {
        wordsEl.textContent = `📝 ~${article.wordCount.toLocaleString()} words`;
        const mins = Math.max(1, Math.ceil(article.wordCount / 220));
        readTimeEl.textContent = `⏱️ ${mins} min read`;
      } else {
        wordsEl.textContent = '';
        readTimeEl.textContent = '';
      }

      if (article.paywallWarning) {
        warningPill.textContent = `⚠️ ${article.paywallWarning}`;
        warningPill.style.display = 'block';
      } else if (article.isTruncated) {
        warningPill.textContent = 'ℹ️ Long article: Extracted the first ~20,000 words.';
        warningPill.style.display = 'block';
      } else {
        warningPill.style.display = 'none';
      }
    }

    // Format Markdown into beautiful styled HTML sections
    outputEl.innerHTML = parseSummaryMarkdown(data.summary, isVideo);

    // Model badge (Edge case 2.4.5: Indicate fallback model if active)
    const backupText = data.isFallback ? ' · 🔄 Backup model' : '';
    modelBadge.textContent = `⚡ ${data.model || 'Gemini'}${backupText}`;

    resultContainer.style.display = 'block';
    resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Parse markdown response into styled HTML elements.
   * Handles both article and YouTube chapter outputs.
   */
  function parseSummaryMarkdown(rawText, isVideo = false) {
    if (!rawText) return '<p>No summary generated.</p>';

    const sanitized = escapeHtml(rawText);
    const sections = sanitized.split(/^##\s+/m);
    let htmlOutput = '';

    sections.forEach((sec) => {
      const trimmed = sec.trim();
      if (!trimmed) return;

      const lines = trimmed.split('\n');
      const headerTitle = lines[0].trim();
      const contentLines = lines.slice(1).join('\n').trim();
      const normalizedHeader = headerTitle.toLowerCase();

      if (normalizedHeader.includes('tl;dr') || normalizedHeader.includes('tldr')) {
        htmlOutput += `
          <div class="summary-section-block tldr-block">
            <div class="section-badge-header">💡 TL;DR</div>
            <div class="tldr-text">${formatInlineMarkdown(contentLines)}</div>
          </div>
        `;
      } else if (
        normalizedHeader.includes('chapter') ||
        normalizedHeader.includes('timestamp') ||
        normalizedHeader.includes('timeline')
      ) {
        // Chapters & Timestamps Block
        htmlOutput += `
          <div class="summary-section-block chapters-block">
            <div class="section-badge-header">⏱️ Chapters &amp; Timestamps</div>
            <div class="chapters-list">${formatChaptersList(contentLines)}</div>
          </div>
        `;
      } else if (normalizedHeader.includes('key point') || normalizedHeader.includes('points')) {
        htmlOutput += `
          <div class="summary-section-block keypoints-block">
            <div class="section-badge-header">📌 5 Key Points</div>
            <div class="points-list">${formatNumberedList(contentLines)}</div>
          </div>
        `;
      } else if (normalizedHeader.includes('takeaway') || normalizedHeader.includes('key takeaway')) {
        htmlOutput += `
          <div class="summary-section-block keypoints-block">
            <div class="section-badge-header">🎯 Key Takeaways</div>
            <div class="points-list">${formatNumberedList(contentLines)}</div>
          </div>
        `;
      } else if (normalizedHeader.includes('next') || normalizedHeader.includes('what to do')) {
        htmlOutput += `
          <div class="summary-section-block nextsteps-block">
            <div class="section-badge-header">🎯 What To Do Next</div>
            <div class="next-steps-list">${formatBulletOrNumberedList(contentLines)}</div>
          </div>
        `;
      } else {
        htmlOutput += `
          <div class="summary-section-block generic-block">
            <div class="section-badge-header">📝 ${headerTitle}</div>
            <div class="generic-text">${formatInlineMarkdown(contentLines)}</div>
          </div>
        `;
      }
    });

    if (!htmlOutput) {
      htmlOutput = `<div class="summary-raw-text">${formatInlineMarkdown(sanitized)}</div>`;
    }

    return htmlOutput;
  }

  /**
   * Format YouTube chapters list with clickable timestamp buttons.
   */
  function formatChaptersList(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];

    lines.forEach((line) => {
      // Remove leading bullets or numbers: "- ", "* ", "1. "
      let cleaned = line.replace(/^(\d+[\.\)]|\-|\*)\s*/, '');

      // Check for timestamp patterns:
      // Pattern 1: [MM:SS](URL?t=Ns) or [HH:MM:SS](URL?t=Ns)
      const linkMatch = cleaned.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]\([^\)]*?[?&]t=(\d+)s?[^\)]*\)/);
      // Pattern 2: [MM:SS](URL) without explicit t parameter
      const genericLinkMatch = !linkMatch && cleaned.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]\([^\)]*\)/);
      // Pattern 3: [MM:SS] or [HH:MM:SS]
      const bracketMatch = !linkMatch && !genericLinkMatch && cleaned.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
      // Pattern 4: Plain start MM:SS
      const plainMatch = !linkMatch && !genericLinkMatch && !bracketMatch && cleaned.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\b/);

      let timeText = null;
      let seconds = null;
      let matchedSpan = '';

      if (linkMatch) {
        timeText = linkMatch[1];
        seconds = parseInt(linkMatch[2], 10);
        matchedSpan = linkMatch[0];
      } else if (genericLinkMatch) {
        timeText = genericLinkMatch[1];
        seconds = timeStringToSeconds(timeText);
        matchedSpan = genericLinkMatch[0];
      } else if (bracketMatch) {
        timeText = bracketMatch[1];
        seconds = timeStringToSeconds(timeText);
        matchedSpan = bracketMatch[0];
      } else if (plainMatch) {
        timeText = plainMatch[1];
        seconds = timeStringToSeconds(timeText);
        matchedSpan = plainMatch[0];
      }

      if (timeText && seconds !== null) {
        const remainingText = cleaned.replace(matchedSpan, '').trim();
        const formattedDesc = formatInlineMarkdown(remainingText);

        items.push(`
          <div class="chapter-item">
            <button type="button" class="timestamp-btn" data-seconds="${seconds}" title="Jump video to ${timeText}">
              <span class="play-icon">▶</span> ${timeText}
            </button>
            <div class="chapter-desc">${formattedDesc}</div>
          </div>
        `);
      } else if (cleaned) {
        // Fallback for lines without detectable timestamps
        items.push(`
          <div class="chapter-item chapter-plain">
            <div class="chapter-desc">${formatInlineMarkdown(cleaned)}</div>
          </div>
        `);
      }
    });

    if (items.length > 0) {
      return `<div class="chapters-container">${items.join('')}</div>`;
    }
    return `<p>${formatInlineMarkdown(text)}</p>`;
  }

  function formatNumberedList(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];

    lines.forEach(line => {
      const cleaned = line.replace(/^(\d+[\.\)]|\-|\*)\s*/, '');
      if (cleaned) {
        items.push(`<li class="point-item">${formatInlineMarkdown(cleaned)}</li>`);
      }
    });

    if (items.length > 0) {
      return `<ol class="summary-ordered-list">${items.join('')}</ol>`;
    }
    return `<p>${formatInlineMarkdown(text)}</p>`;
  }

  function formatBulletOrNumberedList(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];

    lines.forEach(line => {
      const cleaned = line.replace(/^(\d+[\.\)]|\-|\*)\s*/, '');
      if (cleaned) {
        items.push(`<li class="step-item">${formatInlineMarkdown(cleaned)}</li>`);
      }
    });

    if (items.length > 0) {
      return `<ul class="summary-bullet-list">${items.join('')}</ul>`;
    }
    return `<p>${formatInlineMarkdown(text)}</p>`;
  }

  function formatInlineMarkdown(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Convert MM:SS or HH:MM:SS to total integer seconds.
   */
  function timeStringToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }

  /**
   * Convert seconds back to friendly display string.
   */
  function formatSecondsToDisplay(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function formatSummaryForCopy(data) {
    if (data.video) {
      const vid = data.video;
      return [
        `📺 ${vid.title || 'YouTube Video Summary'}`,
        vid.author ? `Creator: ${vid.author}` : '',
        vid.url ? `URL: ${vid.url}` : '',
        '',
        data.summary,
        '',
        `Generated by Sahayak (${data.model || 'Gemini'})`
      ].filter(Boolean).join('\n');
    }

    const art = data.article || {};
    return [
      `📄 ${art.title || 'Page Summary'}`,
      art.siteName ? `Source: ${art.siteName}` : '',
      art.url ? `URL: ${art.url}` : '',
      '',
      data.summary,
      '',
      `Generated by Sahayak (${data.model || 'Gemini'})`
    ].filter(Boolean).join('\n');
  }

  return {
    render,
    refreshActiveTabInfo,
    handleSummarize
  };
})();

// Export globally
globalThis.SummaryView = SummaryView;
