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
  const headerSafetyBadge = document.getElementById('header-safety-badge');
  const domainBlockedBanner = document.getElementById('domain-blocked-banner');
  const bannerSafetySettingsBtn = document.getElementById('banner-safety-settings-btn');
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

    // Render the screenshot & ask view (Slice 2.3)
    const screenshotViewContainer = document.getElementById('screenshot-view-container');
    if (screenshotViewContainer && window.ScreenshotView) {
      ScreenshotView.render(screenshotViewContainer);
    }

    // Render the agent view (Slice 3.3)
    const agentViewContainer = document.getElementById('agent-view-container');
    if (agentViewContainer && window.AgentView) {
      AgentView.render(agentViewContainer);
    }

    // Render the local profile view (Slice 4.1)
    const profileViewContainer = document.getElementById('profile-view-container');
    if (profileViewContainer && window.ProfileView) {
      ProfileView.render(profileViewContainer);
    }

    // Render the one-click skills view (Slice 4.2)
    const skillsViewContainer = document.getElementById('skills-view-container');
    if (skillsViewContainer && window.SkillsView) {
      SkillsView.render(skillsViewContainer);
    }

    // Refresh active tab info when switching or updating tabs
    if (chrome.tabs && chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(() => {
        if (window.SummaryView) SummaryView.refreshActiveTabInfo();
        if (window.ChatView) ChatView.updateActivePageInfo();
        if (window.AgentView && window.AgentView.checkDomainSafety) AgentView.checkDomainSafety();
        updateSafetyStatus();
      });
    }
    if (chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) {
          if (window.SummaryView) SummaryView.refreshActiveTabInfo();
          if (window.ChatView) ChatView.onTabChanged(tabId, changeInfo);
          if (window.AgentView && window.AgentView.checkDomainSafety) AgentView.checkDomainSafety();
          updateSafetyStatus();
        }
      });
    }

    // Check if API key exists and show/hide the banner
    await checkApiKeyBanner();

    // Check active tab safety status
    await updateSafetyStatus();

    // Listen for key updates from the settings view
    window.addEventListener('sahayak:keys-updated', async () => {
      await checkApiKeyBanner();
    });

    // Listen for custom blocklist updates
    window.addEventListener('sahayak:blocked-domains-updated', async () => {
      await updateSafetyStatus();
      if (window.SummaryView) SummaryView.refreshActiveTabInfo();
      if (window.ChatView) ChatView.updateActivePageInfo();
      if (window.AgentView && window.AgentView.checkDomainSafety) AgentView.checkDomainSafety();
    });

    // Load saved language preference
    await loadLanguagePreference();

    // Check for pending context menu action (Slice 2.2 / Edge cases 2.2.1 & 2.2.4)
    await checkPendingContextAction();

    // Listen for live context action messages (Slice 2.2)
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'CONTEXT_ACTION') {
          handleContextAction(message);
        }
      });
    }

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
    if (headerSafetyBadge) headerSafetyBadge.addEventListener('click', openSettings);
    if (bannerSafetySettingsBtn) bannerSafetySettingsBtn.addEventListener('click', openSettings);

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

  // ── Safety Rails Status (Slice 4.3) ─────────────────────────────────
  /**
   * Update the header safety badge and danger banner based on active tab domain.
   */
  async function updateSafetyStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' });
      const isBlocked = Boolean(response?.success && response.data?.isDomainBlocked);

      if (headerSafetyBadge) {
        headerSafetyBadge.textContent = isBlocked ? '🛑 Blocked' : '🛡️ Protected';
        headerSafetyBadge.classList.toggle('blocked', isBlocked);
        headerSafetyBadge.title = isBlocked
          ? 'Active domain is blocked by Sahayak Safety Rails'
          : 'Deterministic Safety Rails: Active (Banking & Payment protection)';
      }

      if (domainBlockedBanner) {
        domainBlockedBanner.style.display = isBlocked ? 'flex' : 'none';
      }
    } catch (err) {
      console.warn('[Sahayak] Could not update safety status:', err);
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
        // Read from profile's preferredLanguage as default (Slice 4.1)
        const stored = await chrome.storage.local.get(['sahayak_user_profile', 'sahayak_preferences']);
        if (stored.sahayak_user_profile?.preferredLanguage) {
          lang = stored.sahayak_user_profile.preferredLanguage;
        } else if (stored.sahayak_preferences?.language) {
          lang = stored.sahayak_preferences.language;
        }
      } else {
        const profileRes = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
        if (profileRes?.success && profileRes?.data?.preferredLanguage) {
          lang = profileRes.data.preferredLanguage;
        } else {
          const response = await chrome.runtime.sendMessage({ type: 'GET_PREFERENCES' });
          if (response?.success && response?.data?.language) {
            lang = response.data.language;
          }
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

  // ── Quick Actions / Explain Text (Slice 1.2 & Slice 2.2) ────────────
  let activeQuickAction = 'explain';

  function setupExplainText() {
    const explainInput = document.getElementById('explain-input');
    const charCount = document.getElementById('explain-char-count');
    const btnExplain = document.getElementById('btn-explain');
    const btnTranslate = document.getElementById('btn-translate');
    const btnDraftReply = document.getElementById('btn-draft-reply');
    const resultArea = document.getElementById('explain-result');
    const resultTitle = document.getElementById('explain-result-title');
    const truncationNotice = document.getElementById('explain-truncation-notice');
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
    function updateCharCount() {
      const len = explainInput.value.length;
      charCount.textContent = `${len} / 5000`;
      charCount.classList.toggle('near-limit', len >= 4000 && len < 5000);
      charCount.classList.toggle('at-limit', len >= 5000);
    }

    explainInput.addEventListener('input', updateCharCount);

    // Quick Action button listeners
    btnExplain.addEventListener('click', () => handleExecuteAction('explain'));
    if (btnTranslate) {
      btnTranslate.addEventListener('click', () => handleExecuteAction('translate'));
    }
    if (btnDraftReply) {
      btnDraftReply.addEventListener('click', () => handleExecuteAction('draft_reply'));
    }

    // Ctrl+Enter shortcut runs current active action
    explainInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleExecuteAction(activeQuickAction || 'explain');
      }
    });

    // Copy result to clipboard with fallback (Edge case CC.21)
    btnCopy.addEventListener('click', async () => {
      const textToCopy = resultText.textContent || '';
      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        btnCopy.textContent = '✅ Copied';
        btnCopy.classList.add('copied');
        setTimeout(() => {
          btnCopy.textContent = '📋 Copy';
          btnCopy.classList.remove('copied');
        }, 1500);
      } catch (err) {
        // Fallback for restricted clipboard contexts
        console.warn('[Sahayak] Clipboard API write failed, using fallback:', err);
        try {
          const textarea = document.createElement('textarea');
          textarea.value = textToCopy;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);

          btnCopy.textContent = '✅ Copied';
          btnCopy.classList.add('copied');
          setTimeout(() => {
            btnCopy.textContent = '📋 Copy';
            btnCopy.classList.remove('copied');
          }, 1500);
        } catch (fallbackErr) {
          console.error('[Sahayak] Fallback copy also failed:', fallbackErr);
        }
      }
    });

    // Clear result
    btnClear.addEventListener('click', () => {
      resultArea.style.display = 'none';
      errorArea.style.display = 'none';
      if (truncationNotice) truncationNotice.style.display = 'none';
      resultText.textContent = '';
      modelBadge.textContent = '';
    });

    // Retry
    btnRetry.addEventListener('click', () => handleExecuteAction(activeQuickAction || 'explain'));

    /**
     * Execute quick action on text: validate -> loading -> AI call -> display.
     */
    async function handleExecuteAction(action, textOverride = null, isTruncated = false) {
      activeQuickAction = action || 'explain';

      const text = (textOverride !== null ? textOverride : explainInput.value).trim();

      // Edge case 2.2.3: Validate empty input
      if (!text) {
        showExplainError('Please paste, type, or select some text first.');
        return;
      }

      // Debounce: prevent concurrent requests (edge case 1.2.7)
      if (isExplainPending) return;
      isExplainPending = true;

      // Stamp this request so we can discard stale responses
      const thisRequestId = ++explainRequestId;

      // Update button labels & loading state
      setActionsDisabled(true);
      loadingArea.style.display = 'flex';
      resultArea.style.display = 'none';
      errorArea.style.display = 'none';

      // Set result card title
      updateResultTitle(action);

      // Edge case 2.2.2: Truncation warning banner
      if (truncationNotice) {
        truncationNotice.style.display = isTruncated ? 'flex' : 'none';
      }

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'EXECUTE_CONTEXT_ACTION',
          payload: { action, text, language: currentLanguage }
        });

        // Discard if a newer request has been fired
        if (thisRequestId !== explainRequestId) return;

        if (response.success) {
          resultText.textContent = response.data.text;
          const backupBadge = response.data.isFallback ? ' · 🔄 Backup model' : '';
          modelBadge.textContent = `⚡ ${response.data.model}${backupBadge}`;
          if (response.data.isTruncated && truncationNotice) {
            truncationNotice.style.display = 'flex';
          }
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
          setActionsDisabled(false);
          isExplainPending = false;
        }
      }
    }

    function updateResultTitle(action) {
      if (!resultTitle) return;
      const normalized = (action || '').toLowerCase().replace(/-/g, '_');
      switch (normalized) {
        case 'translate':
          resultTitle.textContent = currentLanguage === 'hi-en'
            ? '🌐 Translation (Hinglish)'
            : '🌐 Translation (Hindi)';
          break;
        case 'draft_reply':
        case 'draftreply':
          resultTitle.textContent = '✉️ Draft Reply';
          break;
        case 'explain':
        default:
          resultTitle.textContent = '📝 Explanation';
          break;
      }
    }

    function setActionsDisabled(disabled) {
      if (btnExplain) btnExplain.disabled = disabled;
      if (btnTranslate) btnTranslate.disabled = disabled;
      if (btnDraftReply) btnDraftReply.disabled = disabled;
    }

    function showExplainError(msg) {
      errorText.textContent = msg;
      errorArea.style.display = 'flex';
    }

    // Attach external trigger
    window._sahayakExecuteContextAction = (payload) => {
      switchTab('summary');
      if (payload.text) {
        explainInput.value = payload.text;
        updateCharCount();
      }
      handleExecuteAction(payload.action || 'explain', payload.text, !!payload.isTruncated);
    };
  }

  /**
   * Handle incoming or pending context action (Slice 2.2).
   */
  function handleContextAction(payload) {
    if (!payload || !payload.text) return;
    if (typeof window._sahayakExecuteContextAction === 'function') {
      window._sahayakExecuteContextAction(payload);
    }
  }

  /**
   * Check session storage for pending context action on startup (Edge cases 2.2.1 & 2.2.4).
   */
  async function checkPendingContextAction() {
    if (!chrome.storage || !chrome.storage.session) return;
    try {
      const res = await chrome.storage.session.get('sahayak_pending_context_action');
      if (res && res.sahayak_pending_context_action) {
        const pending = res.sahayak_pending_context_action;
        await chrome.storage.session.remove('sahayak_pending_context_action');
        // If fresh (< 2 minutes old), process
        if (Date.now() - (pending.timestamp || 0) < 120000) {
          handleContextAction(pending);
        }
      }
    } catch (e) {
      console.warn('[Sahayak] Could not process pending context action:', e);
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
    handleContextAction,
  };

  // ── Boot ────────────────────────────────────────────────────────────
  init();
})();

