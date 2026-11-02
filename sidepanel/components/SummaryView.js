/**
 * Sahayak — SummaryView Component
 *
 * Manages the "Page Summary" interface in the Summary tab:
 *  - Active tab detection & status
 *  - Triggering SUMMARIZE_PAGE
 *  - Loading states & progress indications
 *  - Structured display (TL;DR, Key Points, What To Do Next)
 *  - Copy to clipboard & error handling
 */

const SummaryView = (() => {
  let _container = null;
  let _isSummarizing = false;
  let _lastSummaryData = null;
  let _summaryRequestId = 0;

  /**
   * Render the Page Summary view into the target container.
   * @param {HTMLElement} container
   */
  function render(container) {
    _container = container;

    container.innerHTML = `
      <div class="page-summary-section">
        <div class="summary-section-header">
          <div class="summary-title-row">
            <h3 class="section-title">📄 Page Summary</h3>
            <span id="page-summary-status-badge" class="badge-tag">Checking page...</span>
          </div>
          <p class="section-desc">Extract the main article from the current tab and generate a structured 3-part brief.</p>
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

        <!-- Loading State -->
        <div id="summary-loading-area" class="loading-area" style="display: none;">
          <div class="loading-spinner"></div>
          <div class="loading-text-group">
            <span id="summary-loading-status" class="loading-text">Reading page content…</span>
            <span class="loading-subtext">Cleaned with Mozilla Readability</span>
          </div>
        </div>

        <!-- Error State -->
        <div id="summary-error-area" class="error-area" style="display: none;">
          <div id="summary-error-text" class="error-text"></div>
          <button id="btn-retry-summary" class="btn btn-secondary btn-sm">🔄 Retry</button>
        </div>

        <!-- Result Container -->
        <div id="summary-result-container" class="summary-result-container" style="display: none;">
          <!-- Article Metadata Banner -->
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
              <span class="toolbar-label">Structured Brief</span>
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
  }

  /**
   * Check active tab details and update preview box.
   */
  async function refreshActiveTabInfo() {
    if (!_container) return;

    const titleEl = _container.querySelector('#page-preview-title');
    const urlEl = _container.querySelector('#page-preview-url');
    const badgeEl = _container.querySelector('#page-summary-status-badge');
    const btnSummarize = _container.querySelector('#btn-summarize-page');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' });
      if (response && response.success && response.data) {
        const tab = response.data;
        titleEl.textContent = tab.title || 'Untitled Tab';
        urlEl.textContent = tab.url || '';

        if (tab.isRestricted) {
          badgeEl.textContent = 'Restricted Page';
          badgeEl.className = 'badge-tag badge-warning';
          btnSummarize.disabled = true;
          btnSummarize.title = 'Cannot summarise browser-internal or Web Store pages';
        } else {
          badgeEl.textContent = 'Ready to Read';
          badgeEl.className = 'badge-tag badge-success';
          btnSummarize.disabled = false;
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
   * Run full summarisation flow.
   */
  async function handleSummarize() {
    if (_isSummarizing) return;

    const btnSummarize = _container.querySelector('#btn-summarize-page');
    const loadingArea = _container.querySelector('#summary-loading-area');
    const loadingStatus = _container.querySelector('#summary-loading-status');
    const errorArea = _container.querySelector('#summary-error-area');
    const errorText = _container.querySelector('#summary-error-text');
    const resultContainer = _container.querySelector('#summary-result-container');

    _isSummarizing = true;
    const thisRequestId = ++_summaryRequestId;

    btnSummarize.disabled = true;
    btnSummarize.textContent = '⏳ Reading & Summarising…';
    loadingArea.style.display = 'flex';
    loadingStatus.textContent = 'Extracting article with Readability…';
    errorArea.style.display = 'none';
    resultContainer.style.display = 'none';

    // Simulate progress updates for user feedback
    const progressTimer = setTimeout(() => {
      if (thisRequestId === _summaryRequestId && _isSummarizing) {
        loadingStatus.textContent = 'Generating structured summary…';
      }
    }, 1200);

    try {
      const currentLanguage = window.SahayakApp ? window.SahayakApp.getCurrentLanguage() : 'en';

      const response = await chrome.runtime.sendMessage({
        type: 'SUMMARIZE_PAGE',
        payload: { language: currentLanguage }
      });

      clearTimeout(progressTimer);

      if (thisRequestId !== _summaryRequestId) return; // Stale request check

      if (response && response.success) {
        _lastSummaryData = response.data;
        displaySummary(response.data);
      } else {
        const errorMsg = response?.error?.message || 'Could not summarise this page.';
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
        btnSummarize.textContent = '⚡ Summarise This Page';
      }
    }
  }

  /**
   * Render the summary and article metadata.
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

    const article = data.article || {};

    titleEl.textContent = article.title || 'Extracted Article';
    sourceEl.textContent = article.siteName ? `🌐 ${article.siteName}` : '';
    
    if (article.wordCount) {
      wordsEl.textContent = `📝 ~${article.wordCount.toLocaleString()} words`;
      const mins = Math.max(1, Math.ceil(article.wordCount / 220));
      readTimeEl.textContent = `⏱️ ${mins} min read`;
    } else {
      wordsEl.textContent = '';
      readTimeEl.textContent = '';
    }

    // Warnings (paywall or truncated)
    if (article.paywallWarning) {
      warningPill.textContent = `⚠️ ${article.paywallWarning}`;
      warningPill.style.display = 'block';
    } else if (article.isTruncated) {
      warningPill.textContent = 'ℹ️ Long article: Extracted the first ~20,000 words.';
      warningPill.style.display = 'block';
    } else {
      warningPill.style.display = 'none';
    }

    // Format Markdown into beautiful HTML sections
    outputEl.innerHTML = parseSummaryMarkdown(data.summary);

    // Model badge
    modelBadge.textContent = `⚡ ${data.model || 'Gemini'}`;

    resultContainer.style.display = 'block';

    // Smooth scroll into view
    resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Safely parse structured markdown response into styled HTML elements.
   * Recognises:
   *  ## TL;DR
   *  ## Key Points
   *  ## What To Do Next
   */
  function parseSummaryMarkdown(rawText) {
    if (!rawText) return '<p>No summary generated.</p>';

    // Sanitize HTML entities
    const sanitized = escapeHtml(rawText);

    // Split markdown into headings
    const sections = sanitized.split(/^##\s+/m);
    let htmlOutput = '';

    sections.forEach((sec, index) => {
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
      } else if (normalizedHeader.includes('key point') || normalizedHeader.includes('points')) {
        htmlOutput += `
          <div class="summary-section-block keypoints-block">
            <div class="section-badge-header">📌 5 Key Points</div>
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
        // Fallback for any other section
        htmlOutput += `
          <div class="summary-section-block generic-block">
            <div class="section-badge-header">📝 ${headerTitle}</div>
            <div class="generic-text">${formatInlineMarkdown(contentLines)}</div>
          </div>
        `;
      }
    });

    // If no headings were matched, display clean converted text
    if (!htmlOutput) {
      htmlOutput = `<div class="summary-raw-text">${formatInlineMarkdown(sanitized)}</div>`;
    }

    return htmlOutput;
  }

  function formatNumberedList(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = [];

    lines.forEach(line => {
      // Remove leading number like "1. ", "1) ", or "- "
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

  function formatSummaryForCopy(data) {
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

