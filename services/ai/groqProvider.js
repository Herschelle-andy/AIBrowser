/**
 * Sahayak — Groq Provider Service (Slice 2.4)
 *
 * Implements Groq API client (OpenAI-compatible) for ultra-fast free fallback.
 * Uses llama-3.1-8b-instant by default.
 */

(function () {
  'use strict';

  const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
  const DEFAULT_MODEL = 'llama-3.1-8b-instant';
  const REQUEST_TIMEOUT_MS = 25000;

  /**
   * Send chat completion request to Groq API.
   *
   * @param {string} apiKey - Groq API key (starts with gsk_)
   * @param {string} [model='llama-3.1-8b-instant']
   * @param {string} prompt - User prompt
   * @param {Object} [options]
   * @param {string} [options.systemPrompt]
   * @param {number} [options.temperature=0.3]
   * @param {number} [options.maxOutputTokens=2048]
   * @param {boolean} [options.jsonMode=false]
   * @returns {Promise<{text: string, model: string}>}
   */
  async function callGroq(apiKey, model, prompt, options = {}) {
    if (!apiKey || !apiKey.trim()) {
      throw new GeminiProvider.AIProviderError(
        'No Groq API key configured. Please add your Groq key in Settings.',
        'NO_KEY',
        null,
        false
      );
    }

    const {
      systemPrompt = null,
      temperature = 0.3,
      maxOutputTokens = 2048,
      jsonMode = false,
      timeoutMs = REQUEST_TIMEOUT_MS,
    } = options;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const cleanModel = model || DEFAULT_MODEL;

    const payload = {
      model: cleanModel,
      messages,
      temperature,
      max_tokens: maxOutputTokens,
    };

    if (jsonMode || options.responseFormat === 'json_object') {
      payload.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new GeminiProvider.AIProviderError(
          'Groq request timed out. Please try again.',
          'TIMEOUT',
          null,
          true
        );
      }
      if (err instanceof TypeError) {
        throw new GeminiProvider.AIProviderError(
          'Network request failed. Check your internet connection.',
          'NETWORK_ERROR',
          null,
          true
        );
      }
      throw new GeminiProvider.AIProviderError(
        `Groq fetch error: ${err.message}`,
        'UNKNOWN',
        null,
        false
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      await handleGroqHttpError(response);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new GeminiProvider.AIProviderError(
        'Received unreadable JSON from Groq.',
        'PARSE_ERROR',
        response.status,
        true
      );
    }

    const text = data.choices?.[0]?.message?.content || '';
    return {
      text,
      model: cleanModel,
    };
  }

  /**
   * Stream response from Groq via Server-Sent Events (SSE).
   *
   * @param {string} apiKey
   * @param {string} model
   * @param {string} prompt
   * @param {Object} [options]
   * @param {function(string): void} [onChunk]
   * @returns {Promise<{text: string, model: string}>}
   */
  async function streamGroq(apiKey, model, prompt, options = {}, onChunk = null) {
    if (!apiKey || !apiKey.trim()) {
      throw new GeminiProvider.AIProviderError(
        'No Groq API key configured. Please add your Groq key in Settings.',
        'NO_KEY',
        null,
        false
      );
    }

    const {
      systemPrompt = null,
      temperature = 0.3,
      maxOutputTokens = 2048,
      signal = null,
    } = options;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const cleanModel = model || DEFAULT_MODEL;

    const payload = {
      model: cleanModel,
      messages,
      temperature,
      max_tokens: maxOutputTokens,
      stream: true,
    };

    let response;
    try {
      response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new GeminiProvider.AIProviderError('Groq stream aborted.', 'ABORTED', null, true);
      }
      throw new GeminiProvider.AIProviderError(`Groq stream fetch error: ${err.message}`, 'NETWORK_ERROR', null, true);
    }

    if (!response.ok) {
      await handleGroqHttpError(response);
    }

    if (!response.body) {
      throw new GeminiProvider.AIProviderError('No readable stream from Groq.', 'STREAM_ERROR', response.status, false);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              if (onChunk) onChunk(delta);
            }
          } catch (e) {
            // Buffer boundary
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      text: fullText,
      model: cleanModel,
    };
  }

  /**
   * Map Groq HTTP error statuses.
   */
  async function handleGroqHttpError(response) {
    let errorBody = '';
    let retryAfterSeconds = null;

    // Check Retry-After header (Edge case 2.4.3)
    const retryAfterHeader = response.headers.get('Retry-After');
    if (retryAfterHeader) {
      const parsedSec = parseInt(retryAfterHeader, 10);
      if (Number.isFinite(parsedSec) && parsedSec > 0) {
        retryAfterSeconds = parsedSec;
      }
    }

    try {
      const data = await response.json();
      errorBody = data.error?.message || JSON.stringify(data);
    } catch {
      errorBody = await response.text().catch(() => '');
    }

    switch (response.status) {
      case 401:
        throw new GeminiProvider.AIProviderError(
          'Invalid Groq API key. Please check your Groq key in Settings.',
          'INVALID_KEY',
          401,
          false
        );

      case 429: {
        const err = new GeminiProvider.AIProviderError(
          'Groq rate limit exceeded.',
          'RATE_LIMIT',
          429,
          true
        );
        if (retryAfterSeconds) err.retryAfterSeconds = retryAfterSeconds;
        throw err;
      }

      default:
        throw new GeminiProvider.AIProviderError(
          `Groq API error (${response.status}): ${errorBody}`,
          'GROQ_ERROR',
          response.status,
          response.status >= 500
        );
    }
  }

  // Export
  globalThis.GroqProvider = {
    callGroq,
    streamGroq,
    DEFAULT_MODEL,
  };
})();

