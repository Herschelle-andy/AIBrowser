/**
 * Sahayak Side Panel — Main Application Controller
 *
 * Handles:
 *  - Tab navigation switching
 *  - Language toggle persistence
 *  - Settings modal open/close
 *  - API key banner visibility
 *  - Active tab info polling
 */

(function () {
  'use strict';

  // ── DOM References ──────────────────────────────────────────────────
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const btnSettings = document.getElementById('btn-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const settingsModal = document.getElementById('settings-modal');
  const settingsContainer = document.getElementById('settings-container');
  const apiKeyBanner = document.getElementById('api-key-banner');
  const bannerSettingsBtn = document.getElementById('banner-settings-btn');
  const langBtnEn = document.getElementById('btn-lang-en');
  const langBtnHi = document.getElementById('btn-lang-hi');

  // ── State ───────────────────────────────────────────────────────────
  let currentTab = 'summary';
  let currentLanguage = 'en';
  let explainRequestId = 0;   // Monotonic counter to discard stale responses (edge case 1.2.7)
  let isExplainPending = false;

  // ── Initialise ──────────────────────────────────────────────────────
  async function init() {
    setupTabNavigation();
    setupSettingsModal();
    setupLanguageToggle();
    setupExplainText();

    // Render the settings view into the modal container
    SettingsView.render(settingsContainer);

    // Render the page summary view (Slice 1.3)
    const pageSummaryContainer = document.getElementById('page-summary-container');
    if (pageSummaryContainer && window.SummaryView) {
      SummaryView.render(pageSummaryContainer);
    }

    // Render the grounded chat view (Slice 2.1)
    const chatViewContainer = document.getElementById('chat-view-container');
    if (chatViewContainer && window.ChatView) {
      ChatView.render(chatViewContainer);
    }

    // Refresh active tab info when switching or updating tabs
    if (chrome.tabs && chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(() => {
        if (window.SummaryView) SummaryView.refreshActiveTabInfo();
        if (window.ChatView) ChatView.updateActivePageInfo();
      });
    }
    if (chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) {
          if (window.SummaryView) SummaryView.refreshActiveTabInfo();
          if (window.ChatView) ChatView.onTabChanged(tabId, changeInfo);
        }
      });
    }

    // Check if API key exists and show/hide the banner
    await checkApiKeyBanner();

    // Listen for key updates from the settings view
    window.addEventListener('sahayak:keys-updated', async () => {
      await checkApiKeyBanner();
    });

    // Load saved language preference
    await loadLanguagePreference();

    console.log('[Sahayak] Side panel initialised.');
  }

  // ── Tab Navigation ──────────────────────────────────────────────────
  function setupTabNavigation() {
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        switchTab(targetTab);
      });
    });
  }

  function switchTab(tabName) {
    currentTab = tabName;

    // Update button states
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Update panel visibility
    tabPanels.forEach((panel) => {
      const isActive = panel.id === `tab-${tabName}`;
      panel.classList.toggle('active', isActive);
    });

    if (tabName === 'chat' && window.ChatView) {
      ChatView.updateActivePageInfo();
    }
  }

  // ── Settings Modal ──────────────────────────────────────────────────
  function setupSettingsModal() {
    btnSettings.addEventListener('click', openSettings);
    btnCloseSettings.addEventListener('click', closeSettings);
    bannerSettingsBtn.addEventListener('click', openSettings);

    // Close modal when clicking the overlay (outside the modal box)
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettings();
      }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && settingsModal.style.display !== 'none') {
        closeSettings();
      }
    });
  }

  function openSettings() {
    settingsModal.style.display = 'flex';
    // Refresh loaded keys when opening
    SettingsView.loadKeys();
  }

  function closeSettings() {
    settingsModal.style.display = 'none';
  }

  // ── API Key Banner ──────────────────────────────────────────────────
  /**
   * Show a warning banner if no Gemini API key is configured.
   * (Edge case 1.1.1: user never enters a key)
   */
  async function checkApiKeyBanner() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_API_KEYS' });
      const hasGeminiKey = response.success
        && response.data
        && response.data.geminiKey
        && response.data.geminiKey.trim().length > 0;

      apiKeyBanner.style.display = hasGeminiKey ? 'none' : 'flex';
    } catch (err) {
      // If we can't check, show the banner to be safe
      console.warn('[Sahayak] Could not check API key status:', err);
      apiKeyBanner.style.display = 'flex';
    }
  }

  // ── Language Toggle (Slice 1.5) ─────────────────────────────────────
  function setupLanguageToggle() {
    langBtnEn.addEventListener('click', () => setLanguage('en'));
    langBtnHi.addEventListener('click', () => setLanguage('hi-en'));
  }

  async function setLanguage(lang) {
    if (lang !== 'en' && lang !== 'hi-en') return;
    currentLanguage = lang;

    // Update button UI & accessibility attributes
    langBtnEn.classList.toggle('active', lang === 'en');
    langBtnHi.classList.toggle('active', lang === 'hi-en');
    langBtnEn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
    langBtnHi.setAttribute('aria-pressed', lang === 'hi-en' ? 'true' : 'false');

    // Persist to storage directly and via background message
    try {
      if (chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get('sahayak_preferences');
        const prefs = stored.sahayak_preferences || { schemaVersion: 1 };
        prefs.language = lang;
        await chrome.storage.local.set({ sahayak_preferences: prefs });
      }
      await chrome.runtime.sendMessage({
        type: 'SAVE_PREFERENCES',
        payload: { language: lang, schemaVersion: 1 }
      });
    } catch (err) {
      console.warn('[Sahayak] Could not save language preference:', err);
    }

    // Broadcast change event to all views and components
    window.dispatchEvent(new CustomEvent('sahayak:language-changed', {
      detail: { language: lang }
    }));
  }

  async function loadLanguagePreference() {
    try {
      let lang = 'en';
      if (chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get('sahayak_preferences');
        if (stored.sahayak_preferences?.language) {
          lang = stored.sahayak_preferences.language;
        }
      } else {
        const response = await chrome.runtime.sendMessage({ type: 'GET_PREFERENCES' });
        if (response.success && response.data?.language) {
          lang = response.data.language;
        }
      }

      currentLanguage = (lang === 'hi-en') ? 'hi-en' : 'en';
      langBtnEn.classList.toggle('active', currentLanguage === 'en');
      langBtnHi.classList.toggle('active', currentLanguage === 'hi-en');
      langBtnEn.setAttribute('aria-pressed', currentLanguage === 'en' ? 'true' : 'false');
      langBtnHi.setAttribute('aria-pressed', currentLanguage === 'hi-en' ? 'true' : 'false');
    } catch (err) {
      // Default to English (edge case 1.5.3)
      currentLanguage = 'en';
      langBtnEn.classList.add('active');
      langBtnHi.classList.remove('active');
      langBtnEn.setAttribute('aria-pressed', 'true');
      langBtnHi.setAttribute('aria-pressed', 'false');
      console.warn('[Sahayak] Could not load language preference, defaulting to EN.');
    }
  }

  // ── Explain Text (Slice 1.2) ─────────────────────────────────────────
  function setupExplainText() {
    const explainInput = document.getElementById('explain-input');
    const charCount = document.getElementById('explain-char-count');
    const btnExplain = document.getElementById('btn-explain');
    const resultArea = document.getElementById('explain-result');
    const resultText = document.getElementById('explain-result-text');
    const modelBadge = document.getElementById('explain-model-badge');
    const btnCopy = document.getElementById('btn-copy-result');
    const btnClear = document.getElementById('btn-clear-result');
    const loadingArea = document.getElementById('explain-loading');
    const errorArea = document.getElementById('explain-error');
    const errorText = document.getElementById('explain-error-text');
    const btnRetry = document.getElementById('btn-retry-explain');

    if (!explainInput || !btnExplain) return; // Guard — DOM not ready

    // Character counter
    explainInput.addEventListener('input', () => {
      const len = explainInput.value.length;
      charCount.textContent = `${len} / 5000`;
      charCount.classList.toggle('near-limit', len >= 4000 && len < 5000);
      charCount.classList.toggle('at-limit', len >= 5000);
    });

    // Explain button
    btnExplain.addEventListener('click', () => handleExplain());

    // Ctrl+Enter shortcut
    explainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleExplain();
      }
    });

    // Copy result
    btnCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(resultText.textContent);
        btnCopy.textContent = '✅ Copied';
        btnCopy.classList.add('copied');
        setTimeout(() => {
          btnCopy.textContent = '📋 Copy';
          btnCopy.classList.remove('copied');
        }, 1500);
      } catch (err) {
        // Fallback for environments where clipboard API may fail
        console.warn('[Sahayak] Clipboard write failed:', err);
        const range = document.createRange();
        range.selectNodeContents(resultText);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    // Clear result
    btnClear.addEventListener('click', () => {
      resultArea.style.display = 'none';
      errorArea.style.display = 'none';
      resultText.textContent = '';
      modelBadge.textContent = '';
    });

    // Retry
    btnRetry.addEventListener('click', () => handleExplain());

    /**
     * Core handler: validate → show loading → call AI → show result/error.
     * Uses explainRequestId to discard stale responses from rapid clicks.
     */
    async function handleExplain() {
      const text = explainInput.value.trim();

      // Validate: empty input
      if (!text) {
        showExplainError('Please paste or type some text to explain.');
        return;
      }

      // Debounce: prevent concurrent requests (edge case 1.2.7)
      if (isExplainPending) return;
      isExplainPending = true;

      // Stamp this request so we can discard stale responses
      const thisRequestId = ++explainRequestId;

      // UI: show loading, hide previous result/error
      btnExplain.disabled = true;
      btnExplain.textContent = '⏳ Thinking…';
      loadingArea.style.display = 'flex';
      resultArea.style.display = 'none';
      errorArea.style.display = 'none';

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'EXPLAIN_TEXT',
          payload: { text, language: currentLanguage }
        });

        // Discard if a newer request has been fired
        if (thisRequestId !== explainRequestId) return;

        if (response.success) {
          resultText.textContent = response.data.text;
          modelBadge.textContent = `⚡ ${response.data.model}`;
          resultArea.style.display = 'block';
        } else {
          const errMsg = response.error?.message || 'Something went wrong. Please try again.';
          showExplainError(errMsg);
        }
      } catch (err) {
        if (thisRequestId !== explainRequestId) return;
        showExplainError('Could not reach the background service. Please reload the extension.');
      } finally {
        if (thisRequestId === explainRequestId) {
          loadingArea.style.display = 'none';
          btnExplain.disabled = false;
          btnExplain.textContent = '🧠 Explain This';
          isExplainPending = false;
        }
      }
    }

    function showExplainError(msg) {
      errorText.textContent = msg;
      errorArea.style.display = 'flex';
    }
  }

  // ── Public API (for other components to read/write state) ─────────
  window.SahayakApp = {
    getCurrentTab: () => currentTab,
    getCurrentLanguage: () => currentLanguage,
    setLanguage,
    switchTab,
    openSettings,
    checkApiKeyBanner,
  };

  // ── Boot ────────────────────────────────────────────────────────────
  init();
})();

