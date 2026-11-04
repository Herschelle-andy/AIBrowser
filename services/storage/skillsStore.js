/**
 * Sahayak — One-Click Skills Engine Store (Slice 4.2)
 *
 * Manages saved prompt recipes and built-in skills in chrome.storage.local (key: sahayak_saved_skills).
 * Supports CRUD, template substitution, JSON export, and schema-validated import.
 *
 * Architecture references: §14 (One-Click Skills Engine), Edge cases 4.2.1 - 4.2.8
 */

(function () {
  'use strict';

  const SKILLS_STORAGE_KEY = 'sahayak_saved_skills';

  /**
   * The 4 Built-In Default Skills (§14.2)
   * These skills are read-only / non-deletable, but can be duplicated.
   */
  const BUILT_IN_SKILLS = Object.freeze([
    {
      id: 'builtin-exam-notes',
      name: 'Exam Notes',
      description: 'Extract key definitions, formulas, dates, and revision notes from the page.',
      icon: '📝',
      category: 'summary',
      promptTemplate: 'Extract from this page: key definitions, formulas, important dates, and concepts suitable for exam revision. Format as structured bullet points with clear section headings.\n\nPage Content:\n{{pageContent}}',
      requiresPageContent: true,
      requiresSelectedText: false,
      requiresProfile: false,
      requiresAgentLoop: false,
      builtIn: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    },
    {
      id: 'builtin-explain-hinglish',
      name: 'Explain in Hinglish',
      description: 'Explain selected text or topic in natural Roman-script Hinglish.',
      icon: '🗣️',
      category: 'summary',
      promptTemplate: 'Explain the following content in natural Roman-script Hinglish (Hindi in Roman alphabet, technical terms in English):\n\n{{selectedText}}',
      requiresPageContent: false,
      requiresSelectedText: true,
      requiresProfile: false,
      requiresAgentLoop: false,
      builtIn: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    },
    {
      id: 'builtin-reply-politely',
      name: 'Reply Politely',
      description: 'Draft a polite, professional reply to a message using your tone and profile name.',
      icon: '💬',
      category: 'reply',
      promptTemplate: 'Draft a polite, professional reply to this message.\nTone: {{profile.preferredTone}}\nAuthor: {{profile.fullName}}\nSender Bio Context: {{profile.bio}}\n\nMessage Content:\n{{selectedText}}',
      requiresPageContent: false,
      requiresSelectedText: true,
      requiresProfile: true,
      requiresAgentLoop: false,
      builtIn: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    },
    {
      id: 'builtin-fill-form',
      name: 'Fill Form From Profile',
      description: 'Autonomously fill form fields on the active page using your saved profile memory.',
      icon: '📋',
      category: 'form',
      promptTemplate: 'Fill in the interactive form fields on this page using my profile information (Full Name: {{profile.fullName}}, Email: {{profile.email}}, Phone: {{profile.phone}}, City: {{profile.city}}, College: {{profile.college}}, Degree: {{profile.degree}}, Major: {{profile.major}}, Skills: {{profile.skills}}, LinkedIn: {{profile.linkedIn}}, GitHub: {{profile.github}}). Propose each input step accurately with approval.',
      requiresPageContent: true,
      requiresSelectedText: false,
      requiresProfile: true,
      requiresAgentLoop: true,
      builtIn: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000
    }
  ]);

  /**
   * Allowed categories
   */
  const ALLOWED_CATEGORIES = ['summary', 'reply', 'form', 'custom'];

  /**
   * Strips HTML tags from input string.
   *
   * @param {string} input
   * @returns {string}
   */
  function stripHtml(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/<[^>]*>/g, '').trim();
  }

  /**
   * Generates a unique skill ID.
   *
   * @returns {string}
   */
  function generateSkillId() {
    return 'skill_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  }

  /**
   * Validates and cleans a skill object against the schema.
   *
   * @param {Object} raw
   * @returns {Object} Clean skill
   */
  function validateSkill(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid skill data: must be an object.');
    }

    const name = stripHtml(raw.name || '').substring(0, 100);
    if (name.length < 2) {
      throw new Error('Skill name must be at least 2 characters.');
    }

    const promptTemplate = (raw.promptTemplate || '').trim();
    if (promptTemplate.length < 10) {
      throw new Error('Skill prompt template must be at least 10 characters.');
    }

    const description = stripHtml(raw.description || '').substring(0, 300);
    const icon = stripHtml(raw.icon || '⚡').substring(0, 10) || '⚡';
    const category = ALLOWED_CATEGORIES.includes(raw.category) ? raw.category : 'custom';

    return {
      id: raw.id || generateSkillId(),
      name,
      description,
      icon,
      category,
      promptTemplate,
      requiresPageContent: Boolean(raw.requiresPageContent),
      requiresSelectedText: Boolean(raw.requiresSelectedText),
      requiresProfile: Boolean(raw.requiresProfile),
      requiresAgentLoop: Boolean(raw.requiresAgentLoop),
      builtIn: Boolean(raw.builtIn),
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      updatedAt: Date.now()
    };
  }

  /**
   * Retrieves all skills (built-ins + user custom skills) from chrome.storage.local.
   *
   * @returns {Promise<Array<Object>>}
   */
  async function getSkills() {
    try {
      if (chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get(SKILLS_STORAGE_KEY);
        const userSkills = Array.isArray(stored[SKILLS_STORAGE_KEY]) ? stored[SKILLS_STORAGE_KEY] : [];

        // Map existing by ID
        const skillMap = new Map();

        // 1. Always load the 4 built-in skills first
        for (const b of BUILT_IN_SKILLS) {
          skillMap.set(b.id, { ...b });
        }

        // 2. Load user custom skills (cannot overwrite built-in IDs unless user skills have custom IDs)
        for (const u of userSkills) {
          if (!skillMap.has(u.id)) {
            skillMap.set(u.id, u);
          }
        }

        return Array.from(skillMap.values());
      }
    } catch (err) {
      console.warn('[SkillsStore] Failed to read skills storage, falling back to built-ins:', err);
    }
    return BUILT_IN_SKILLS.map(s => ({ ...s }));
  }

  /**
   * Saves or updates a custom skill.
   *
   * @param {Object} skillData
   * @returns {Promise<Object>} The saved skill
   */
  async function saveSkill(skillData) {
    const validated = validateSkill(skillData);

    // Guard: Built-in skills cannot be directly overwritten (Edge case 4.2.7)
    const isBuiltIn = BUILT_IN_SKILLS.some(b => b.id === validated.id);
    if (isBuiltIn) {
      throw new Error('Built-in skills cannot be modified directly. Duplicate it to make a custom version.');
    }

    try {
      const allSkills = await getSkills();
      const customSkills = allSkills.filter(s => !s.builtIn);

      const existingIndex = customSkills.findIndex(s => s.id === validated.id);
      if (existingIndex >= 0) {
        customSkills[existingIndex] = {
          ...customSkills[existingIndex],
          ...validated,
          builtIn: false,
          updatedAt: Date.now()
        };
      } else {
        customSkills.push({
          ...validated,
          builtIn: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: customSkills });
      }

      return validated;
    } catch (err) {
      console.error('[SkillsStore] Failed to save skill:', err);
      throw err;
    }
  }

  /**
   * Deletes a custom skill by ID.
   * Rejects deletion of built-in skills (Edge case 4.2.7).
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async function deleteSkill(id) {
    if (!id) return false;

    // Check if skill is built-in
    if (BUILT_IN_SKILLS.some(b => b.id === id)) {
      throw new Error('Built-in skills cannot be deleted.');
    }

    try {
      const allSkills = await getSkills();
      const customSkills = allSkills.filter(s => !s.builtIn && s.id !== id);

      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: customSkills });
      }
      return true;
    } catch (err) {
      console.error('[SkillsStore] Failed to delete skill:', err);
      throw err;
    }
  }

  /**
   * Exports all custom skills (or all skills) to a formatted JSON string.
   *
   * @param {boolean} [includeBuiltIns=true]
   * @returns {Promise<string>}
   */
  async function exportSkills(includeBuiltIns = true) {
    const allSkills = await getSkills();
    const skillsToExport = includeBuiltIns ? allSkills : allSkills.filter(s => !s.builtIn);
    return JSON.stringify(skillsToExport, null, 2);
  }

  /**
   * Imports skills from a JSON string with comprehensive schema validation.
   * Handles Edge cases 4.2.1, 4.2.2, 4.2.3, 4.2.5.
   *
   * @param {string} jsonString
   * @returns {Promise<{ success: boolean, imported: number, skipped: number, total: number }>}
   */
  async function importSkills(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw { code: 'INVALID_INPUT', message: 'No file data provided.' };
    }

    // 1. JSON parse validation (Edge case 4.2.1)
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseErr) {
      throw { code: 'INVALID_JSON', message: 'The file is not valid JSON. Please check the format.' };
    }

    if (!Array.isArray(parsed)) {
      throw { code: 'INVALID_FORMAT', message: 'Import file must contain an array of skills.' };
    }

    // 2. Load existing skills to check conflicts (Edge case 4.2.3)
    const existing = await getSkills();
    const existingIds = new Set(existing.map(s => s.id));
    const customList = existing.filter(s => !s.builtIn);

    let importedCount = 0;
    let skippedCount = 0;

    for (const item of parsed) {
      try {
        if (!item || typeof item !== 'object') {
          skippedCount++;
          continue;
        }

        // Schema validation (Edge case 4.2.2)
        const name = (item.name || '').trim();
        const promptTemplate = (item.promptTemplate || '').trim();

        if (name.length < 2 || promptTemplate.length < 10) {
          skippedCount++;
          continue;
        }

        // If ID matches a built-in skill or existing ID, assign a new unique ID (Edge case 4.2.3)
        let skillId = item.id;
        if (!skillId || existingIds.has(skillId) || BUILT_IN_SKILLS.some(b => b.id === skillId)) {
          skillId = generateSkillId();
        }

        const validSkill = validateSkill({
          ...item,
          id: skillId,
          builtIn: false, // Imported skills are always user-editable
          updatedAt: Date.now()
        });

        existingIds.add(validSkill.id);
        customList.push(validSkill);
        importedCount++;
      } catch (err) {
        skippedCount++;
      }
    }

    if (importedCount > 0 && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: customList });
    }

    const updatedTotal = (await getSkills()).length;
    return {
      success: true,
      imported: importedCount,
      skipped: skippedCount,
      total: updatedTotal
    };
  }

  /**
   * Substitutes template placeholders (e.g. {{selectedText}}, {{profile.fullName}})
   * with live context values before prompt execution.
   *
   * @param {string} template
   * @param {Object} context
   * @param {string} [context.selectedText]
   * @param {string} [context.pageContent]
   * @param {string} [context.pageTitle]
   * @param {string} [context.pageUrl]
   * @param {Object} [context.profile]
   * @returns {{ substituted: string, missingVariables: Array<string> }}
   */
  function substituteTemplate(template, context = {}) {
    if (!template || typeof template !== 'string') {
      return { substituted: '', missingVariables: [] };
    }

    const missingVariables = [];

    const substituted = template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
      if (key === 'selectedText') {
        const val = context.selectedText ? String(context.selectedText).trim() : '';
        if (!val) missingVariables.push('selectedText');
        return val;
      }

      if (key === 'pageContent') {
        const val = context.pageContent ? String(context.pageContent).trim() : '';
        if (!val) missingVariables.push('pageContent');
        return val;
      }

      if (key === 'pageTitle') {
        return context.pageTitle ? String(context.pageTitle).trim() : '';
      }

      if (key === 'pageUrl') {
        return context.pageUrl ? String(context.pageUrl).trim() : '';
      }

      if (key.startsWith('profile.')) {
        const field = key.split('.')[1];
        const val = context.profile ? context.profile[field] : null;
        if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
          missingVariables.push(key);
          return '';
        }
        return Array.isArray(val) ? val.join(', ') : String(val);
      }

      // Leave unrecognised tags as is
      return match;
    });

    return {
      substituted: substituted.trim(),
      missingVariables: Array.from(new Set(missingVariables))
    };
  }

  const SkillsStore = {
    SKILLS_STORAGE_KEY,
    BUILT_IN_SKILLS,
    ALLOWED_CATEGORIES,
    stripHtml,
    generateSkillId,
    validateSkill,
    getSkills,
    saveSkill,
    deleteSkill,
    exportSkills,
    importSkills,
    substituteTemplate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SkillsStore;
  }
  globalThis.SkillsStore = SkillsStore;
})();

