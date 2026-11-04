/**
 * Sahayak — Safety Rails Blocklists & Patterns (Slice 4.3)
 *
 * Deterministic blocklists for high-risk domains, sensitive credential fields,
 * and consequential browser actions.
 *
 * Architecture references: §12 (Safety Rails Engine), Edge cases 4.3.1 - 4.3.10
 */

(function () {
  'use strict';

  /**
   * Blocked Domain Patterns (§12.3)
   * High-risk categories: Banking, UPI / Payments, Crypto exchanges, Government ID, Email.
   */
  const BLOCKED_DOMAIN_PATTERNS = Object.freeze([
    // Banking (Indian & Global)
    /\b(netbanking|ibanking|onlinesbi|hdfcbank|icicibank|axisbank|kotak|pnbindia|bankofbaroda|canarabank|unionbankofindia)\b/i,
    /\b(chase|wellsfargo|bankofamerica|citibank|capitalone|barclays|hsbc)\b/i,
    /\bbank\b.*\.(com|co\.in|in|org|net)\b/i,

    // Payments & UPI
    /\b(razorpay|paytm|phonepe|gpay|stripe|paypal|payu|cashfree|instamojo|billdesk|ccavenue)\b/i,
    /\b(upi|bhim)\b/i,

    // Crypto Exchanges
    /\b(binance|coinbase|wazirx|coindcx|kucoin|kraken|bybit|bitfinex)\b/i,
    /\bgemini\.com\b/i,

    // Government Identity & Tax Services
    /\b(digilocker|uidai|incometax|aadhaar|passport|nsdl|utiitsl|epfindia|ceir|parivahan)\b.*\.(gov|nic)\b/i,

    // Email client interfaces (Agent should not act autonomously on personal mail)
    /\bmail\.(google|yahoo)\b/i,
    /\b(outlook\.live|mail\.live)\b/i
  ]);

  /**
   * Blocked Input Patterns (§12.4)
   * Prevents typing into credentials, cards, OTPs, identity numbers, and PINs.
   */
  const BLOCKED_INPUT_PATTERNS = Object.freeze([
    /password/i,
    /passwd/i,
    /passcode/i,
    /\botp\b/i,
    /one.?time.?pass/i,
    /verification.?code/i,
    /\bcvv\b/i,
    /\bcvc\b/i,
    /security.?code/i,
    /card.?number/i,
    /card.?num/i,
    /credit.?card/i,
    /debit.?card/i,
    /pan.?number/i,
    /expir/i,
    /\bexp.?date\b/i,
    /\bssn\b/i,
    /social.?security/i,
    /aadhaar/i,
    /aadhar/i,
    /\bpin\b/i,
    /\bupi.?pin\b/i,
    /\bmpin\b/i,
    /\batm.?pin\b/i
  ]);

  /**
   * Consequential Action Keywords (§12.5)
   * High-impact operations requiring explicit double-confirmation.
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
   * Checks whether a URL is on the blocked domain list.
   * Edge case 4.3.1: Extracts and tests against the hostname only, avoiding
   * false positives when keywords appear in URL paths (e.g. example.com/articles/how-banks-work).
   * Edge case 4.3.2: Local IP addresses are not blocked by default.
   *
   * @param {string} url
   * @returns {boolean}
   */
  function isDomainBlocked(url) {
    if (!url || typeof url !== 'string') return false;

    let targetHostname = '';
    try {
      const parsed = new URL(url);
      targetHostname = parsed.hostname.toLowerCase();
    } catch (e) {
      // Fallback: strip scheme and extract first domain segment
      const clean = url.replace(/^[a-zA-Z]+:\/\//, '').split('/')[0];
      targetHostname = clean.toLowerCase();
    }

    if (!targetHostname) return false;

    // Edge case 4.3.2: Allow IPv4 local addresses by default
    if (/^(127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|localhost)/.test(targetHostname)) {
      return false;
    }

    return BLOCKED_DOMAIN_PATTERNS.some(pattern => pattern.test(targetHostname));
  }

  /**
   * Checks whether an interactive DOM element represents a sensitive credential or identity field.
   * Edge case 4.3.4 & 4.3.7: Checks type, standard and non-standard autocomplete attributes,
   * element name, placeholder, role, and label text.
   *
   * @param {Object} element - ActionableElement
   * @returns {boolean}
   */
  function isFieldBlocked(element) {
    if (!element || typeof element !== 'object') return false;

    // Direct password input check
    if (element.type === 'password') return true;

    // Autocomplete attribute check (Edge case 4.3.7)
    const autocomplete = (element.autocomplete || '').toLowerCase();
    if (/(current|new)-password|cc-|otp|one-time-code|security-code/.test(autocomplete)) {
      return true;
    }

    const rawHaystack = [
      element.name,
      element.placeholder,
      element.text,
      element.role,
      element.id,
      autocomplete
    ].filter(Boolean).join(' ');

    // Normalize underscores and hyphens into spaces so \b matches user_otp, pin_code, etc.
    const normalized = rawHaystack.replace(/[_-]+/g, ' ');

    return BLOCKED_INPUT_PATTERNS.some(pattern => pattern.test(normalized));
  }

  /**
   * Checks whether an action on an element is consequential.
   *
   * @param {Object} [element]
   * @param {Object} [action]
   * @returns {boolean}
   */
  function isConsequential(element, action) {
    if (action && action.isConsequential === true) return true;
    if (!element && !action) return false;

    const haystack = [
      element?.text,
      element?.name,
      element?.value,
      element?.placeholder,
      action?.reasoning
    ].filter(Boolean).join(' ');

    return CONSEQUENTIAL_KEYWORDS.some(pattern => pattern.test(haystack));
  }

  const Blocklists = {
    BLOCKED_DOMAIN_PATTERNS,
    BLOCKED_INPUT_PATTERNS,
    CONSEQUENTIAL_KEYWORDS,
    isDomainBlocked,
    isFieldBlocked,
    isConsequential
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Blocklists;
  }
  globalThis.SahayakBlocklists = Blocklists;
})();

