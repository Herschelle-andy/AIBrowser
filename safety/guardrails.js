/**
 * Sahayak — Deterministic Safety Guardrails Pipeline (Slice 4.3)
 *
 * Enforces hardcoded security rules before any action reaches the approval UI:
 * 1. Domain Check: Blocks all banking, payment, UPI, crypto, government ID sites.
 * 2. Field Check: Blocks password, OTP, CVV, PIN, SSN, card, or Aadhaar fields.
 * 3. Consequential Check: Flags submit, pay, purchase, delete, or transfer actions.
 *
 * Architecture references: §12 (Safety Rails Engine), Edge cases 4.3.1 - 4.3.10
 */

(function () {
  'use strict';

  /**
   * Helper to resolve Blocklists module.
   */
  function getBlocklists() {
    if (typeof SahayakBlocklists !== 'undefined') return SahayakBlocklists;
    if (typeof globalThis !== 'undefined' && globalThis.SahayakBlocklists) return globalThis.SahayakBlocklists;
    if (typeof require === 'function') {
      try { return require('./blocklists.js'); } catch (e) {}
    }
    return null;
  }

  /**
   * Helper to resolve Consequential module.
   */
  function getConsequential() {
    if (typeof SahayakConsequential !== 'undefined') return SahayakConsequential;
    if (typeof globalThis !== 'undefined' && globalThis.SahayakConsequential) return globalThis.SahayakConsequential;
    if (typeof require === 'function') {
      try { return require('./consequential.js'); } catch (e) {}
    }
    return null;
  }

  /**
   * Evaluates a proposed browser action against all safety guardrails.
   *
   * @param {Object} action - Proposed BrowserAction from LLM
   * @param {string} url - Active page URL
   * @param {Object} [actionMap] - PageActionMap containing scanned page elements
   * @returns {{
   *   allowed: boolean,
   *   reason?: string,
   *   blockType?: 'DOMAIN_BLOCKED' | 'FIELD_BLOCKED' | 'UNSUPPORTED_ACTION',
   *   isConsequential: boolean,
   *   consequentialReason?: string
   * }}
   */
  function checkSafety(action, url, actionMap = {}) {
    const blocklists = getBlocklists();
    const consequential = getConsequential();

    // ── Pipeline Step 1: Domain Check (§12.3) ─────────────────────────
    if (blocklists && typeof blocklists.isDomainBlocked === 'function') {
      if (blocklists.isDomainBlocked(url)) {
        return {
          allowed: false,
          blockType: 'DOMAIN_BLOCKED',
          reason: '🛑 Blocked: Sahayak cannot act on banking, payment, government ID, or sensitive financial pages.',
          isConsequential: false
        };
      }
    }

    if (!action || typeof action !== 'object') {
      return {
        allowed: false,
        blockType: 'UNSUPPORTED_ACTION',
        reason: '🛑 Blocked: Invalid action format.',
        isConsequential: false
      };
    }

    // Done action is always allowed to finish the task
    if (action.action === 'done') {
      return {
        allowed: true,
        isConsequential: false
      };
    }

    // Resolve target element if specified
    let targetEl = null;
    if (action.targetElementId && actionMap && Array.isArray(actionMap.elements)) {
      targetEl = actionMap.elements.find(el => el.id === action.targetElementId) || null;
    }

    // ── Pipeline Step 2: Field & Credential Check (§12.4) ─────────────
    if (targetEl) {
      // Type action into a blocked field
      if (action.action === 'type' || targetEl.tag === 'INPUT' || targetEl.type === 'password') {
        const isBlocked = blocklists && typeof blocklists.isFieldBlocked === 'function'
          ? blocklists.isFieldBlocked(targetEl)
          : (targetEl.type === 'password' || /password|otp|cvv|pin/i.test(targetEl.name || ''));

        if (isBlocked) {
          return {
            allowed: false,
            blockType: 'FIELD_BLOCKED',
            reason: '🛑 Blocked: Cannot type into password, PIN, OTP, CVV, or sensitive personal data fields.',
            isConsequential: false
          };
        }
      }
    }

    // ── Pipeline Step 3: Consequential Action Detection (§12.5) ───────
    let isActionConsequential = Boolean(action.isConsequential);
    let consequentialReason = undefined;

    if (consequential && typeof consequential.checkConsequential === 'function') {
      const res = consequential.checkConsequential(targetEl, action);
      if (res.isConsequential) {
        isActionConsequential = true;
        consequentialReason = res.reason;
      }
    } else if (blocklists && typeof blocklists.isConsequential === 'function') {
      if (blocklists.isConsequential(targetEl, action)) {
        isActionConsequential = true;
        consequentialReason = 'Detected consequential keyword in target or reasoning.';
      }
    }

    return {
      allowed: true,
      isConsequential: isActionConsequential,
      consequentialReason
    };
  }

  const Guardrails = {
    checkSafety
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Guardrails;
  }
  globalThis.SahayakGuardrails = Guardrails;
})();

