/**
 * Sahayak — Agent View Component (Slice 3.3)
 *
 * Provides:
 * - "Find It For Me" natural-language element finder
 * - Interactive badge overlay toggles (Show Badges / Clear Badges)
 * - Result card displaying matched element ID, tag, text, and AI reasoning
 * - Highlight trigger button
 */

(function () {
  'use strict';

  let containerEl = null;
  let lastMatchedElementId = null;
  let isSearching = false;

  /**
   * Render the Agent View into the given container element.
   * @param {HTMLElement} container
   */
  function render(container) {
    containerEl = container;
    container.innerHTML = `
      <div class="agent-view">
        <!-- ── Section: Overlay Controls ────────────────────────────── -->
        <div class="agent-card">
          <div class="agent-card-header">
            <h3 class="section-title">🏷️ Page Interactive Elements</h3>
            <span id="agent-element-count" class="element-count-badge" style="display: none;">0 elements</span>
          </div>
          <p class="section-desc">
            Toggle numbered badges directly on the active webpage to see all interactive elements.
          </p>
          <div class="agent-toolbar">
            <button id="btn-show-badges" class="btn btn-primary btn-sm" title="Scan and display numbered badges on the page">
              👁️ Show Badges
            </button>
            <button id="btn-clear-badges" class="btn btn-secondary btn-sm" title="Remove all badges from the page">
              ✕ Clear Badges
            </button>
            <button id="btn-rescan-page" class="btn btn-secondary btn-sm" title="Re-scan the current page">
              🔄 Scan Page
            </button>
          </div>
          <div id="agent-scan-status" class="agent-status-text" style="display: none;"></div>
        </div>

        <!-- ── Section: Find It For Me (Slice 3.3) ────────────────────── -->
        <div class="agent-card find-element-card">
          <div class="agent-card-header">
            <h3 class="section-title">🔍 Find It For Me</h3>
            <span class="feature-tag">AI Powered</span>
          </div>
          <p class="section-desc">
            Ask where any button, form input, or link is, and Sahayak will locate and highlight it on the page.
          </p>

          <form id="find-element-form" class="find-element-form">
            <div class="find-input-group">
              <input
                type="text"
                id="find-element-input"
                class="form-input find-input"
                placeholder="e.g. Where do I upload my resume? or Where do I search?"
                maxlength="200"
                autocomplete="off"
              />
              <button type="submit" id="btn-find-submit" class="btn btn-primary" title="Search for element">
                <span id="find-btn-text">Find</span>
              </button>
            </div>
          </form>

          <!-- Quick query suggestions -->
          <div class="find-query-chips">
            <span class="chips-label">Quick suggestions:</span>
            <div class="chips-wrapper">
              <button class="find-chip" type="button" data-query="Where do I search?">Where do I search?</button>
              <button class="find-chip" type="button" data-query="Where is the submit button?">Submit button</button>
              <button class="find-chip" type="button" data-query="Where do I sign in or login?">Sign in / Login</button>
              <button class="find-chip" type="button" data-query="Where do I upload my resume?">Upload resume</button>
            </div>
          </div>

          <!-- Loading State -->
          <div id="find-loading" class="loading-area" style="display: none;">
            <div class="loading-spinner"></div>
            <span class="loading-text">Scanning page & locating element…</span>
          </div>

          <!-- Result Area -->
          <div id="find-result" class="result-area find-result-card" style="display: none;">
            <div class="result-header">
              <div class="find-result-title-group">
                <span id="find-badge-pill" class="find-badge-pill">#1</span>
                <span id="find-element-name" class="find-element-name">Button</span>
              </div>
              <div class="result-actions">
                <button id="btn-rehighlight" class="btn btn-secondary btn-sm" title="Highlight this element again">
                  ✨ Highlight
                </button>
                <button id="btn-close-find-result" class="btn btn-secondary btn-sm" title="Dismiss result">
                  ✕
                </button>
              </div>
            </div>
            <div id="find-result-reasoning" class="find-result-reasoning"></div>
            <div class="find-result-meta">
              <span id="find-model-badge" class="model-badge"></span>
            </div>
          </div>

          <!-- Error / Not Found Area -->
          <div id="find-error" class="error-area" style="display: none;">
            <div id="find-error-text" class="error-text"></div>
          </div>
        </div>

        <!-- ── Section: Automated Browser Actions (Slice 3.4 placeholder) ── -->
        <div class="agent-card coming-soon-card">
          <div class="agent-card-header">
            <h3 class="section-title">⚡ Browser Actions (Autonomous Loop)</h3>
            <span class="badge-soon">Coming in Slice 3.4</span>
          </div>
          <p class="section-desc">
            Give Sahayak complex form-filling or navigation goals. It will propose each step with approval cards before acting.
          </p>
        </div>
      </div>
    `;

    bindEvents();
  }

  /**
   * Bind DOM event listeners.
   */
  function bindEvents() {
    if (!containerEl) return;

    const btnShowBadges = containerEl.querySelector('#btn-show-badges');
    const btnClearBadges = containerEl.querySelector('#btn-clear-badges');
    const btnRescan = containerEl.querySelector('#btn-rescan-page');
    const findForm = containerEl.querySelector('#find-element-form');
    const findInput = containerEl.querySelector('#find-element-input');
    const btnRehighlight = containerEl.querySelector('#btn-rehighlight');
    const btnCloseResult = containerEl.querySelector('#btn-close-find-result');
    const chipButtons = containerEl.querySelectorAll('.find-chip');

    // Show badges
    if (btnShowBadges) {
      btnShowBadges.addEventListener('click', async () => {
        showStatus('Scanning and displaying badges…');
        try {
          const scanRes = await chrome.runtime.sendMessage({ type: 'SCAN_ELEMENTS' });
          if (scanRes && scanRes.success && scanRes.data) {
            updateElementCount(scanRes.data.totalElements);
          }
          const badgeRes = await chrome.runtime.sendMessage({ type: 'SHOW_BADGES' });
          if (badgeRes && badgeRes.success) {
            showStatus(`✓ Numbered badges displayed (${badgeRes.count || 0} elements).`, 'success');
          } else {
            showStatus(badgeRes?.error?.message || 'Could not show badges.', 'error');
          }
        } catch (err) {
          showStatus(err.message || 'Failed to communicate with page.', 'error');
        }
      });
    }

    // Clear badges
    if (btnClearBadges) {
      btnClearBadges.addEventListener('click', async () => {
        try {
          await chrome.runtime.sendMessage({ type: 'CLEAR_BADGES' });
          showStatus('✓ Badges cleared.', 'info');
        } catch (err) {
          showStatus(err.message || 'Could not clear badges.', 'error');
        }
      });
    }

    // Scan page
    if (btnRescan) {
      btnRescan.addEventListener('click', async () => {
        showStatus('Scanning page elements…');
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SCAN_ELEMENTS' });
          if (res && res.success && res.data) {
            updateElementCount(res.data.totalElements);
            showStatus(`✓ Found ${res.data.totalElements} interactive elements.`, 'success');
          } else {
            showStatus(res?.error?.message || 'Scan failed.', 'error');
          }
        } catch (err) {
          showStatus(err.message || 'Could not scan page.', 'error');
        }
      });
    }

    // Find Element Form Submit
    if (findForm) {
      findForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = findInput.value.trim();
        if (!query) {
          findInput.focus();
          return;
        }
        executeFindElement(query);
      });
    }

    // Quick suggestion chips
    chipButtons.forEach((chip) => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (query && findInput) {
          findInput.value = query;
          executeFindElement(query);
        }
      });
    });

    // Re-highlight button
    if (btnRehighlight) {
      btnRehighlight.addEventListener('click', async () => {
        if (!lastMatchedElementId) return;
        try {
          await chrome.runtime.sendMessage({
            type: 'HIGHLIGHT_ELEMENT',
            payload: { elementId: lastMatchedElementId }
          });
        } catch (err) {
          console.warn('[AgentView] Could not re-highlight:', err);
        }
      });
    }

    // Close result card
    if (btnCloseResult) {
      btnCloseResult.addEventListener('click', () => {
        const resultCard = containerEl.querySelector('#find-result');
        if (resultCard) resultCard.style.display = 'none';
      });
    }
  }

  /**
   * Executes the natural-language element search.
   * @param {string} query
   */
  async function executeFindElement(query) {
    if (isSearching || !containerEl) return;
    isSearching = true;

    const findInput = containerEl.querySelector('#find-element-input');
    const btnSubmit = containerEl.querySelector('#btn-find-submit');
    const loadingArea = containerEl.querySelector('#find-loading');
    const resultArea = containerEl.querySelector('#find-result');
    const errorArea = containerEl.querySelector('#find-error');
    const errorText = containerEl.querySelector('#find-error-text');

    // UI state: loading
    if (findInput) findInput.disabled = true;
    if (btnSubmit) btnSubmit.disabled = true;
    if (loadingArea) loadingArea.style.display = 'flex';
    if (resultArea) resultArea.style.display = 'none';
    if (errorArea) errorArea.style.display = 'none';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FIND_ELEMENT',
        payload: { query }
      });

      if (!response || !response.success) {
        const errMsg = response?.error?.message || 'Could not search elements on this page.';
        showError(errMsg);
        return;
      }

      const data = response.data;
      if (data && data.found && data.elementId) {
        lastMatchedElementId = data.elementId;
        displayFoundResult(data);
      } else {
        lastMatchedElementId = null;
        showError(data?.reasoning || 'Could not find a matching element on this page.');
      }
    } catch (err) {
      console.error('[AgentView] Find element error:', err);
      showError(err.message || 'An unexpected error occurred while searching for the element.');
    } finally {
      isSearching = false;
      if (findInput) findInput.disabled = false;
      if (btnSubmit) btnSubmit.disabled = false;
      if (loadingArea) loadingArea.style.display = 'none';
    }
  }

  /**
   * Displays the successfully found element result card.
   * @param {Object} data
   */
  function displayFoundResult(data) {
    if (!containerEl) return;

    const resultArea = containerEl.querySelector('#find-result');
    const badgePill = containerEl.querySelector('#find-badge-pill');
    const elementName = containerEl.querySelector('#find-element-name');
    const reasoningEl = containerEl.querySelector('#find-result-reasoning');
    const modelBadge = containerEl.querySelector('#find-model-badge');

    if (badgePill) {
      badgePill.textContent = `#${data.elementId}`;
    }

    if (elementName) {
      const el = data.element || {};
      const label = el.text || el.placeholder || el.name || el.value || el.tag || 'Element';
      const tag = (el.tag || '').toLowerCase();
      elementName.textContent = `"${label}" (${tag})`;
    }

    if (reasoningEl) {
      reasoningEl.textContent = data.reasoning || `Element #${data.elementId} matches your query.`;
    }

    if (modelBadge) {
      modelBadge.textContent = data.model ? `via ${data.model}` : '';
      modelBadge.style.display = data.model ? 'inline-block' : 'none';
    }

    if (resultArea) {
      resultArea.style.display = 'block';
    }
  }

  /**
   * Shows error or not-found card.
   * @param {string} msg
   */
  function showError(msg) {
    if (!containerEl) return;
    const errorArea = containerEl.querySelector('#find-error');
    const errorText = containerEl.querySelector('#find-error-text');
    if (errorText) errorText.textContent = msg;
    if (errorArea) errorArea.style.display = 'block';
  }

  /**
   * Updates element count badge in toolbar.
   * @param {number} count
   */
  function updateElementCount(count) {
    if (!containerEl) return;
    const badge = containerEl.querySelector('#agent-element-count');
    if (badge) {
      badge.textContent = `${count} elements`;
      badge.style.display = 'inline-block';
    }
  }

  /**
   * Shows temporary status message below toolbar.
   * @param {string} msg
   * @param {'info'|'success'|'error'} [type='info']
   */
  function showStatus(msg, type = 'info') {
    if (!containerEl) return;
    const statusEl = containerEl.querySelector('#agent-scan-status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `agent-status-text agent-status-${type}`;
    statusEl.style.display = 'block';

    setTimeout(() => {
      if (statusEl.textContent === msg) {
        statusEl.style.display = 'none';
      }
    }, 4000);
  }

  // Export globally in sidepanel scope
  window.AgentView = {
    render,
    executeFindElement
  };
})();

