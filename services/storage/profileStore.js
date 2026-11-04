/**
 * Sahayak — Local Profile Memory Store (Slice 4.1)
 *
 * Manages local user profile data in chrome.storage.local (key: sahayak_user_profile).
 * Provides CRUD operations, field validation, length capping, and HTML stripping.
 * Profile data is strictly local and never sent to external servers except as
 * context in AI prompts.
 *
 * Architecture references: §13 (Local Profile Memory), Edge cases 4.1.1 - 4.1.4
 */

(function () {
  'use strict';

  const PROFILE_STORAGE_KEY = 'sahayak_user_profile';

  /**
   * Field length and count constraints (Edge case 4.1.2)
   */
  const FIELD_CONSTRAINTS = {
    fullName: 100,
    email: 100,
    phone: 30,
    city: 100,
    college: 150,
    degree: 100,
    major: 100,
    graduationYear: 10,
    gpa: 20,
    bio: 500,
    linkedIn: 200,
    github: 200,
    portfolio: 200,
    maxSkillsCount: 20,
    maxSkillLength: 50
  };

  /**
   * Allowed preference values
   */
  const ALLOWED_LANGUAGES = ['en', 'hi-en'];
  const ALLOWED_TONES = ['concise', 'detailed', 'formal', 'casual'];

  /**
   * Default empty user profile schema (§13.1)
   */
  const DEFAULT_PROFILE = Object.freeze({
    fullName: '',
    email: '',
    phone: '',
    city: '',
    college: '',
    degree: '',
    major: '',
    graduationYear: '',
    gpa: '',
    skills: [],
    bio: '',
    linkedIn: '',
    github: '',
    portfolio: '',
    preferredLanguage: 'en',
    preferredTone: 'formal',
    lastUpdated: 0
  });

  /**
   * Strip HTML tags and adversarial prompt injection delimiters (Edge case 4.1.1).
   * Safe for both Service Worker and Window contexts (no DOM dependency).
   *
   * @param {string} input
   * @returns {string}
   */
  function stripHtml(input) {
    if (typeof input !== 'string') return '';
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script blocks and content
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove style blocks and content
      .replace(/<[^>]*>/g, '') // Strip remaining HTML tags
      .replace(/<\/?USER_PROFILE>/gi, '') // Strip adversarial delimiter tags
      .trim();
  }

  /**
   * Parse skills from an array or comma-separated string into a clean array.
   *
   * @param {string|Array<string>} skillsInput
   * @returns {Array<string>}
   */
  function parseSkills(skillsInput) {
    let items = [];
    if (Array.isArray(skillsInput)) {
      items = skillsInput;
    } else if (typeof skillsInput === 'string') {
      items = skillsInput.split(',');
    }

    return items
      .map(s => stripHtml(s).substring(0, FIELD_CONSTRAINTS.maxSkillLength))
      .filter(s => s.length > 0)
      .slice(0, FIELD_CONSTRAINTS.maxSkillsCount);
  }

  /**
   * Validate and sanitize a raw profile object.
   * Enforces length caps, HTML stripping, and defaults.
   *
   * @param {Object} raw
   * @returns {Object} Sanitized profile
   */
  function sanitizeProfile(raw = {}) {
    if (!raw || typeof raw !== 'object') {
      return { ...DEFAULT_PROFILE };
    }

    const clean = {
      fullName: stripHtml(raw.fullName || '').substring(0, FIELD_CONSTRAINTS.fullName),
      email: stripHtml(raw.email || '').substring(0, FIELD_CONSTRAINTS.email),
      phone: stripHtml(raw.phone || '').substring(0, FIELD_CONSTRAINTS.phone),
      city: stripHtml(raw.city || '').substring(0, FIELD_CONSTRAINTS.city),
      college: stripHtml(raw.college || '').substring(0, FIELD_CONSTRAINTS.college),
      degree: stripHtml(raw.degree || '').substring(0, FIELD_CONSTRAINTS.degree),
      major: stripHtml(raw.major || '').substring(0, FIELD_CONSTRAINTS.major),
      graduationYear: stripHtml(raw.graduationYear || '').substring(0, FIELD_CONSTRAINTS.graduationYear),
      gpa: stripHtml(raw.gpa || '').substring(0, FIELD_CONSTRAINTS.gpa),
      skills: parseSkills(raw.skills),
      bio: stripHtml(raw.bio || '').substring(0, FIELD_CONSTRAINTS.bio),
      linkedIn: stripHtml(raw.linkedIn || '').substring(0, FIELD_CONSTRAINTS.linkedIn),
      github: stripHtml(raw.github || '').substring(0, FIELD_CONSTRAINTS.github),
      portfolio: stripHtml(raw.portfolio || '').substring(0, FIELD_CONSTRAINTS.portfolio),
      preferredLanguage: ALLOWED_LANGUAGES.includes(raw.preferredLanguage) ? raw.preferredLanguage : 'en',
      preferredTone: ALLOWED_TONES.includes(raw.preferredTone) ? raw.preferredTone : 'formal',
      lastUpdated: typeof raw.lastUpdated === 'number' ? raw.lastUpdated : Date.now()
    };

    return clean;
  }

  /**
   * Formats profile for AI prompt injection.
   * Only includes populated, non-empty fields to prevent sending undefined
   * or blank fields to the model (Edge case 4.1.3).
   *
   * @param {Object} profile
   * @returns {Object|null} Clean key-value object of non-empty fields, or null if empty
   */
  function formatProfileForPrompt(profile) {
    if (!profile || typeof profile !== 'object') return null;

    const filtered = {};
    if (profile.fullName) filtered.fullName = profile.fullName;
    if (profile.email) filtered.email = profile.email;
    if (profile.phone) filtered.phone = profile.phone;
    if (profile.city) filtered.city = profile.city;
    if (profile.college) filtered.college = profile.college;
    if (profile.degree) filtered.degree = profile.degree;
    if (profile.major) filtered.major = profile.major;
    if (profile.graduationYear) filtered.graduationYear = profile.graduationYear;
    if (profile.gpa) filtered.gpa = profile.gpa;
    if (Array.isArray(profile.skills) && profile.skills.length > 0) {
      filtered.skills = profile.skills;
    }
    if (profile.bio) filtered.bio = profile.bio;
    if (profile.linkedIn) filtered.linkedIn = profile.linkedIn;
    if (profile.github) filtered.github = profile.github;
    if (profile.portfolio) filtered.portfolio = profile.portfolio;
    if (profile.preferredLanguage) filtered.preferredLanguage = profile.preferredLanguage;
    if (profile.preferredTone) filtered.preferredTone = profile.preferredTone;

    return Object.keys(filtered).length > 0 ? filtered : null;
  }

  /**
   * Retrieves the stored user profile from chrome.storage.local.
   *
   * @returns {Promise<Object|null>} Sanitized user profile or null if not saved
   */
  async function getProfile() {
    try {
      if (chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get(PROFILE_STORAGE_KEY);
        if (stored && stored[PROFILE_STORAGE_KEY]) {
          return sanitizeProfile(stored[PROFILE_STORAGE_KEY]);
        }
      }
    } catch (err) {
      console.warn('[ProfileStore] Failed to read user profile:', err);
    }
    return null;
  }

  /**
   * Saves a user profile to chrome.storage.local.
   * Validates, sanitizes, and timestamps the profile before storing.
   *
   * @param {Object} profileData
   * @returns {Promise<Object>} The saved, sanitized profile
   */
  async function saveProfile(profileData) {
    const sanitized = sanitizeProfile({
      ...profileData,
      lastUpdated: Date.now()
    });

    try {
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: sanitized });
      }
      return sanitized;
    } catch (err) {
      console.error('[ProfileStore] Failed to save user profile:', err);
      throw err;
    }
  }

  /**
   * Clears the user profile from chrome.storage.local.
   *
   * @returns {Promise<boolean>}
   */
  async function clearProfile() {
    try {
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove(PROFILE_STORAGE_KEY);
        return true;
      }
    } catch (err) {
      console.error('[ProfileStore] Failed to clear user profile:', err);
      throw err;
    }
    return false;
  }

  const ProfileStore = {
    PROFILE_STORAGE_KEY,
    FIELD_CONSTRAINTS,
    DEFAULT_PROFILE,
    stripHtml,
    parseSkills,
    sanitizeProfile,
    formatProfileForPrompt,
    getProfile,
    saveProfile,
    clearProfile
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProfileStore;
  }
  globalThis.ProfileStore = ProfileStore;
})();
