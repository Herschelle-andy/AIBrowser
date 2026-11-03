/**
 * Sahayak — Content Script Entry Point
 *
 * Runs in the context of web pages.
 * Listens for requests from the background service worker
 * and coordinates reading and extraction.
 */

(function () {
  'use strict';

  // Guard against multiple injections
  if (window.__SAHAYAK_CONTENT_SCRIPT_INITIALIZED__) {
    return;
  }
  window.__SAHAYAK_CONTENT_SCRIPT_INITIALIZED__ = true;

  console.log('[Sahayak] Content script loaded on:', window.location.href);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'PING': {
        sendResponse({
          success: true,
          alive: true,
          hasScanner: Boolean(globalThis.SahayakScanner),
          hasOverlay: Boolean(globalThis.SahayakOverlay),
          hasExecutor: Boolean(globalThis.SahayakExecutor),
          url: window.location.href,
          title: document.title
        });
        break;
      }

      case 'SCAN_ELEMENTS': {
        const scanner = globalThis.SahayakScanner || (typeof SahayakScanner !== 'undefined' ? SahayakScanner : null);
        if (!scanner) {
          sendResponse({
            success: false,
            code: 'SCANNER_MISSING',
            error: 'Scanner module is not initialized on this page.'
          });
          return true;
        }

        try {
          const actionMap = scanner.scan();
          sendResponse({
            success: true,
            data: actionMap
          });
        } catch (err) {
          console.error('[Sahayak] Element scan error:', err);
          sendResponse({
            success: false,
            code: 'SCAN_FAILED',
            error: err.message || 'Failed to scan elements.'
          });
        }
        return true;
      }

      case 'SHOW_BADGES': {
        const overlay = globalThis.SahayakOverlay || (typeof SahayakOverlay !== 'undefined' ? SahayakOverlay : null);
        if (!overlay) {
          sendResponse({
            success: false,
            code: 'OVERLAY_MISSING',
            error: 'Overlay module is not initialized on this page.'
          });
          return true;
        }

        try {
          const elements = message.payload?.elements || message.elements;
          const result = overlay.showBadges(elements);
          sendResponse(result);
        } catch (err) {
          console.error('[Sahayak] Show badges error:', err);
          sendResponse({
            success: false,
            code: 'SHOW_BADGES_FAILED',
            error: err.message || 'Failed to display badges.'
          });
        }
        return true;
      }

      case 'CLEAR_BADGES': {
        const overlay = globalThis.SahayakOverlay || (typeof SahayakOverlay !== 'undefined' ? SahayakOverlay : null);
        if (!overlay) {
          sendResponse({
            success: false,
            code: 'OVERLAY_MISSING',
            error: 'Overlay module is not initialized on this page.'
          });
          return true;
        }

        try {
          const result = overlay.clearBadges();
          sendResponse(result);
        } catch (err) {
          console.error('[Sahayak] Clear badges error:', err);
          sendResponse({
            success: false,
            code: 'CLEAR_BADGES_FAILED',
            error: err.message || 'Failed to clear badges.'
          });
        }
        return true;
      }

      case 'HIGHLIGHT_ELEMENT': {
        const overlay = globalThis.SahayakOverlay || (typeof SahayakOverlay !== 'undefined' ? SahayakOverlay : null);
        if (!overlay) {
          sendResponse({
            success: false,
            code: 'OVERLAY_MISSING',
            error: 'Overlay module is not initialized on this page.'
          });
          return true;
        }

        try {
          const elementId = message.payload?.elementId !== undefined
            ? message.payload.elementId
            : message.elementId;
          const result = overlay.highlightElement(elementId);
          sendResponse(result);
        } catch (err) {
          console.error('[Sahayak] Highlight element error:', err);
          sendResponse({
            success: false,
            code: 'HIGHLIGHT_FAILED',
            error: err.message || 'Failed to highlight element.'
          });
        }
        return true;
      }

      case 'EXECUTE_ACTION': {
        const executor = globalThis.SahayakExecutor || (typeof SahayakExecutor !== 'undefined' ? SahayakExecutor : null);
        if (!executor) {
          sendResponse({
            success: false,
            code: 'EXECUTOR_MISSING',
            error: 'Executor module is not initialized on this page.'
          });
          return true;
        }

        try {
          const action = message.payload?.action || message.action;
          const result = executor.execute(action);
          sendResponse({
            success: true,
            data: result
          });
        } catch (err) {
          console.error('[Sahayak] Action execution error:', err);
          sendResponse({
            success: false,
            code: 'EXECUTION_FAILED',
            error: err.message || 'Failed to execute action.'
          });
        }
        return true;
      }

      case 'EXTRACT_ARTICLE': {
        // Edge case 1.3.1: If page is still loading, wait up to 500ms
        if (document.readyState === 'loading') {
          setTimeout(() => {
            try {
              const result = SahayakReader.extractArticle();
              sendResponse(result);
            } catch (err) {
              sendResponse({ success: false, error: err.message, code: 'EXTRACTION_CRASH' });
            }
          }, 500);
          return true; // async sendResponse
        }

        try {
          const result = SahayakReader.extractArticle();
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: err.message, code: 'EXTRACTION_CRASH' });
        }
        return true;
      }

      case 'GET_YOUTUBE_CAPTIONS': {
        const yt = globalThis.SahayakYouTube || (typeof SahayakYouTube !== 'undefined' ? SahayakYouTube : null);
        if (!yt) {
          sendResponse({
            success: false,
            code: 'YOUTUBE_MODULE_MISSING',
            error: 'YouTube module is not initialized on this page.'
          });
          return true;
        }

        (async () => {
          try {
            const result = await yt.extractCaptions();
            sendResponse(result);
          } catch (err) {
            console.error('[Sahayak] Caption extraction error:', err);
            sendResponse({
              success: false,
              code: 'EXTRACTION_ERROR',
              error: err.message || 'Failed to extract captions from video.'
            });
          }
        })();
        return true; // async sendResponse
      }

      case 'SEEK_VIDEO': {
        const yt = globalThis.SahayakYouTube || (typeof SahayakYouTube !== 'undefined' ? SahayakYouTube : null);
        if (!yt) {
          sendResponse({
            success: false,
            code: 'YOUTUBE_MODULE_MISSING',
            error: 'YouTube module is not loaded.'
          });
          return true;
        }

        const seconds = message.payload?.seconds !== undefined ? message.payload.seconds : message.seconds;
        const result = yt.seekTo(seconds);
        sendResponse(result);
        return true;
      }

      default:
        // Do not handle unknown messages here — allow other handlers or ignore
        break;
    }
  });
})();

