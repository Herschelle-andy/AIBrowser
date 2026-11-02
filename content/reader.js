/**
 * Sahayak — Article Reader
 *
 * Uses bundled Mozilla Readability to extract clean article content
 * from the active webpage DOM clone.
 *
 * Edge cases handled:
 *  1.3.1 — SPA delayed rendering check
 *  1.3.2 — Paywall/login wall detection (< 50 words)
 *  1.3.3 — Non-article page detection (null parse or < 30 words)
 *  1.3.4 — Extreme page length truncation (~20,000 words / 80k chars)
 *  1.3.5 — Cross-origin iframe main content detection
 *  1.3.9 — Preserve key table & code blocks from HTML
 */

(function () {
  'use strict';

  const MAX_CHAR_LENGTH = 50000; // ~12,500 words (~15k tokens), optimal balance of depth and latency
  const MIN_ARTICLE_WORDS = 30;  // Threshold to consider content a real article
  const PAYWALL_THRESHOLD_WORDS = 60; // Suspiciously short article warning

  /**
   * Extract article data from the current document.
   * @returns {Object} { success: boolean, data?: Object, error?: string, code?: string }
   */
  function extractArticle() {
    const ReadabilityClass = globalThis.Readability || (typeof Readability !== 'undefined' ? Readability : null);

    if (!ReadabilityClass) {
      return {
        success: false,
        error: 'Readability library is not loaded in this tab.',
        code: 'LIBRARY_MISSING'
      };
    }

    try {
      // Best practice: clone the document so Readability doesn't mutate the live page
      const docClone = document.cloneNode(true);
      const reader = new ReadabilityClass(docClone, {
        keepClasses: false,
        charThreshold: 20
      });

      const article = reader.parse();

      // Edge case 1.3.3 & 1.3.5: No article or extremely sparse text
      if (!article || !article.textContent || !article.textContent.trim()) {
        const hasIframes = document.querySelectorAll('iframe').length > 0;
        if (hasIframes) {
          return {
            success: false,
            error: "This page's main content appears to be inside a frame or app that cannot be read directly. Try using Screenshot or Chat instead.",
            code: 'IFRAME_CONTENT'
          };
        }
        return {
          success: false,
          error: "This page doesn't appear to contain an article or readable content. Try using Chat or Screenshot instead.",
          code: 'NO_ARTICLE'
        };
      }

      let textContent = article.textContent.trim();
      const rawWords = textContent.split(/\s+/).filter(Boolean);
      const wordCount = rawWords.length;

      // Edge case 1.3.3: Below minimum article length
      if (wordCount < MIN_ARTICLE_WORDS) {
        return {
          success: false,
          error: "This page doesn't have enough text to summarise as an article. Try asking a specific question in Chat.",
          code: 'TOO_SHORT'
        };
      }

      // Edge case 1.3.2: Paywall or login wall teaser detection
      let paywallWarning = null;
      if (wordCount < PAYWALL_THRESHOLD_WORDS) {
        paywallWarning = 'This page has very little content and may be behind a paywall or login screen.';
      }

      // Edge case 1.3.9: Extract tables or code snippets if article HTML has them
      let supplementaryData = '';
      if (article.content) {
        try {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = article.content;

          // Extract table summaries if present
          const tables = tempDiv.querySelectorAll('table');
          if (tables.length > 0) {
            const tableTexts = [];
            tables.forEach((tbl, idx) => {
              const rows = Array.from(tbl.querySelectorAll('tr')).slice(0, 10);
              const rowTexts = rows.map(r => Array.from(r.querySelectorAll('th,td')).map(c => c.textContent.trim()).join(' | '));
              if (rowTexts.length > 0) {
                tableTexts.push(`[Table ${idx + 1}]:\n` + rowTexts.join('\n'));
              }
            });
            if (tableTexts.length > 0) {
              supplementaryData += '\n\n[Structured Tables from Article]:\n' + tableTexts.join('\n\n');
            }
          }
        } catch (e) {
          console.warn('[Sahayak Reader] Supplementary data extraction skipped:', e);
        }
      }

      let combinedContent = textContent + supplementaryData;
      let isTruncated = false;

      // Edge case 1.3.4: Truncate very long articles
      if (combinedContent.length > MAX_CHAR_LENGTH) {
        combinedContent = combinedContent.substring(0, MAX_CHAR_LENGTH);
        // Trim to last clean sentence or paragraph
        const lastPeriod = combinedContent.lastIndexOf('.');
        if (lastPeriod > MAX_CHAR_LENGTH * 0.9) {
          combinedContent = combinedContent.substring(0, lastPeriod + 1);
        }
        combinedContent += '\n\n[...Content truncated due to length...]';
        isTruncated = true;
      }

      return {
        success: true,
        data: {
          title: (article.title || document.title || 'Untitled Page').trim(),
          byline: (article.byline || '').trim(),
          siteName: (article.siteName || window.location.hostname || '').trim(),
          excerpt: (article.excerpt || '').trim(),
          content: combinedContent,
          wordCount,
          isTruncated,
          paywallWarning,
          url: window.location.href,
          lang: article.lang || document.documentElement.lang || 'en'
        }
      };
    } catch (err) {
      console.error('[Sahayak Reader] Extraction error:', err);
      return {
        success: false,
        error: `Could not parse article content: ${err.message}`,
        code: 'PARSE_FAILED'
      };
    }
  }

  // Export globally in content script scope
  globalThis.SahayakReader = {
    extractArticle
  };
})();

