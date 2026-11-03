/**
 * Sahayak — Service Worker State Checkpoint & Task History (Slice 3.6)
 *
 * Implements persistent session checkpoints in chrome.storage.session
 * to survive MV3 background service worker idle timeouts (~30s), and
 * local persistent action history in chrome.storage.local.
 *
 * Architecture references: §11.5, §15.2
 */

(function () {
  'use strict';

  const CHECKPOINT_KEY = 'sahayak_agent_checkpoint';
  const HISTORY_KEY = 'sahayak_action_history';

  /**
   * Saves the current agent state machine context as a checkpoint.
   *
   * @param {Object} state - Current agent state context
   * @returns {Promise<boolean>}
   */
  async function saveCheckpoint(state) {
    if (!state || typeof state !== 'object') return false;
    try {
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.set({
          [CHECKPOINT_KEY]: {
            ...state,
            lastCheckpoint: Date.now()
          }
        });
        return true;
      }
    } catch (err) {
      console.warn('[SahayakCheckpoint] Failed to write session checkpoint:', err);
    }
    return false;
  }

  /**
   * Loads the checkpointed agent state from session storage.
   *
   * @returns {Promise<Object|null>}
   */
  async function loadCheckpoint() {
    try {
      if (chrome.storage && chrome.storage.session) {
        const stored = await chrome.storage.session.get(CHECKPOINT_KEY);
        if (stored && stored[CHECKPOINT_KEY]) {
          return stored[CHECKPOINT_KEY];
        }
      }
    } catch (err) {
      console.warn('[SahayakCheckpoint] Failed to read session checkpoint:', err);
    }
    return null;
  }

  /**
   * Clears active checkpoint from session storage (e.g. on task finish or reset).
   *
   * @returns {Promise<boolean>}
   */
  async function clearCheckpoint() {
    try {
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.remove(CHECKPOINT_KEY);
        return true;
      }
    } catch (err) {
      console.warn('[SahayakCheckpoint] Failed to clear session checkpoint:', err);
    }
    return false;
  }

  /**
   * Saves a completed task record to chrome.storage.local action history.
   *
   * @param {Object} taskRecord
   * @returns {Promise<boolean>}
   */
  async function saveTaskHistory(taskRecord) {
    if (!taskRecord || typeof taskRecord !== 'object') return false;
    try {
      if (chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get(HISTORY_KEY);
        const list = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
        list.unshift({
          ...taskRecord,
          id: taskRecord.id || Date.now(),
          savedAt: Date.now()
        });
        // Retain up to 50 most recent task records
        if (list.length > 50) {
          list.length = 50;
        }
        await chrome.storage.local.set({ [HISTORY_KEY]: list });
        return true;
      }
    } catch (err) {
      console.warn('[SahayakCheckpoint] Failed to save task history:', err);
    }
    return false;
  }

  /**
   * Retrieves all completed task records from local storage.
   *
   * @returns {Promise<Array<Object>>}
   */
  async function getTaskHistory() {
    try {
      if (chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get(HISTORY_KEY);
        return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
      }
    } catch (err) {
      console.warn('[SahayakCheckpoint] Failed to get task history:', err);
    }
    return [];
  }

  /**
   * Clears all saved task history records.
   *
   * @returns {Promise<boolean>}
   */
  async function clearTaskHistory() {
    try {
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove(HISTORY_KEY);
        return true;
      }
    } catch (err) {
      console.warn('[SahayakCheckpoint] Failed to clear task history:', err);
    }
    return false;
  }

  // Export module globally
  const SahayakCheckpoint = {
    CHECKPOINT_KEY,
    HISTORY_KEY,
    saveCheckpoint,
    loadCheckpoint,
    clearCheckpoint,
    saveTaskHistory,
    getTaskHistory,
    clearTaskHistory
  };

  globalThis.SahayakCheckpoint = SahayakCheckpoint;
  if (typeof window !== 'undefined') {
    window.SahayakCheckpoint = SahayakCheckpoint;
  }
})();

