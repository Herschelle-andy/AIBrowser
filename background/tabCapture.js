/**
 * Sahayak — Tab Capture Service (Slice 2.3)
 *
 * Wraps chrome.tabs.captureVisibleTab() with validation and safety checks.
 *
 * Edge cases covered:
 *  2.3.1 — Restricted pages (chrome://, Web Store, etc.)
 *  2.3.6 — Captures only what's visible in the tab
 *  2.3.7 — Blocks screenshot capture on sensitive pages (banking, passwords)
 */

(function () {
  'use strict';

  /**
   * Check if URL belongs to a sensitive domain (banking, credentials, payment).
   * Edge case 2.3.7
   *
   * @param {string} url
   * @returns {boolean}
   */
  function isSensitiveDomain(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      const sensitivePatterns = [
        /bank/i,
        /login/i,
        /signin/i,
        /password/i,
        /accounts\.google\.com/i,
        /paypal\.com/i,
        /chase\.com/i,
        /wellsfargo\.com/i,
        /bankofamerica\.com/i,
        /hdfcbank\.com/i,
        /icicibank\.com/i,
        /sbi\.co\.in/i,
        /stripe\.com/i
      ];

      return sensitivePatterns.some((pattern) => pattern.test(host));
    } catch {
      return false;
    }
  }

  /**
   * Capture visible area of the current active browser tab.
   *
   * @param {number|null} [windowId=null]
   * @param {Object} [options]
   * @param {'png'|'jpeg'} [options.format='png']
   * @param {number} [options.quality=90]
   * @returns {Promise<string>} Base64 data URL (e.g. 'data:image/png;base64,...')
   */
  async function captureTab(windowId = null, options = { format: 'png' }) {
    if (!chrome.tabs || !chrome.tabs.captureVisibleTab) {
      throw new Error('Screenshot capture API is not available.');
    }

    // 1. Resolve active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active browser tab found to capture.');
    }

    // 2. Restricted browser pages check (Edge case 2.3.1)
    if (typeof isRestrictedUrl === 'function' && isRestrictedUrl(tab.url)) {
      throw new Error('Cannot capture a screenshot of this page (internal or restricted page).');
    }

    // 3. Sensitive domain check (Edge case 2.3.7)
    if (isSensitiveDomain(tab.url)) {
      throw new Error('Sahayak does not capture screenshots of sensitive pages.');
    }

    // 4. Capture visible area
    const targetWindowId = windowId || tab.windowId || null;
    const captureOptions = {
      format: options.format === 'jpeg' ? 'jpeg' : 'png',
      quality: options.quality || 90
    };

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(targetWindowId, captureOptions);
      if (!dataUrl) {
        throw new Error('Failed to capture tab. Empty image returned.');
      }
      return dataUrl;
    } catch (err) {
      console.warn('[TabCapture] Capture error:', err.message);
      if (err.message && err.message.includes('Cannot capture')) {
        throw new Error('Cannot capture a screenshot of this page.');
      }
      throw new Error(`Screenshot capture failed: ${err.message}`);
    }
  }

  // Export
  globalThis.TabCapture = {
    captureTab,
    isSensitiveDomain
  };
})();

