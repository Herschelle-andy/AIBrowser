/**
 * Sahayak — Retry & Fallback Service (Slice 2.4)
 *
 * Implements resilient free-tier API calling:
 *  - Exponential backoff with random jitter on HTTP 429 / RESOURCE_EXHAUSTED
 *  - Reads Retry-After header if provided by API (Edge case 2.4.3)
 *  - Automatic switch to Groq fallback provider after primary retries are exhausted
 *  - Non-retryable errors (invalid key, bad request, safety) fail fast immediately
 *  - Clear user-facing guidance when both or either provider is exhausted (Edge cases 2.4.1 & 2.4.2)
 */

(function () {
  'use strict';

  /**
   * Promise-based sleep helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  /**
   * Determine whether an error represents a retryable rate limit or quota condition.
   * @param {Error|Object} err
   * @returns {boolean}
   */
  function isRateLimitOrQuotaError(err) {
    if (!err) return false;

    // HTTP 429
    if (err.status === 429) return true;

    // Explicit error codes
    const code = (err.code || '').toUpperCase();
    if (
      code === 'RATE_LIMIT' ||
      code === 'RESOURCE_EXHAUSTED' ||
      code === 'VISION_QUOTA_EXHAUSTED' ||
      code === 'QUOTA_EXHAUSTED'
    ) {
      return true;
    }

    // Message inspection
    const msg = (err.message || '').toLowerCase();
    if (
      msg.includes('resource_exhausted') ||
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('too many requests')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Determine whether an error is eligible for fallback to secondary provider (Groq)
   * or retry (rate limits, server 5xx outages, timeouts, and network drops).
   * @param {Error|Object} err
   * @returns {boolean}
   */
  function isRetryableOrFallbackEligible(err) {
    if (!err) return false;

    if (isRateLimitOrQuotaError(err)) return true;

    const status = err.status;
    if (status === 500 || status === 502 || status === 503 || status === 504 || status === 404) {
      return true;
    }

    const code = (err.code || '').toUpperCase();
    if (
      code === 'SERVER_ERROR' ||
      code === 'TIMEOUT' ||
      code === 'NETWORK_ERROR' ||
      code === 'MODEL_NOT_FOUND' ||
      code === 'EMPTY_RESPONSE'
    ) {
      return true;
    }

    const msg = (err.message || '').toLowerCase();
    if (
      msg.includes('temporarily unavailable') ||
      msg.includes('took too long') ||
      msg.includes('timed out') ||
      msg.includes('timeout') ||
      msg.includes('service unavailable')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Execute primary function with exponential backoff retries and fallback execution.
   *
   * @template T
   * @param {() => Promise<T>} primaryFn - Primary provider call (e.g. Gemini)
   * @param {(() => Promise<T>)|null} fallbackFn - Fallback provider call (e.g. Groq)
   * @param {Object} [options]
   * @param {number} [options.maxRetries=2] - Maximum retry attempts before fallback
   * @param {string} [options.task='text'] - Task category ('text' | 'vision' | 'reasoning')
   * @param {boolean} [options.hasGroqKey=false] - Whether user has a Groq key configured
   * @param {function(number, number, Error): void} [options.onRetry] - Progress callback
   * @returns {Promise<T>}
   */
  async function callWithFallback(primaryFn, fallbackFn, options = {}) {
    const {
      maxRetries = 2,
      task = 'text',
      hasGroqKey = false,
      onRetry = null,
    } = options;

    let lastError = null;

    // 1. Primary retry loop
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await primaryFn();
      } catch (err) {
        lastError = err;

        // Non-retryable client error (invalid API key, safety block, 400 bad request) -> throw immediately
        if (!isRetryableOrFallbackEligible(err)) {
          throw err;
        }

        // If rate limited and retries remain, back off with jitter
        if (attempt < maxRetries && isRateLimitOrQuotaError(err)) {
          // Check for Retry-After header / property (Edge case 2.4.3)
          const retryAfterSeconds = Number(err.retryAfterSeconds || 0);
          const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 0;

          // Exponential backoff with jitter: 1s, 2s, 4s + random 0–500ms
          const exponentialMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          const delay = Math.max(retryAfterMs, exponentialMs);

          console.warn(`[RetryWithFallback] Attempt ${attempt + 1} rate limited. Retrying in ${Math.round(delay)}ms...`);

          if (typeof onRetry === 'function') {
            try {
              onRetry(attempt + 1, delay, err);
            } catch (cbErr) {
              // Ignore callback exceptions
            }
          }

          await sleep(delay);
          continue;
        }

        // For transient 500/503 server error, allow 1 quick retry if attempts remain
        if (attempt === 0 && (err.code === 'SERVER_ERROR' || err.status === 500 || err.status === 503)) {
          console.warn('[RetryWithFallback] Server error on primary attempt. Quick retry in 1.2s...');
          await sleep(1200);
          continue;
        }

        // Break to fallback for timeouts or exhausted primary
        console.warn(`[RetryWithFallback] Primary attempt failed with ${err.code || err.message}. Moving to fallback...`);
        break;
      }
    }

    // 2. Fallback provider execution
    if (typeof fallbackFn === 'function') {
      try {
        console.warn('[RetryWithFallback] Switching to backup provider (Groq)...');
        return await fallbackFn();
      } catch (fallbackErr) {
        console.error('[RetryWithFallback] Fallback provider also failed:', fallbackErr);

        // Edge case 2.4.2: Both Gemini and Groq failed / rate-limited
        if (isRateLimitOrQuotaError(fallbackErr) || isRateLimitOrQuotaError(lastError)) {
          const doubleFailure = new Error('All AI providers are temporarily unavailable. Please wait a few minutes and try again.');
          doubleFailure.code = 'ALL_PROVIDERS_UNAVAILABLE';
          doubleFailure.status = 429;
          throw doubleFailure;
        }

        throw fallbackErr;
      }
    }

    // 3. No fallback available — build user-friendly error guidance
    if (task === 'vision') {
      const visionError = new Error('Screenshot questions require Gemini Flash, which has reached its limit. Please try again later.');
      visionError.code = 'VISION_QUOTA_EXHAUSTED';
      visionError.status = 429;
      throw visionError;
    }

    if (!isRateLimitOrQuotaError(lastError)) {
      // Re-throw specific server/timeout/network error with guidance
      throw lastError;
    }

    // Edge case 2.4.1: Groq API key is not set
    if (!hasGroqKey) {
      const missingGroq = new Error('Rate limit reached. Add a free Groq API key in Settings for automatic backup, or try again in a few minutes.');
      missingGroq.code = 'RATE_LIMIT_NO_GROQ_KEY';
      missingGroq.status = 429;
      throw missingGroq;
    }

    const exhaustedError = new Error('Rate limit reached and no fallback available. Please try again in a few minutes.');
    exhaustedError.code = 'RATE_LIMIT_EXHAUSTED';
    exhaustedError.status = 429;
    throw exhaustedError;
  }

  // Export
  globalThis.RetryWithFallback = {
    callWithFallback,
    isRateLimitOrQuotaError,
    isRetryableOrFallbackEligible,
    sleep,
  };
})();

