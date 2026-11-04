/**
 * Sahayak — Consequential Action Detection (Slice 4.3)
 *
 * Dedicated analyzer for consequential actions: submit, pay, purchase,
 * delete, transfer, checkout, and external state changes.
 *
 * Architecture references: §12.5, Edge cases 4.3.5, 4.3.6, 4.3.9
 */

(function () {
  'use strict';

  /**
   * Consequential Action Keywords (§12.5)
   */
  const CONSEQUENTIAL_KEYWORDS = Object.freeze([
    /\bsubmit\b/i,
    /\bpay\b/i,
    /\bpurchase\b/i,
    /\bbuy\b/i,
    /\bplace.?order\b/i,
    /\bconfirm.?order\b/i,
    /\bdelete\b/i,
    /\bremove\b/i,
    /\bsend\b/i,
    /\btransfer\b/i,
    /\bcheckout\b/i,
    /\bproceed\b/i,
    /\bbook.?now\b/i,
    /\bconfirm.?booking\b/i
  ]);

  /**
   * Detailed check for consequential actions.
   *
   * @param {Object} [element] - Target actionable DOM element
   * @param {Object} [action] - Proposed BrowserAction from LLM
   * @returns {{ isConsequential: boolean, reason?: string, matchedKeyword?: string }}
   */
  function checkConsequential(element, action) {
    if (action && action.isConsequential === true) {
      return {
        isConsequential: true,
        reason: 'Flagged as consequential by autonomous planning model.'
      };
    }

    const textSources = [
      element?.text,
      element?.name,
      element?.value,
      element?.placeholder,
      element?.role,
      action?.reasoning
    ].filter(Boolean);

    const haystack = textSources.join(' ');

    for (const pattern of CONSEQUENTIAL_KEYWORDS) {
      const match = haystack.match(pattern);
      if (match) {
        return {
          isConsequential: true,
          matchedKeyword: match[0],
          reason: `Detected consequential operation keyword: "${match[0]}"`
        };
      }
    }

    return {
      isConsequential: false
    };
  }

  /**
   * Boolean check for consequential actions.
   *
   * @param {Object} [element]
   * @param {Object} [action]
   * @returns {boolean}
   */
  function isConsequential(element, action) {
    return checkConsequential(element, action).isConsequential;
  }

  const Consequential = {
    CONSEQUENTIAL_KEYWORDS,
    checkConsequential,
    isConsequential
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Consequential;
  }
  globalThis.SahayakConsequential = Consequential;
})();

