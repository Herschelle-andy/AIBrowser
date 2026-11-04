/**
 * Sahayak — Safety Rails Blocklists & Patterns (Slice 4.3)
 *
 * Deterministic blocklists for high-risk domains, sensitive credential fields,
 * and consequential browser actions.
 * Supports built-in patterns and user-configured custom blocked domains with
 * robust URL and domain normalization.
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
    /cvc/i,
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
   * Normalizes any raw domain entry (e.g. "https://en.wikipedia.org/wiki/...",
   * "*.wikipedia.org", "www.example.com", "wikipedia.org/") into a clean hostname.
   *
   * @param {string} raw
   * @returns {string}
   */
  function normalizeDomain(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let s = raw.trim().toLowerCase();
    // Strip scheme if present
    s = s.replace(/^[a-zA-Z]+:\/\//, '');
    // Strip path, query, hash
    s = s.split('/')[0].split('?')[0].split('#')[0];
    // Strip leading wildcard *. or .
    s = s.replace(/^\*\.?/, '').replace(/^\.+/, '');
    // Strip leading www.
    s = s.replace(/^www\./, '');
    // Strip port
    s = s.split(':')[0];
    return s.trim();
  }

  /**
   * User-defined custom blocked domains.
   */
  let _customDomains = [];

  function getCustomDomains() {
    return [..._customDomains];
  }

  function setCustomDomains(domains) {
    if (Array.isArray(domains)) {
      _customDomains = domains
        .map(normalizeDomain)
        .filter(d => d.length > 0);
    } else if (typeof domains === 'string') {
      _customDomains = domains
        .split(/[\n,]+/)
        .map(normalizeDomain)
        .filter(d => d.length > 0);
    } else {
      _customDomains = [];
    }
    // Deduplicate
    _customDomains = Array.from(new Set(_customDomains));
  }

  async function loadCustomDomains() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get('sahayak_blocked_domains');
        if (stored && stored.sahayak_blocked_domains) {
          setCustomDomains(stored.sahayak_blocked_domains);
        }
      }
    } catch (e) {
      console.warn('[SahayakBlocklists] Could not load custom domains:', e);
    }
    return getCustomDomains();
  }

  async function saveCustomDomains(domains) {
    setCustomDomains(domains);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ sahayak_blocked_domains: _customDomains });
      }
    } catch (e) {
      console.warn('[SahayakBlocklists] Could not save custom domains:', e);
    }
    return getCustomDomains();
  }

  // Auto-init custom domains if chrome.storage is present
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    loadCustomDomains();
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.sahayak_blocked_domains) {
          setCustomDomains(changes.sahayak_blocked_domains.newValue || []);
        }
      });
    }
  }

  /**
   * Checks whether a URL is on the blocked domain list (built-in patterns or custom user domains).
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

    // 1. Check built-in patterns
    if (BLOCKED_DOMAIN_PATTERNS.some(pattern => pattern.test(targetHostname))) {
      return true;
    }

    // 2. Check custom user-configured domains
    if (_customDomains && _customDomains.length > 0) {
      const isCustomMatched = _customDomains.some(entry => {
        const clean = normalizeDomain(entry);
        if (!clean) return false;
        return (
          targetHostname === clean ||
          targetHostname.endsWith('.' + clean) ||
          ('www.' + targetHostname) === clean ||
          clean.endsWith('.' + targetHostname)
        );
      });
      if (isCustomMatched) return true;
    }

    return false;
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
    normalizeDomain,
    getCustomDomains,
    setCustomDomains,
    loadCustomDomains,
    saveCustomDomains,
    isDomainBlocked,
    isFieldBlocked,
    isConsequential
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Blocklists;
  }
  globalThis.SahayakBlocklists = Blocklists;
})();
