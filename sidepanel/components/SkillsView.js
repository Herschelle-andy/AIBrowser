/**
 * Sahayak — One-Click Skills View Component (Slice 4.2)
 *
 * Renders into #skills-view-container inside the Skills tab.
 * Manages:
 *  - Rendering built-in and user-saved prompt recipe cards
 *  - Skill creation modal with emoji, prompt template, and context requirements
 *  - Variable substitution ({{selectedText}}, {{pageContent}}, {{profile.field}})
 *  - Running skills (direct AI generation or Agent errand loop)
 *  - JSON Export & schema-validated Import
 *  - Safe duplication and deletion of custom skills
 *
 * Architecture references: §14 (One-Click Skills Engine), Edge cases 4.2.1 - 4.2.8
 */

const SkillsView = (() => {
  'use strict';

  let _container = null;
  let _skills = [];
  let _activeRunningSkillId = null;
  let _statusTimer = null;

  /**
   * Render the skills view into the target container.
   *
   * @param {HTMLElement} container
   */
  function render(container) {
    _container = container;

    _container.innerHTML = `
      <div class="skills-view-wrapper">

        <!-- Header / Intro Banner -->
        <div class="skills-header-card">
          <div class="skills-header-top">
            <div class="skills-header-title">
              <span class="skills-badge-icon">⚡</span>
              <div>
                <h3>Saved Skills</h3>
                <p class="skills-header-subtitle">
                  One-click prompt recipes for instant notes, replies, translations, and browser automations.
                </p>
              </div>
            </div>
          </div>

          <!-- Skills Toolbar -->
          <div class="skills-toolbar">
            <button type="button" id="btn-create-skill" class="btn btn-primary btn-sm" title="Create a new custom skill">
              ➕ Create Skill
            </button>
            <div class="skills-io-buttons">
              <button type="button" id="btn-export-skills" class="btn btn-secondary btn-sm" title="Download skills as JSON">
                📤 Export All
              </button>
              <button type="button" id="btn-import-skills" class="btn btn-secondary btn-sm" title="Import skills from JSON file">
                📥 Import
              </button>
              <input type="file" id="file-import-skills" accept=".json,application/json" style="display: none;" />
            </div>
          </div>
        </div>

        <!-- Transient Status Alert -->
        <div id="skills-status-alert" class="skills-status-alert" style="display: none;" role="status" aria-live="polite"></div>

        <!-- Execution Result Card (for text skills) -->
        <div id="skill-result-card" class="skill-result-card" style="display: none;">
          <div class="skill-result-header">
            <div class="skill-result-title">
              <span id="skill-result-icon">⚡</span>
              <h4 id="skill-result-name">Skill Result</h4>
            </div>
            <div class="skill-result-actions">
              <button type="button" id="btn-copy-skill-result" class="btn btn-secondary btn-sm" title="Copy to clipboard">
                📋 Copy
              </button>
              <button type="button" id="btn-close-skill-result" class="btn btn-secondary btn-sm" title="Close result">
                ✕
              </button>
            </div>
          </div>

          <!-- Loading state inside result card -->
          <div id="skill-result-loading" class="loading-area" style="display: none;">
            <div class="loading-spinner"></div>
            <span class="loading-text" id="skill-loading-text">Running skill with Gemini…</span>
          </div>

          <!-- Error state inside result card -->
          <div id="skill-result-error" class="error-area" style="display: none;">
            <div id="skill-error-text" class="error-text"></div>
          </div>

          <!-- Content display -->
          <div id="skill-result-text" class="skill-result-text"></div>
          <div id="skill-result-model" class="model-badge"></div>
        </div>

        <!-- Missing Context Input Modal / Prompt Drawer (e.g. for selectedText) -->
        <div id="skill-context-drawer" class="skill-context-drawer" style="display: none;">
          <h4 id="skill-context-drawer-title">✍️ Additional Input Needed</h4>
          <p id="skill-context-drawer-desc" class="skill-context-desc">
            This skill requires selected text. Please enter or paste the text below:
          </p>
          <textarea id="skill-context-input" class="form-input" rows="3" placeholder="Paste or type text here…"></textarea>
          <div class="skill-context-actions">
            <button type="button" id="btn-cancel-context-drawer" class="btn btn-secondary btn-sm">Cancel</button>
            <button type="button" id="btn-submit-context-drawer" class="btn btn-primary btn-sm">Run Skill</button>
          </div>
        </div>

        <!-- Skills List Grid -->
        <div id="skills-list" class="skills-list">
          <div class="skills-loading-skeleton">
            <div class="loading-spinner"></div>
            <span>Loading skills…</span>
          </div>
        </div>

      </div>

      <!-- ── Create / Edit Skill Modal ────────────────────────── -->
      <div id="skill-modal" class="modal-overlay" style="display: none;">
        <div class="modal skill-modal-box" role="dialog" aria-labelledby="skill-modal-title">
          <div class="modal-header">
            <h2 id="skill-modal-title">⚡ Create New Skill</h2>
            <button type="button" id="btn-close-skill-modal" class="icon-btn" aria-label="Close modal">✕</button>
          </div>
          <div class="modal-body">
            <form id="skill-form" autocomplete="off">
              <input type="hidden" id="skill-form-id" value="" />

              <div class="form-row-two-col">
                <div class="form-group">
                  <label class="form-label" for="skill-name">Skill Name *</label>
                  <input
                    type="text"
                    id="skill-name"
                    class="form-input"
                    placeholder="e.g. 3-Point Summary"
                    maxlength="100"
                    required
                  />
                </div>

                <div class="form-group">
                  <label class="form-label" for="skill-icon">Icon (Emoji)</label>
                  <input
                    type="text"
                    id="skill-icon"
                    class="form-input skill-icon-input"
                    placeholder="⚡"
                    maxlength="5"
                    value="⚡"
                  />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="skill-category">Category</label>
                <select id="skill-category" class="form-input">
                  <option value="custom">Custom Recipe</option>
                  <option value="summary">Summary & Notes</option>
                  <option value="reply">Reply & Communication</option>
                  <option value="form">Form & Automation</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="skill-description">Description</label>
                <input
                  type="text"
                  id="skill-description"
                  class="form-input"
                  placeholder="e.g. Extracts three high-impact takeaways from any webpage."
                  maxlength="300"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="skill-template">Prompt Template *</label>
                <span class="form-hint">
                  Supports dynamic variables: Click a tag below to insert it.
                </span>
                <div class="skill-variable-tags">
                  <button type="button" class="variable-tag-btn" data-tag="{{selectedText}}">{{selectedText}}</button>
                  <button type="button" class="variable-tag-btn" data-tag="{{pageContent}}">{{pageContent}}</button>
                  <button type="button" class="variable-tag-btn" data-tag="{{profile.fullName}}">{{profile.fullName}}</button>
                  <button type="button" class="variable-tag-btn" data-tag="{{profile.email}}">{{profile.email}}</button>
                  <button type="button" class="variable-tag-btn" data-tag="{{profile.skills}}">{{profile.skills}}</button>
                  <button type="button" class="variable-tag-btn" data-tag="{{profile.preferredTone}}">{{profile.preferredTone}}</button>
                </div>
                <textarea
                  id="skill-template"
                  class="form-input skill-template-textarea"
                  rows="5"
                  placeholder="Summarise the following content in 3 bullet points:&#10;&#10;{{selectedText}}"
                  required
                ></textarea>
              </div>

              <div class="form-group">
                <label class="form-label">Context Requirements</label>
                <span class="form-hint">Select what information this skill needs to run</span>
                <div class="skill-checkbox-grid">
                  <label class="skill-checkbox-label">
                    <input type="checkbox" id="skill-req-page" />
                    <span>📄 Requires Page Content</span>
                  </label>
                  <label class="skill-checkbox-label">
                    <input type="checkbox" id="skill-req-selection" />
                    <span>✍️ Requires Selected Text</span>
                  </label>
                  <label class="skill-checkbox-label">
                    <input type="checkbox" id="skill-req-profile" />
                    <span>👤 Requires User Profile</span>
                  </label>
                  <label class="skill-checkbox-label">
                    <input type="checkbox" id="skill-req-agent" />
                    <span>🤖 Trigger Autonomous Agent Loop</span>
                  </label>
                </div>
              </div>

              <div id="skill-form-error" class="status-text error-text" style="display: none;"></div>

              <div class="modal-footer">
                <button type="button" id="btn-cancel-skill-form" class="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" id="btn-save-skill-form" class="btn btn-primary">
                  💾 Save Skill
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    loadAndRenderSkills();
  }

  /**
   * Bind event listeners.
   */
  function bindEvents() {
    const btnCreate = _container.querySelector('#btn-create-skill');
    const btnExport = _container.querySelector('#btn-export-skills');
    const btnImport = _container.querySelector('#btn-import-skills');
    const fileImport = _container.querySelector('#file-import-skills');
    const btnCloseModal = _container.querySelector('#btn-close-skill-modal');
    const btnCancelModal = _container.querySelector('#btn-cancel-skill-form');
    const skillForm = _container.querySelector('#skill-form');
    const skillModal = _container.querySelector('#skill-modal');
    const btnCloseResult = _container.querySelector('#btn-close-skill-result');
    const btnCopyResult = _container.querySelector('#btn-copy-skill-result');

    btnCreate.addEventListener('click', openCreateModal);
    btnExport.addEventListener('click', onExportSkills);
    btnImport.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', onImportFileSelected);

    btnCloseModal.addEventListener('click', closeSkillModal);
    btnCancelModal.addEventListener('click', closeSkillModal);
    skillForm.addEventListener('submit', onSaveSkillSubmit);

    // Close modal on background click
    skillModal.addEventListener('click', (e) => {
      if (e.target === skillModal) closeSkillModal();
    });

    // Close result card
    btnCloseResult.addEventListener('click', () => {
      const card = _container.querySelector('#skill-result-card');
      if (card) card.style.display = 'none';
    });

    // Copy result
    btnCopyResult.addEventListener('click', onCopyResult);

    // Variable insertion chips in modal
    _container.querySelectorAll('.variable-tag-btn').forEach((tagBtn) => {
      tagBtn.addEventListener('click', () => {
        insertVariableTag(tagBtn.dataset.tag);
      });
    });
  }

  /**
   * Inserts variable tag into template textarea at cursor position.
   */
  function insertVariableTag(tag) {
    const textarea = _container.querySelector('#skill-template');
    if (!textarea || !tag) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const current = textarea.value;

    textarea.value = current.substring(0, start) + tag + current.substring(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + tag.length;
  }

  /**
   * Loads skills from storage and renders the cards grid.
   */
  async function loadAndRenderSkills() {
    try {
      if (globalThis.SkillsStore && typeof SkillsStore.getSkills === 'function') {
        _skills = await SkillsStore.getSkills();
      } else {
        const res = await chrome.runtime.sendMessage({ type: 'GET_SKILLS' });
        _skills = res?.data || [];
      }

      renderSkillCards(_skills);
    } catch (err) {
      console.warn('[SkillsView] Failed to load skills:', err);
      const listEl = _container.querySelector('#skills-list');
      if (listEl) {
        listEl.innerHTML = `
          <div class="skills-empty-state">
            <span class="empty-icon">⚠️</span>
            <p>Could not load skills. Please reopen the panel.</p>
          </div>
        `;
      }
    }
  }

  /**
   * Render skill cards into #skills-list.
   */
  function renderSkillCards(skills) {
    const listEl = _container.querySelector('#skills-list');
    if (!listEl) return;

    if (!Array.isArray(skills) || skills.length === 0) {
      listEl.innerHTML = `
        <div class="skills-empty-state">
          <span class="empty-icon">⚡</span>
          <h4>No skills yet</h4>
          <p>Create your first custom prompt recipe above or import skills.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';

    skills.forEach((skill) => {
      const card = document.createElement('div');
      card.className = `skill-card ${skill.builtIn ? 'skill-card-builtin' : ''}`;
      card.dataset.skillId = skill.id;

      // Category badge text
      const catLabel = skill.category ? (skill.category.charAt(0).toUpperCase() + skill.category.slice(1)) : 'Custom';

      // Requirements tag HTML
      const reqTags = [];
      if (skill.requiresPageContent) reqTags.push('<span class="skill-req-tag">📄 Page</span>');
      if (skill.requiresSelectedText) reqTags.push('<span class="skill-req-tag">✍️ Selection</span>');
      if (skill.requiresProfile) reqTags.push('<span class="skill-req-tag">👤 Profile</span>');
      if (skill.requiresAgentLoop) reqTags.push('<span class="skill-req-tag skill-req-agent">🤖 Agent</span>');

      card.innerHTML = `
        <div class="skill-card-top">
          <div class="skill-card-main-info">
            <span class="skill-card-icon">${escapeHtml(skill.icon || '⚡')}</span>
            <div class="skill-card-title-group">
              <h4 class="skill-card-name">${escapeHtml(skill.name)}</h4>
              <div class="skill-card-badges">
                <span class="skill-category-badge">${escapeHtml(catLabel)}</span>
                ${skill.builtIn ? '<span class="skill-builtin-badge">Built-in</span>' : ''}
              </div>
            </div>
          </div>
        </div>

        <p class="skill-card-desc">${escapeHtml(skill.description || 'No description provided.')}</p>

        <div class="skill-card-reqs">
          ${reqTags.join('')}
        </div>

        <div class="skill-card-footer">
          <button type="button" class="btn btn-primary btn-sm btn-run-skill" data-id="${escapeHtml(skill.id)}">
            ${skill.requiresAgentLoop ? '🤖 Run Agent' : '▶️ Run'}
          </button>
          <div class="skill-card-minor-actions">
            <button type="button" class="icon-btn btn-duplicate-skill" data-id="${escapeHtml(skill.id)}" title="Duplicate & customize this skill">
              📋
            </button>
            ${!skill.builtIn ? `
              <button type="button" class="icon-btn btn-delete-skill" data-id="${escapeHtml(skill.id)}" title="Delete this custom skill">
                🗑️
              </button>
            ` : ''}
          </div>
        </div>
      `;

      // Bind button events
      card.querySelector('.btn-run-skill').addEventListener('click', () => onRunSkill(skill));
      card.querySelector('.btn-duplicate-skill').addEventListener('click', () => onDuplicateSkill(skill));
      const btnDel = card.querySelector('.btn-delete-skill');
      if (btnDel) {
        btnDel.addEventListener('click', () => onDeleteSkill(skill));
      }

      listEl.appendChild(card);
    });
  }

  /**
   * Handle Run Skill click.
   */
  async function onRunSkill(skill) {
    if (!skill) return;

    // 1. Fetch current tab context
    let pageContext = { url: '', title: '', selectedText: '', pageContent: '', isRestricted: false };
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PAGE_CONTEXT' });
      if (res?.success && res.data) {
        pageContext = res.data;
      }
    } catch (err) {
      console.warn('[SkillsView] Could not fetch page context:', err);
    }

    // 2. Fetch user profile
    let profile = null;
    try {
      if (globalThis.ProfileStore && typeof ProfileStore.getProfile === 'function') {
        profile = await ProfileStore.getProfile();
      } else {
        const pRes = await chrome.runtime.sendMessage({ type: 'GET_PROFILE' });
        profile = pRes?.data || null;
      }
    } catch (e) {
      console.warn('[SkillsView] Could not load profile:', e);
    }

    // Edge case 4.2.4: Skill requires profile, but profile is empty
    if (skill.requiresProfile) {
      if (!profile || Object.keys(profile).every(k => !profile[k])) {
        const confirmed = window.confirm(
          `The skill "${skill.name}" requires your user profile information, but your Profile is currently empty.\n\nWould you like to open the Profile tab now to fill it in?`
        );
        if (confirmed && window.SahayakApp && typeof SahayakApp.switchTab === 'function') {
          SahayakApp.switchTab('profile');
        }
        return;
      }
    }

    // 3. Check for selected text requirement
    if (skill.requiresSelectedText && !pageContext.selectedText) {
      // Prompt user with inline context drawer
      openContextDrawer(skill, pageContext, profile);
      return;
    }

    // 4. Execute the skill with gathered context
    await executeSkillWithContext(skill, pageContext, profile);
  }

  /**
   * Prompts the user to provide selected/custom text when required.
   */
  function openContextDrawer(skill, pageContext, profile) {
    const drawer = _container.querySelector('#skill-context-drawer');
    const input = _container.querySelector('#skill-context-input');
    const title = _container.querySelector('#skill-context-drawer-title');
    const btnCancel = _container.querySelector('#btn-cancel-context-drawer');
    const btnSubmit = _container.querySelector('#btn-submit-context-drawer');

    title.textContent = `✍️ Input for "${skill.name}"`;
    input.value = '';
    drawer.style.display = 'block';
    drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    input.focus();

    const cleanup = () => {
      drawer.style.display = 'none';
      btnCancel.removeEventListener('click', onCancel);
      btnSubmit.removeEventListener('click', onSubmit);
    };

    const onCancel = () => cleanup();
    const onSubmit = async () => {
      const text = input.value.trim();
      if (!text) {
        alert('Please enter or paste some text to run this skill.');
        return;
      }
      cleanup();
      const updatedContext = { ...pageContext, selectedText: text };
      await executeSkillWithContext(skill, updatedContext, profile);
    };

    btnCancel.addEventListener('click', onCancel);
    btnSubmit.addEventListener('click', onSubmit);
  }

  /**
   * Executes the skill prompt after variable substitution.
   */
  async function executeSkillWithContext(skill, pageContext, profile) {
    // Perform template substitution
    const { substituted, missingVariables } = SkillsStore.substituteTemplate(skill.promptTemplate, {
      selectedText: pageContext.selectedText,
      pageContent: pageContext.pageContent,
      pageTitle: pageContext.title,
      pageUrl: pageContext.url,
      profile: profile || {}
    });

    if (missingVariables.length > 0 && skill.requiresProfile) {
      console.warn('[SkillsView] Some profile variables were empty:', missingVariables);
    }

    // ── Branch A: Autonomous Agent Loop (requiresAgentLoop: true) ─────
    if (skill.requiresAgentLoop) {
      if (window.SahayakApp && typeof SahayakApp.switchTab === 'function') {
        SahayakApp.switchTab('agent');
      }

      // Populate goal in AgentView and focus
      const goalInput = document.getElementById('agent-goal-input');
      if (goalInput) {
        goalInput.value = substituted;
        goalInput.focus();
        showStatus(`Loaded "${skill.name}" into Agent. Click "Start Agent" to begin.`, 'info');
      }
      return;
    }

    // ── Branch B: AI Text Generation ─────────────────────────────────
    showResultLoading(skill);

    try {
      const lang = (window.SahayakApp && typeof SahayakApp.getCurrentLanguage === 'function')
        ? SahayakApp.getCurrentLanguage()
        : 'en';

      const res = await chrome.runtime.sendMessage({
        type: 'EXECUTE_SKILL',
        payload: {
          prompt: substituted,
          language: lang
        }
      });

      if (!res || !res.success) {
        throw new Error(res?.error?.message || 'Skill execution failed.');
      }

      showResultSuccess(skill, res.data);
    } catch (err) {
      console.error('[SkillsView] Skill execution error:', err);
      showResultError(err.message || 'An error occurred while running the skill.');
    }
  }

  /**
   * Shows loading state inside result card.
   */
  function showResultLoading(skill) {
    const card = _container.querySelector('#skill-result-card');
    const iconEl = _container.querySelector('#skill-result-icon');
    const nameEl = _container.querySelector('#skill-result-name');
    const loadingEl = _container.querySelector('#skill-result-loading');
    const errorEl = _container.querySelector('#skill-result-error');
    const textEl = _container.querySelector('#skill-result-text');
    const modelEl = _container.querySelector('#skill-result-model');

    iconEl.textContent = skill.icon || '⚡';
    nameEl.textContent = skill.name;
    loadingEl.style.display = 'flex';
    errorEl.style.display = 'none';
    textEl.innerHTML = '';
    textEl.style.display = 'none';
    modelEl.textContent = '';
    modelEl.style.display = 'none';

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Displays successful skill output in result card.
   */
  function showResultSuccess(skill, data) {
    const loadingEl = _container.querySelector('#skill-result-loading');
    const textEl = _container.querySelector('#skill-result-text');
    const modelEl = _container.querySelector('#skill-result-model');

    loadingEl.style.display = 'none';
    textEl.style.display = 'block';
    textEl.innerHTML = formatMarkdown(data.text || '');

    const backupText = data.isFallback ? ' (Backup Groq)' : '';
    modelEl.textContent = `⚡ ${data.model || 'Gemini'}${backupText}`;
    modelEl.style.display = 'inline-block';
  }

  /**
   * Displays error in result card.
   */
  function showResultError(errMsg) {
    const loadingEl = _container.querySelector('#skill-result-loading');
    const errorEl = _container.querySelector('#skill-result-error');
    const errorText = _container.querySelector('#skill-error-text');

    loadingEl.style.display = 'none';
    errorText.textContent = errMsg;
    errorEl.style.display = 'block';
  }

  /**
   * Copy result text to clipboard.
   */
  async function onCopyResult() {
    const textEl = _container.querySelector('#skill-result-text');
    const btnCopy = _container.querySelector('#btn-copy-skill-result');
    if (!textEl || !btnCopy) return;

    try {
      await navigator.clipboard.writeText(textEl.innerText || textEl.textContent || '');
      btnCopy.textContent = '✓ Copied';
      setTimeout(() => {
        btnCopy.textContent = '📋 Copy';
      }, 1500);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  }

  /**
   * Open the Create / Edit Skill modal.
   */
  function openCreateModal() {
    const modal = _container.querySelector('#skill-modal');
    const title = _container.querySelector('#skill-modal-title');
    const form = _container.querySelector('#skill-form');
    const errBox = _container.querySelector('#skill-form-error');

    form.reset();
    _container.querySelector('#skill-form-id').value = '';
    _container.querySelector('#skill-icon').value = '⚡';
    title.textContent = '⚡ Create New Skill';
    errBox.style.display = 'none';

    modal.style.display = 'flex';
    _container.querySelector('#skill-name').focus();
  }

  /**
   * Close the modal.
   */
  function closeSkillModal() {
    const modal = _container.querySelector('#skill-modal');
    modal.style.display = 'none';
  }

  /**
   * Save skill form submit.
   */
  async function onSaveSkillSubmit(e) {
    if (e) e.preventDefault();

    const errBox = _container.querySelector('#skill-form-error');
    errBox.style.display = 'none';

    const id = _container.querySelector('#skill-form-id').value;
    const name = _container.querySelector('#skill-name').value.trim();
    const icon = _container.querySelector('#skill-icon').value.trim() || '⚡';
    const category = _container.querySelector('#skill-category').value;
    const description = _container.querySelector('#skill-description').value.trim();
    const promptTemplate = _container.querySelector('#skill-template').value.trim();

    const reqPage = _container.querySelector('#skill-req-page').checked;
    const reqSel = _container.querySelector('#skill-req-selection').checked;
    const reqProf = _container.querySelector('#skill-req-profile').checked;
    const reqAgent = _container.querySelector('#skill-req-agent').checked;

    // Edge case 4.2.6: Validation
    if (name.length < 2) {
      errBox.textContent = 'Skill name must be at least 2 characters.';
      errBox.style.display = 'block';
      return;
    }

    if (promptTemplate.length < 10) {
      errBox.textContent = 'Skill prompt template must be at least 10 characters.';
      errBox.style.display = 'block';
      return;
    }

    const skillData = {
      id: id || undefined,
      name,
      icon,
      category,
      description,
      promptTemplate,
      requiresPageContent: reqPage,
      requiresSelectedText: reqSel,
      requiresProfile: reqProf,
      requiresAgentLoop: reqAgent
    };

    try {
      if (globalThis.SkillsStore && typeof SkillsStore.saveSkill === 'function') {
        await SkillsStore.saveSkill(skillData);
      } else {
        const res = await chrome.runtime.sendMessage({ type: 'SAVE_SKILL', payload: skillData });
        if (!res?.success) throw new Error(res?.error?.message || 'Save failed.');
      }

      closeSkillModal();
      showStatus(`✅ Skill "${name}" saved!`, 'success');
      await loadAndRenderSkills();
    } catch (err) {
      errBox.textContent = err.message || 'Could not save skill.';
      errBox.style.display = 'block';
    }
  }

  /**
   * Duplicate a skill (can duplicate built-ins into customizable copies).
   */
  function onDuplicateSkill(skill) {
    openCreateModal();
    const title = _container.querySelector('#skill-modal-title');
    title.textContent = `📋 Duplicate "${skill.name}"`;

    _container.querySelector('#skill-form-id').value = ''; // new id
    _container.querySelector('#skill-name').value = `${skill.name} (Copy)`;
    _container.querySelector('#skill-icon').value = skill.icon || '⚡';
    _container.querySelector('#skill-category').value = skill.category || 'custom';
    _container.querySelector('#skill-description').value = skill.description || '';
    _container.querySelector('#skill-template').value = skill.promptTemplate || '';

    _container.querySelector('#skill-req-page').checked = Boolean(skill.requiresPageContent);
    _container.querySelector('#skill-req-selection').checked = Boolean(skill.requiresSelectedText);
    _container.querySelector('#skill-req-profile').checked = Boolean(skill.requiresProfile);
    _container.querySelector('#skill-req-agent').checked = Boolean(skill.requiresAgentLoop);
  }

  /**
   * Delete a custom skill.
   */
  async function onDeleteSkill(skill) {
    // Edge case 4.2.7: Built-in deletion prevention
    if (skill.builtIn) {
      alert('Built-in skills cannot be deleted.');
      return;
    }

    const confirmed = window.confirm(`Are you sure you want to delete the skill "${skill.name}"?`);
    if (!confirmed) return;

    try {
      if (globalThis.SkillsStore && typeof SkillsStore.deleteSkill === 'function') {
        await SkillsStore.deleteSkill(skill.id);
      } else {
        const res = await chrome.runtime.sendMessage({ type: 'DELETE_SKILL', payload: { id: skill.id } });
        if (!res?.success) throw new Error(res?.error?.message || 'Delete failed.');
      }

      showStatus(`🗑️ Deleted "${skill.name}".`, 'info');
      await loadAndRenderSkills();
    } catch (err) {
      alert(`Could not delete skill: ${err.message}`);
    }
  }

  /**
   * Export all skills to JSON file download (Edge case 4.2.8).
   */
  async function onExportSkills() {
    try {
      let json = '';
      if (globalThis.SkillsStore && typeof SkillsStore.exportSkills === 'function') {
        json = await SkillsStore.exportSkills(true);
      } else {
        const skills = _skills || [];
        json = JSON.stringify(skills, null, 2);
      }

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sahayak-skills.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatus('📤 Exported skills to sahayak-skills.json', 'success');
    } catch (err) {
      console.error('[SkillsView] Export failed:', err);
      showStatus('Failed to export skills.', 'error');
    }
  }

  /**
   * Import skills from uploaded JSON file.
   * Handles Edge cases 4.2.1, 4.2.2, 4.2.3, 4.2.5.
   */
  async function onImportFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonString = event.target.result;
        let result = null;

        if (globalThis.SkillsStore && typeof SkillsStore.importSkills === 'function') {
          result = await SkillsStore.importSkills(jsonString);
        } else {
          const res = await chrome.runtime.sendMessage({
            type: 'IMPORT_SKILLS',
            payload: { jsonString }
          });
          if (!res?.success) throw new Error(res?.error?.message || 'Import failed.');
          result = res.data;
        }

        if (result.skipped > 0) {
          showStatus(`📥 Imported ${result.imported} skills (${result.skipped} skipped due to invalid format).`, 'info');
        } else {
          showStatus(`📥 Successfully imported ${result.imported} skills!`, 'success');
        }

        await loadAndRenderSkills();
      } catch (err) {
        alert(err.message || 'Import failed. Please check the JSON format.');
      } finally {
        e.target.value = ''; // reset file input
      }
    };

    reader.readAsText(file);
  }

  /**
   * Basic markdown formatter.
   */
  function formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^### (.*$)/gim, '<h5 class="markdown-h3">$1</h5>')
      .replace(/^## (.*$)/gim, '<h4 class="markdown-h2">$1</h4>')
      .replace(/^# (.*$)/gim, '<h3 class="markdown-h1">$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^\s*[-*]\s+(.*$)/gim, '<li class="markdown-li">$1</li>')
      .replace(/\n\n/g, '<p></p>')
      .replace(/\n/g, '<br/>');
  }

  /**
   * HTML escape helper.
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Show transient status alert.
   */
  function showStatus(message, type = 'success') {
    const alertEl = _container.querySelector('#skills-status-alert');
    if (!alertEl) return;

    if (_statusTimer) {
      clearTimeout(_statusTimer);
      _statusTimer = null;
    }

    alertEl.textContent = message;
    alertEl.className = `skills-status-alert skills-status-${type}`;
    alertEl.style.display = 'block';

    _statusTimer = setTimeout(() => {
      alertEl.style.display = 'none';
      _statusTimer = null;
    }, 4000);
  }

  return {
    render,
    loadAndRenderSkills
  };
})();

globalThis.SkillsView = SkillsView;

