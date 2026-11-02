/**
 * Sahayak — Right-Click Context Menus (Slice 2.2)
 *
 * Implements:
 *  - Registration of right-click menu items for selected text:
 *    - "Sahayak: Explain this"
 *    - "Sahayak: Translate"
 *    - "Sahayak: Draft a reply"
 *  - Opening the side panel on menu click
 *  - Passing the selected text and action type to the side panel
 *
 * Edge cases covered:
 *  2.2.1 — Selection inside iframe: session storage persistence handles delayed panel initialization
 *  2.2.2 — Extremely long selection: truncates to 2,000 characters and flags isTruncated
 *  2.2.3 — Empty selection guard
 *  2.2.4 — Side panel never opened: opens panel first, stores in session storage, sends message
 *  2.2.5 — "Draft a reply" on non-message text handled by prompt instructions
 */

(function () {
  'use strict';

  const MENU_ITEMS = [
    { id: 'sahayak-explain', title: 'Sahayak: Explain this' },
    { id: 'sahayak-translate', title: 'Sahayak: Translate' },
    { id: 'sahayak-draft-reply', title: 'Sahayak: Draft a reply' },
  ];

  const MAX_SELECTION_CHARS = 2000;
  const PENDING_STORAGE_KEY = 'sahayak_pending_context_action';

  /**
   * Register context menu items cleanly.
   */
  function registerContextMenus() {
    if (!chrome.contextMenus) return;

    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        // Silently ignore removeAll errors on fresh install
      }

      for (const item of MENU_ITEMS) {
        chrome.contextMenus.create({
          id: item.id,
          title: item.title,
          contexts: ['selection'],
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[Sahayak] Could not create menu '${item.id}':`, chrome.runtime.lastError.message);
          }
        });
      }
      console.log('[Sahayak] Context menus registered successfully.');
    });
  }

  // Register on install and update
  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenus();
  });

  // Re-register on worker startup if needed
  registerContextMenus();

  /**
   * Handle context menu click.
   */
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const rawText = (info.selectionText || '').trim();

    // Edge case 2.2.3: No text selected
    if (!rawText) {
      console.warn('[Sahayak] Context menu clicked with empty selection.');
      return;
    }

    // Edge case 2.2.2: Truncate very long text to 2,000 characters
    let text = rawText;
    let isTruncated = false;
    if (text.length > MAX_SELECTION_CHARS) {
      text = text.substring(0, MAX_SELECTION_CHARS);
      isTruncated = true;
    }

    // Determine normalized action ('explain', 'translate', 'draft_reply')
    const rawAction = info.menuItemId.replace('sahayak-', '');
    const action = rawAction.replace(/-/g, '_');

    const payload = {
      action,
      text,
      isTruncated,
      timestamp: Date.now()
    };

    // Edge case 2.2.1 & 2.2.4: Persist in session storage so side panel
    // can pick it up immediately on boot if panel was not open yet
    try {
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.set({
          [PENDING_STORAGE_KEY]: payload
        });
      }
    } catch (storageErr) {
      console.warn('[Sahayak] Could not store pending context action in session:', storageErr);
    }

    // Open side panel
    if (chrome.sidePanel && chrome.sidePanel.open) {
      try {
        if (tab?.windowId) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        } else if (tab?.id) {
          await chrome.sidePanel.open({ tabId: tab.id });
        }
      } catch (openErr) {
        console.warn('[Sahayak] Could not open side panel for context action:', openErr);
      }
    }

    // Immediate dispatch to already-open side panel
    try {
      await chrome.runtime.sendMessage({
        type: 'CONTEXT_ACTION',
        ...payload
      });
    } catch (msgErr) {
      // Side panel may still be opening; fallback timeout will re-attempt
    }

    // Re-dispatch after short delay (350ms) to ensure panel received it if it was opening
    setTimeout(async () => {
      try {
        await chrome.runtime.sendMessage({
          type: 'CONTEXT_ACTION',
          ...payload
        });
      } catch (e) {
        // Safe to ignore; panel reads from session storage on mount
      }
    }, 350);
  });

  // Export for testing or manual re-init
  globalThis.ContextMenus = {
    registerContextMenus,
    MENU_ITEMS
  };
})();

