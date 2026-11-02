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
          url: window.location.href,
          title: document.title
        });
        break;
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

