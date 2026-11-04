/**
 * Sahayak — Profile View Component (Slice 4.1)
 *
 * Renders into #profile-view-container inside the Profile tab.
 * Manages:
 *  - Personal, Academic, Professional, and AI Preferences fields
 *  - Live character counting for bio
 *  - Safe XSS-free data binding (textContent / input.value)
 *  - Storage synchronization & external window update detection (Edge case 4.1.4)
 *  - Language preference synchronization with the header toggle
 *
 * Architecture references: §13 (Local Profile Memory), Edge cases 4.1.1 - 4.1.4
 */

const ProfileView = (() => {
  'use strict';

  let _container = null;
  let _statusTimer = null;
  let _isSelfSaving = false;

  /**
   * Render the profile view into the container.
   *
   * @param {HTMLElement} container
   */
  function render(container) {
    _container = container;

    _container.innerHTML = `
      <div class="profile-view-wrapper">

        <!-- Header / Intro banner -->
        <div class="profile-header-card">
          <div class="profile-header-title">
            <span class="profile-badge-icon">👤</span>
            <div>
              <h3>Profile Memory</h3>
              <p class="profile-header-subtitle">
                Saved locally on your device. Never shared externally. Sahayak uses this memory to accurately fill forms and personalise responses.
              </p>
            </div>
          </div>
        </div>

        <!-- External Window Sync Banner (Edge case 4.1.4) -->
        <div id="profile-sync-banner" class="banner banner-warning profile-sync-banner" style="display: none;">
          <span>⚠️ Profile was updated in another window.</span>
          <button type="button" id="btn-reload-profile" class="banner-link">Reload</button>
        </div>

        <!-- Status Message Alert -->
        <div id="profile-status-alert" class="profile-status-alert" style="display: none;" role="status" aria-live="polite"></div>

        <form id="profile-form" class="profile-form" autocomplete="off">

          <!-- ── Section 1: Personal Information ───────────────── -->
          <div class="profile-card">
            <h4 class="profile-section-title">👤 Personal Information</h4>
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label" for="profile-fullname">Full Name</label>
                <input
                  type="text"
                  id="profile-fullname"
                  class="form-input"
                  placeholder="e.g. Rahul Sharma"
                  maxlength="100"
                  autocomplete="name"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="profile-email">Email Address</label>
                <input
                  type="email"
                  id="profile-email"
                  class="form-input"
                  placeholder="e.g. rahul@example.com"
                  maxlength="100"
                  autocomplete="email"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="profile-phone">Phone Number</label>
                <input
                  type="tel"
                  id="profile-phone"
                  class="form-input"
                  placeholder="e.g. +91 98765 43210"
                  maxlength="30"
                  autocomplete="tel"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="profile-city">City / Location</label>
                <input
                  type="text"
                  id="profile-city"
                  class="form-input"
                  placeholder="e.g. Bengaluru, India"
                  maxlength="100"
                />
              </div>
            </div>
          </div>

          <!-- ── Section 2: Academic Details ───────────────────── -->
          <div class="profile-card">
            <h4 class="profile-section-title">🎓 Academic Details</h4>
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label" for="profile-college">College / University</label>
                <input
                  type="text"
                  id="profile-college"
                  class="form-input"
                  placeholder="e.g. Delhi University / IIT Bombay"
                  maxlength="150"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="profile-degree">Degree</label>
                <input
                  type="text"
                  id="profile-degree"
                  class="form-input"
                  placeholder="e.g. B.Tech / B.Sc / MBA"
                  maxlength="100"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="profile-major">Major / Field of Study</label>
                <input
                  type="text"
                  id="profile-major"
                  class="form-input"
                  placeholder="e.g. Computer Science"
                  maxlength="100"
                />
              </div>

              <div class="form-row-two-col">
                <div class="form-group">
                  <label class="form-label" for="profile-year">Graduation Year</label>
                  <input
                    type="text"
                    id="profile-year"
                    class="form-input"
                    placeholder="e.g. 2025"
                    maxlength="10"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label" for="profile-gpa">GPA / Percentage</label>
                  <input
                    type="text"
                    id="profile-gpa"
                    class="form-input"
                    placeholder="e.g. 8.8 / 85%"
                    maxlength="20"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- ── Section 3: Professional & Links ───────────────── -->
          <div class="profile-card">
            <h4 class="profile-section-title">💼 Professional & Links</h4>

            <div class="form-group">
              <label class="form-label" for="profile-skills">Skills</label>
              <span class="form-hint">Separate with commas (up to 20 skills)</span>
              <input
                type="text"
                id="profile-skills"
                class="form-input"
                placeholder="e.g. JavaScript, Python, React, Data Analysis, SQL"
              />
            </div>

            <div class="form-group">
              <div class="profile-label-with-counter">
                <label class="form-label" for="profile-bio">Short Bio</label>
                <span id="profile-bio-count" class="char-count">0 / 500</span>
              </div>
              <span class="form-hint">Used for drafting responses and author background context</span>
              <textarea
                id="profile-bio"
                class="form-input profile-bio-textarea"
                rows="3"
                maxlength="500"
                placeholder="A brief description of yourself, your experience, or professional interests…"
              ></textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="profile-linkedin">LinkedIn Profile URL</label>
              <input
                type="url"
                id="profile-linkedin"
                class="form-input"
                placeholder="https://linkedin.com/in/username"
                maxlength="200"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="profile-github">GitHub Profile URL</label>
              <input
                type="url"
                id="profile-github"
                class="form-input"
                placeholder="https://github.com/username"
                maxlength="200"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="profile-portfolio">Portfolio / Personal Website</label>
              <input
                type="url"
                id="profile-portfolio"
                class="form-input"
                placeholder="https://myportfolio.com"
                maxlength="200"
              />
            </div>
          </div>

          <!-- ── Section 4: AI Preferences ─────────────────────── -->
          <div class="profile-card">
            <h4 class="profile-section-title">⚙️ AI Preferences</h4>

            <div class="form-group">
              <label class="form-label">Preferred Output Language</label>
              <span class="form-hint">Default language for replies, explanations, and browser summaries</span>
              <div class="profile-radio-group">
                <label class="profile-radio-label">
                  <input type="radio" name="profile-language" value="en" id="profile-lang-en" checked />
                  <span>English (Default)</span>
                </label>
                <label class="profile-radio-label">
                  <input type="radio" name="profile-language" value="hi-en" id="profile-lang-hi" />
                  <span>Hinglish (Hindi in Roman script)</span>
                </label>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="profile-tone">Preferred Response Tone</label>
              <span class="form-hint">Informs reply drafting and communication style</span>
              <select id="profile-tone" class="form-input profile-select">
                <option value="formal">Formal — Professional, polite & structured (Recommended)</option>
                <option value="concise">Concise — Short, direct & punchy</option>
                <option value="detailed">Detailed — In-depth, explanatory & comprehensive</option>
                <option value="casual">Casual — Friendly, warm & conversational</option>
              </select>
            </div>
          </div>

          <!-- ── Action Buttons ────────────────────────────────── -->
          <div class="profile-actions-bar">
            <button type="submit" id="btn-save-profile" class="btn btn-primary btn-full">
              💾 Save Profile
            </button>
            <button type="button" id="btn-clear-profile" class="btn btn-secondary profile-clear-btn" title="Clear all profile data">
              🗑️ Clear
            </button>
          </div>

        </form>
      </div>
    `;

    bindEvents();
    loadProfile();
    setupStorageSyncListener();
  }

  /**
   * Bind DOM event listeners.
   */
  function bindEvents() {
    const form = _container.querySelector('#profile-form');
    const btnClear = _container.querySelector('#btn-clear-profile');
    const bioTextarea = _container.querySelector('#profile-bio');
    const btnReload = _container.querySelector('#btn-reload-profile');

    form.addEventListener('submit', onSave);
    btnClear.addEventListener('click', onClear);
    bioTextarea.addEventListener('input', updateBioCharCount);

    if (btnReload) {
      btnReload.addEventListener('click', () => {
        const syncBanner = _container.querySelector('#profile-sync-banner');
        if (syncBanner) syncBanner.style.display = 'none';
        loadProfile();
        showStatus('Profile reloaded from storage.', 'info');
      });
    }

    // Keep language radio in sync if user changes it via header
    window.addEventListener('sahayak:language-changed', (e) => {
      const lang = e.detail?.language;
      const langEn = _container?.querySelector('#profile-lang-en');
      const langHi = _container?.querySelector('#profile-lang-hi');
      if (langEn) langEn.checked = (lang === 'en');
      if (langHi) langHi.checked = (lang === 'hi-en');
    });
  }

  /**
   * Setup multi-window storage sync listener (Edge case 4.1.4).
   */
  function setupStorageSyncListener() {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.sahayak_user_profile) {
          // If update was not triggered by this view instance
          if (!_isSelfSaving) {
            const syncBanner = _container?.querySelector('#profile-sync-banner');
            if (syncBanner) {
              syncBanner.style.display = 'flex';
            }
          }
        }
      });
    }
  }

  /**
   * Update character counter for bio.
   */
  function updateBioCharCount() {
    const bio = _container.querySelector('#profile-bio');
    const countSpan = _container.querySelector('#profile-bio-count');
    if (!bio || !countSpan) return;

    const len = bio.value.length;
    countSpan.textContent = `${len} / 500`;
    countSpan.classList.toggle('char-count-warn', len >= 450);
  }

  /**
   * Populate inputs from saved profile.
   * Uses safe property assignment (.value) to avoid XSS (Edge case 4.1.1).
   */
  async function loadProfile() {
    try {
      let profile = null;
      if (globalThis.ProfileStore && typeof ProfileStore.getProfile === 'function') {
        profile = await ProfileStore.getProfile();
      } else {
        const res = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
        profile = res?.data || null;
      }

      if (!profile) {
        // Check if there is an active language preference to default to
        if (window.SahayakApp && typeof SahayakApp.getCurrentLanguage === 'function') {
          const curLang = SahayakApp.getCurrentLanguage();
          setRadioValue('profile-language', curLang);
        }
        updateBioCharCount();
        return;
      }

      setInputValue('profile-fullname', profile.fullName);
      setInputValue('profile-email', profile.email);
      setInputValue('profile-phone', profile.phone);
      setInputValue('profile-city', profile.city);

      setInputValue('profile-college', profile.college);
      setInputValue('profile-degree', profile.degree);
      setInputValue('profile-major', profile.major);
      setInputValue('profile-year', profile.graduationYear);
      setInputValue('profile-gpa', profile.gpa);

      const skillsStr = Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || '');
      setInputValue('profile-skills', skillsStr);

      setInputValue('profile-bio', profile.bio);
      setInputValue('profile-linkedin', profile.linkedIn);
      setInputValue('profile-github', profile.github);
      setInputValue('profile-portfolio', profile.portfolio);

      setRadioValue('profile-language', profile.preferredLanguage || 'en');

      const toneSelect = _container.querySelector('#profile-tone');
      if (toneSelect && profile.preferredTone) {
        toneSelect.value = profile.preferredTone;
      }

      updateBioCharCount();
    } catch (err) {
      console.warn('[ProfileView] Could not load profile:', err);
    }
  }

  /**
   * Helper to set input value safely.
   */
  function setInputValue(id, val) {
    const el = _container.querySelector(`#${id}`);
    if (el) {
      el.value = (val !== null && val !== undefined) ? String(val) : '';
    }
  }

  /**
   * Helper to set radio group value.
   */
  function setRadioValue(name, val) {
    const radios = _container.querySelectorAll(`input[name="${name}"]`);
    radios.forEach((r) => {
      r.checked = (r.value === val);
    });
  }

  /**
   * Collects current input values from the form.
   *
   * @returns {Object}
   */
  function collectFormData() {
    const getVal = (id) => (_container.querySelector(`#${id}`)?.value || '').trim();
    const langRadio = _container.querySelector('input[name="profile-language"]:checked');
    const toneSelect = _container.querySelector('#profile-tone');

    return {
      fullName: getVal('profile-fullname'),
      email: getVal('profile-email'),
      phone: getVal('profile-phone'),
      city: getVal('profile-city'),
      college: getVal('profile-college'),
      degree: getVal('profile-degree'),
      major: getVal('profile-major'),
      graduationYear: getVal('profile-year'),
      gpa: getVal('profile-gpa'),
      skills: getVal('profile-skills'),
      bio: getVal('profile-bio'),
      linkedIn: getVal('profile-linkedin'),
      github: getVal('profile-github'),
      portfolio: getVal('profile-portfolio'),
      preferredLanguage: langRadio?.value || 'en',
      preferredTone: toneSelect?.value || 'formal'
    };
  }

  /**
   * Handle form submit (Save Profile).
   */
  async function onSave(e) {
    if (e && e.preventDefault) e.preventDefault();

    const data = collectFormData();
    _isSelfSaving = true;

    try {
      let saved = null;
      if (globalThis.ProfileStore && typeof ProfileStore.saveProfile === 'function') {
        saved = await ProfileStore.saveProfile(data);
      } else {
        const res = await chrome.runtime.sendMessage({ type: 'SAVE_PROFILE', payload: data });
        saved = res?.data || data;
      }

      // Re-populate with sanitized values (e.g. stripped tags, capped lengths)
      if (saved) {
        setInputValue('profile-fullname', saved.fullName);
        setInputValue('profile-email', saved.email);
        setInputValue('profile-phone', saved.phone);
        setInputValue('profile-city', saved.city);
        setInputValue('profile-college', saved.college);
        setInputValue('profile-degree', saved.degree);
        setInputValue('profile-major', saved.major);
        setInputValue('profile-year', saved.graduationYear);
        setInputValue('profile-gpa', saved.gpa);
        setInputValue('profile-skills', Array.isArray(saved.skills) ? saved.skills.join(', ') : saved.skills);
        setInputValue('profile-bio', saved.bio);
        setInputValue('profile-linkedin', saved.linkedIn);
        setInputValue('profile-github', saved.github);
        setInputValue('profile-portfolio', saved.portfolio);
        updateBioCharCount();
      }

      // Sync language toggle with profile preference
      if (saved.preferredLanguage && window.SahayakApp && typeof SahayakApp.setLanguage === 'function') {
        await SahayakApp.setLanguage(saved.preferredLanguage);
      }

      // Hide external sync banner if visible
      const syncBanner = _container.querySelector('#profile-sync-banner');
      if (syncBanner) syncBanner.style.display = 'none';

      showStatus('✅ Profile saved successfully!', 'success');

      window.dispatchEvent(new CustomEvent('sahayak:profile-saved', { detail: { profile: saved } }));
    } catch (err) {
      console.error('[ProfileView] Save error:', err);
      showStatus('Failed to save profile. Please try again.', 'error');
    } finally {
      setTimeout(() => {
        _isSelfSaving = false;
      }, 500);
    }
  }

  /**
   * Handle Clear Profile button.
   */
  async function onClear() {
    const confirmed = window.confirm(
      'Are you sure you want to clear your local profile memory?\n\nThis will remove all saved personal and academic information from this device.'
    );
    if (!confirmed) return;

    _isSelfSaving = true;

    try {
      if (globalThis.ProfileStore && typeof ProfileStore.clearProfile === 'function') {
        await ProfileStore.clearProfile();
      } else {
        await chrome.runtime.sendMessage({ type: 'CLEAR_PROFILE' });
      }

      // Clear form inputs
      const textInputs = _container.querySelectorAll('.form-input');
      textInputs.forEach((input) => {
        if (input.tagName === 'SELECT') {
          input.value = 'formal';
        } else {
          input.value = '';
        }
      });

      setRadioValue('profile-language', 'en');
      updateBioCharCount();

      // Hide sync banner if visible
      const syncBanner = _container.querySelector('#profile-sync-banner');
      if (syncBanner) syncBanner.style.display = 'none';

      showStatus('🗑️ Profile cleared.', 'info');

      window.dispatchEvent(new CustomEvent('sahayak:profile-cleared'));
    } catch (err) {
      console.error('[ProfileView] Clear error:', err);
      showStatus('Failed to clear profile.', 'error');
    } finally {
      setTimeout(() => {
        _isSelfSaving = false;
      }, 500);
    }
  }

  /**
   * Show a transient status alert banner.
   *
   * @param {string} message
   * @param {'success'|'error'|'info'} [type='success']
   */
  function showStatus(message, type = 'success') {
    const alertEl = _container.querySelector('#profile-status-alert');
    if (!alertEl) return;

    if (_statusTimer) {
      clearTimeout(_statusTimer);
      _statusTimer = null;
    }

    alertEl.textContent = message;
    alertEl.className = `profile-status-alert profile-status-${type}`;
    alertEl.style.display = 'block';

    _statusTimer = setTimeout(() => {
      alertEl.style.display = 'none';
      _statusTimer = null;
    }, 3500);
  }

  return {
    render,
    loadProfile
  };
})();

globalThis.ProfileView = ProfileView;

