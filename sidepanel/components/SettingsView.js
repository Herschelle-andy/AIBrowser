/**
 * SettingsView — API Key management and preferences.
 * 
 * Renders into #settings-container inside the settings modal.
 * Handles:
 *  - Gemini API key entry & validation feedback
 *  - Groq API key entry (optional)
 *  - Key format warnings (edge case 1.1.3)
 *  - Persistence via chrome.storage.local
 */

const SettingsView = (() => {
  let _container = null;
  let _saveStatus = null;

  /**
   * Render the settings form into the target container.
   */
  function render(container) {
    _container = container;
    container.innerHTML = `
      <form id="settings-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="gemini-key">Gemini API Key</label>
          <span class="form-hint">
            Get a free key from
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">
              Google AI Studio ↗
            </a>
          </span>
          <input
            type="password"
            id="gemini-key"
            class="form-input"
            placeholder="AI..."
            spellcheck="false"
            autocomplete="off"
          />
          <div id="gemini-key-hint" class="key-format-hint"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="groq-key">Groq API Key <span style="font-weight:400;color:var(--color-text-secondary)">(optional)</span></label>
          <span class="form-hint">
            Free fallback model. Get a key from
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener">
              Groq Console ↗
            </a>
          </span>
          <input
            type="password"
            id="groq-key"
            class="form-input"
            placeholder="gsk_..."
            spellcheck="false"
            autocomplete="off"
          />
          <div id="groq-key-hint" class="key-format-hint"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Response Language</label>
          <span class="form-hint">Choose default output language for summaries and explanations</span>
          <div class="settings-lang-options">
            <label class="lang-radio-label">
              <input type="radio" name="settings-language" value="en" id="settings-lang-en" checked />
              <span>English (Default)</span>
            </label>
            <label class="lang-radio-label">
              <input type="radio" name="settings-language" value="hi-en" id="settings-lang-hi" />
              <span>Hinglish (Hindi in Roman script)</span>
            </label>
          </div>
        </div>

        <hr class="section-divider" style="margin: 16px 0;" />

        <div class="form-group safety-settings-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label class="form-label" style="margin-bottom: 0;">🛡️ Safety Rails &amp; Domain Blocklist</label>
            <span class="badge-tag badge-success" style="font-size: 11px;">Active</span>
          </div>
          <span class="form-hint" style="margin-bottom: 10px;">
            Deterministic guardrails protect your privacy. Sensitive banking, financial, and personal sites are never read or automated by AI.
          </span>

          <div class="safety-builtin-box" style="margin-bottom: 12px; background: var(--color-surface); padding: 10px; border-radius: 6px; border: 1px solid var(--color-border);">
            <div style="font-size: 11px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
              Default Protected Categories:
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              <span class="safety-category-tag">🏦 Netbanking</span>
              <span class="safety-category-tag">💳 UPI &amp; Payments</span>
              <span class="safety-category-tag">🪙 Crypto Exchanges</span>
              <span class="safety-category-tag">🏛️ Govt ID &amp; Tax</span>
              <span class="safety-category-tag">✉️ Webmail Clients</span>
              <span class="safety-category-tag">🔒 Passwords &amp; OTPs</span>
            </div>
          </div>

          <label class="form-label" for="custom-blocked-domains" style="font-size: 13px;">
            Custom Blocked Domains
          </label>
          <span class="form-hint">
            Add extra domains to block from AI access and agent actions (one per line or comma-separated):
          </span>
          <textarea
            id="custom-blocked-domains"
            class="form-input"
            rows="3"
            placeholder="example.com&#10;internal.corp.net&#10;myfinancialportal.org"
            spellcheck="false"
          ></textarea>
          <span class="form-hint" style="font-size: 11px; margin-top: 4px;">
            💡 Matching domains and all their subdomains will be blocked automatically.
          </span>
        </div>

        <div id="settings-save-status" class="status-text" aria-live="polite"></div>

        <div style="display: flex; gap: 8px;">
          <button type="submit" class="btn btn-primary btn-full">
            💾 Save Settings
          </button>
          <button type="button" id="btn-toggle-visibility" class="btn btn-secondary" title="Show/hide keys">
            👁️
          </button>
        </div>
      </form>
    `;

    _saveStatus = container.querySelector('#settings-save-status');

    // Bind events
    container.querySelector('#settings-form').addEventListener('submit', onSave);
    container.querySelector('#btn-toggle-visibility').addEventListener('click', onToggleVisibility);
    container.querySelector('#gemini-key').addEventListener('input', onGeminiKeyInput);
    container.querySelector('#groq-key').addEventListener('input', onGroqKeyInput);

    // Sync language selection when radio changes
    container.querySelectorAll('input[name="settings-language"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked && window.SahayakApp && window.SahayakApp.setLanguage) {
          window.SahayakApp.setLanguage(radio.value);
        }
      });
    });

    // Update settings radio when language changes in header
    window.addEventListener('sahayak:language-changed', (e) => {
      const lang = e.detail?.language;
      const langEnRadio = _container?.querySelector('#settings-lang-en');
      const langHiRadio = _container?.querySelector('#settings-lang-hi');
      if (langEnRadio) langEnRadio.checked = (lang === 'en');
      if (langHiRadio) langHiRadio.checked = (lang === 'hi-en');
    });

    // Load existing keys
    loadKeys();
  }

  /**
   * Load saved keys from storage and populate the inputs.
   */
  async function loadKeys() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_API_KEYS' });
      if (response.success && response.data) {
        const geminiInput = _container.querySelector('#gemini-key');
        const groqInput = _container.querySelector('#groq-key');
        geminiInput.value = response.data.geminiKey || '';
        groqInput.value = response.data.groqKey || '';
        // Run format checks on loaded values
        validateKeyFormat('gemini', geminiInput.value);
        validateKeyFormat('groq', groqInput.value);
      }

      // Load language preference
      let currentLang = 'en';
      if (window.SahayakApp && window.SahayakApp.getCurrentLanguage) {
        currentLang = window.SahayakApp.getCurrentLanguage();
      } else {
        const prefRes = await chrome.runtime.sendMessage({ type: 'GET_PREFERENCES' });
        if (prefRes.success && prefRes.data?.language) {
          currentLang = prefRes.data.language;
        }
      }
      const langEnRadio = _container.querySelector('#settings-lang-en');
      const langHiRadio = _container.querySelector('#settings-lang-hi');
      if (langEnRadio) langEnRadio.checked = (currentLang === 'en');
      if (langHiRadio) langHiRadio.checked = (currentLang === 'hi-en');

      // Load custom blocked domains
      const blockRes = await chrome.runtime.sendMessage({ type: 'GET_BLOCKED_DOMAINS' });
      if (blockRes?.success && Array.isArray(blockRes.data?.customDomains)) {
        const customInput = _container.querySelector('#custom-blocked-domains');
        if (customInput) {
          customInput.value = blockRes.data.customDomains.join('\n');
        }
      }
    } catch (err) {
      console.error('[SettingsView] Failed to load settings:', err);
    }
  }

  /**
   * Save keys to storage via the background service worker.
   */
  async function onSave(e) {
    e.preventDefault();
    const geminiKey = _container.querySelector('#gemini-key').value;
    const groqKey = _container.querySelector('#groq-key').value;
    const selectedLang = _container.querySelector('input[name="settings-language"]:checked')?.value || 'en';
    const customInput = _container.querySelector('#custom-blocked-domains');
    const customDomains = (customInput ? customInput.value : '')
      .split(/[\n,]+/)
      .map(d => d.trim().toLowerCase())
      .filter(Boolean);

    try {
      // Save language preference
      if (window.SahayakApp && window.SahayakApp.setLanguage) {
        await window.SahayakApp.setLanguage(selectedLang);
      }

      // Save custom blocked domains
      await chrome.runtime.sendMessage({
        type: 'SAVE_BLOCKED_DOMAINS',
        payload: { customDomains }
      });

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_API_KEYS',
        payload: { geminiKey, groqKey }
      });

      if (response.success) {
        showStatus('✅ Settings & blocklist saved successfully.', 'success');
        // Notify the main app to update the API key banner and safety state
        window.dispatchEvent(new CustomEvent('sahayak:keys-updated'));
        window.dispatchEvent(new CustomEvent('sahayak:blocked-domains-updated'));
      } else {
        showStatus('❌ Failed to save keys.', 'error');
      }
    } catch (err) {
      console.error('[SettingsView] Save error:', err);
      showStatus('❌ Error saving keys.', 'error');
    }
  }

  /**
   * Toggle password visibility for both key inputs.
   */
  function onToggleVisibility() {
    const geminiInput = _container.querySelector('#gemini-key');
    const groqInput = _container.querySelector('#groq-key');
    const isPassword = geminiInput.type === 'password';
    geminiInput.type = isPassword ? 'text' : 'password';
    groqInput.type = isPassword ? 'text' : 'password';
    _container.querySelector('#btn-toggle-visibility').textContent = isPassword ? '🙈' : '👁️';
  }

  /**
   * Validate Gemini key format on input (edge case 1.1.3).
   */
  function onGeminiKeyInput(e) {
    validateKeyFormat('gemini', e.target.value);
  }

  /**
   * Validate Groq key format on input (edge case 1.1.3).
   */
  function onGroqKeyInput(e) {
    validateKeyFormat('groq', e.target.value);
  }

  /**
   * Check key format and show a hint if it looks wrong.
   */
  function validateKeyFormat(provider, value) {
    const hintEl = _container.querySelector(`#${provider}-key-hint`);
    if (!value || value.trim() === '') {
      hintEl.textContent = '';
      hintEl.className = 'key-format-hint';
      return;
    }

    const trimmed = value.trim();

    if (provider === 'gemini') {
      // Gemini keys typically start with "AI" and are ~39 chars
      if (trimmed.startsWith('gsk_')) {
        hintEl.textContent = '⚠️ This looks like a Groq key, not a Gemini key.';
        hintEl.className = 'key-format-hint key-format-warning';
      } else if (trimmed.length < 20) {
        hintEl.textContent = 'Key seems too short.';
        hintEl.className = 'key-format-hint key-format-warning';
      } else {
        hintEl.textContent = '✓ Format looks valid.';
        hintEl.className = 'key-format-hint status-success';
      }
    }

    if (provider === 'groq') {
      if (trimmed.startsWith('AI')) {
        hintEl.textContent = '⚠️ This looks like a Gemini key, not a Groq key.';
        hintEl.className = 'key-format-hint key-format-warning';
      } else if (!trimmed.startsWith('gsk_')) {
        hintEl.textContent = 'Groq keys usually start with "gsk_".';
        hintEl.className = 'key-format-hint key-format-warning';
      } else {
        hintEl.textContent = '✓ Format looks valid.';
        hintEl.className = 'key-format-hint status-success';
      }
    }
  }

  /**
   * Show a temporary status message.
   */
  function showStatus(text, type) {
    if (!_saveStatus) return;
    _saveStatus.textContent = text;
    _saveStatus.className = `status-text status-${type}`;
    // Auto-clear after 3 seconds
    setTimeout(() => {
      if (_saveStatus) _saveStatus.textContent = '';
    }, 3000);
  }

  return { render, loadKeys };
})();

