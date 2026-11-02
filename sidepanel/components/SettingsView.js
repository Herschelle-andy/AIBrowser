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

    try {
      // Save language preference
      if (window.SahayakApp && window.SahayakApp.setLanguage) {
        await window.SahayakApp.setLanguage(selectedLang);
      }

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_API_KEYS',
        payload: { geminiKey, groqKey }
      });

      if (response.success) {
        showStatus('✅ Settings saved successfully.', 'success');
        // Notify the main app to update the API key banner
        window.dispatchEvent(new CustomEvent('sahayak:keys-updated'));
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

