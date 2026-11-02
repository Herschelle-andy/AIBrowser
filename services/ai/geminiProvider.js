/**
 * Gemini API Provider
 *
 * Low-level client for the Google Gemini REST API.
 * Handles request construction, response parsing, and typed error handling.
 *
 * Edge cases covered:
 *  1.2.1 — Empty candidates array
 *  1.2.2 — Safety filter blocks (finishReason === 'SAFETY')
 *  1.2.3 — Model not found (404)
 *  1.2.4 — Network offline (TypeError: Failed to fetch)
 *  1.2.5 — Malformed JSON response
 *  1.2.6 — Request timeout (>25s via AbortController)
 *  1.2.8 — Key disabled (403)
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds — generous for deep page summaries

/**
 * Custom error class for AI provider failures.
 */
class AIProviderError extends Error {
  constructor(message, code, status = null, retryable = false) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;        // e.g. 'RATE_LIMIT', 'INVALID_KEY', 'SAFETY_BLOCK'
    this.status = status;    // HTTP status code
    this.retryable = retryable;
  }
}

/**
 * Call the Gemini generateContent endpoint.
 *
 * @param {string} apiKey    — Gemini API key
 * @param {string} model     — Model name, e.g. 'gemini-3.8-flash'
 * @param {string} prompt    — User prompt text
 * @param {Object} [options] — Optional config
 * @param {string} [options.systemPrompt]    — System instruction
 * @param {number} [options.temperature]     — 0.0 to 2.0 (default 0.4)
 * @param {number} [options.maxOutputTokens] — Max response tokens (default 2048)
 * @returns {Promise<string>} — The model's text response
 * @throws {AIProviderError}
 */
async function callGemini(apiKey, model, prompt, options = {}) {
  const {
    systemPrompt = null,
    temperature = 0.4,
    maxOutputTokens = 2048,
    timeoutMs = REQUEST_TIMEOUT_MS,
    videoUrl = null,
  } = options;

  // Build request parts
  const parts = [{ text: prompt }];
  if (videoUrl) {
    parts.push({
      fileData: {
        fileUri: videoUrl
      }
    });
  }

  // Build request payload
  const payload = {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
    }
  };

  // Add system instruction if provided
  if (systemPrompt) {
    payload.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }

  // Clean model ID (remove models/ prefix if present)
  const cleanModel = model.replace(/^models\//, '');
  const url = `${GEMINI_BASE_URL}/${cleanModel}:generateContent?key=${apiKey}`;

  // AbortController for timeout (edge case 1.2.6)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);

    // Edge case 1.2.6: AbortController timeout
    if (err.name === 'AbortError') {
      throw new AIProviderError(
        'Request timed out. The AI model took too long to respond. Please try again.',
        'TIMEOUT', null, true
      );
    }

    // Edge case 1.2.4: Network offline
    if (err instanceof TypeError) {
      throw new AIProviderError(
        'Network request failed. You appear to be offline or behind a firewall that blocks API access.',
        'NETWORK_ERROR', null, true
      );
    }

    throw new AIProviderError(
      `Unexpected fetch error: ${err.message}`,
      'UNKNOWN', null, false
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP error statuses
  if (!response.ok) {
    // If videoUrl in fileData failed with 400, retry once with video URL in prompt text
    if (response.status === 400 && videoUrl && parts.length > 1) {
      console.warn('[GeminiProvider] fileData videoUri returned 400, retrying with video URL in prompt text...');
      const fallbackOptions = { ...options, videoUrl: null };
      const fallbackPrompt = `Video to analyze: ${videoUrl}\n\n${prompt}`;
      return await callGemini(apiKey, model, fallbackPrompt, fallbackOptions);
    }
    await handleHttpError(response);
  }

  // Parse JSON response (edge case 1.2.5)
  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    throw new AIProviderError(
      'Received an unreadable response from the AI. Please try again.',
      'PARSE_ERROR', response.status, true
    );
  }

  // Extract text from the response
  return extractText(data);
}

/**
 * Map HTTP error responses to typed AIProviderError.
 */
async function handleHttpError(response) {
  let errorBody = '';
  try {
    const data = await response.json();
    errorBody = data.error?.message || JSON.stringify(data);
  } catch {
    errorBody = await response.text().catch(() => '');
  }

  switch (response.status) {
    case 400:
      throw new AIProviderError(
        `Bad request: ${errorBody}`,
        'BAD_REQUEST', 400, false
      );

    case 401:
      throw new AIProviderError(
        'Invalid API key. Please check your Gemini API key in Settings.',
        'INVALID_KEY', 401, false
      );

    // Edge case 1.2.8: Key disabled or billing issue
    case 403:
      throw new AIProviderError(
        'API key may be disabled or lacks permission. Check your Google AI Studio dashboard.',
        'FORBIDDEN', 403, false
      );

    // Edge case: Rate limit
    case 429:
      throw new AIProviderError(
        'Rate limit reached. Please wait a moment and try again.',
        'RATE_LIMIT', 429, true
      );

    // Edge case 1.2.3: Model not found
    case 404:
      throw new AIProviderError(
        `AI model not found (${errorBody || 'HTTP 404'}). Please check model configuration or Google AI Studio status.`,
        'MODEL_NOT_FOUND', 404, false
      );

    case 500:
    case 502:
    case 503:
      throw new AIProviderError(
        'The AI service is temporarily unavailable. Please try again in a moment.',
        'SERVER_ERROR', response.status, true
      );

    default:
      throw new AIProviderError(
        `API error (HTTP ${response.status}): ${errorBody}`,
        'UNKNOWN', response.status, false
      );
  }
}

/**
 * Extract the text content from a Gemini generateContent response.
 * Handles safety blocks and empty responses.
 */
function extractText(data) {
  // Edge case 1.2.1: No candidates
  if (!data.candidates || data.candidates.length === 0) {
    // Check if it was blocked by safety
    if (data.promptFeedback?.blockReason) {
      throw new AIProviderError(
        `The model declined this request due to content policy: ${data.promptFeedback.blockReason}.`,
        'SAFETY_BLOCK', null, false
      );
    }
    throw new AIProviderError(
      'The model returned an empty response. Try rephrasing your question.',
      'EMPTY_RESPONSE', null, true
    );
  }

  const candidate = data.candidates[0];

  // Edge case 1.2.2: finishReason is SAFETY
  if (candidate.finishReason === 'SAFETY') {
    throw new AIProviderError(
      'The model declined to respond to this content due to safety filters.',
      'SAFETY_BLOCK', null, false
    );
  }

  // Check for content
  if (!candidate.content?.parts || candidate.content.parts.length === 0) {
    throw new AIProviderError(
      'The model returned an empty response. Try rephrasing your question.',
      'EMPTY_RESPONSE', null, true
    );
  }

  // Concatenate text parts, excluding internal thought parts if model returned thoughts
  const nonThoughtParts = candidate.content.parts.filter(part => part.text && !part.thought);
  const partsToUse = nonThoughtParts.length > 0 ? nonThoughtParts : candidate.content.parts.filter(part => part.text);
  const text = partsToUse.map(part => part.text).join('');

  if (!text.trim()) {
    throw new AIProviderError(
      'The model returned a blank response. Try rephrasing your question.',
      'EMPTY_RESPONSE', null, true
    );
  }

  return text;
}

/**
 * Stream responses from Gemini via streamGenerateContent?alt=sse.
 * Decodes Server-Sent Events line by line and yields chunks in real-time.
 *
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @param {Object} [options]
 * @param {string} [options.systemPrompt]
 * @param {number} [options.temperature]
 * @param {number} [options.maxOutputTokens]
 * @param {AbortSignal} [options.signal]
 * @param {function(string): void} [onChunk] - Invoked for each decoded text chunk
 * @returns {Promise<{text: string, model: string}>}
 * @throws {AIProviderError}
 */
async function streamGemini(apiKey, model, prompt, options = {}, onChunk = null) {
  const {
    systemPrompt = null,
    temperature = 0.3,
    maxOutputTokens = 2048,
    signal = null,
  } = options;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
    }
  };

  if (systemPrompt) {
    payload.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }

  const cleanModel = model.replace(/^models\//, '');
  const url = `${GEMINI_BASE_URL}/${cleanModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AIProviderError('Stream aborted by client.', 'ABORTED', null, true);
    }
    if (err instanceof TypeError) {
      throw new AIProviderError(
        'Network request failed. You appear to be offline or blocked.',
        'NETWORK_ERROR', null, true
      );
    }
    throw new AIProviderError(`Stream fetch error: ${err.message}`, 'UNKNOWN', null, false);
  }

  if (!response.ok) {
    await handleHttpError(response);
  }

  if (!response.body) {
    throw new AIProviderError('No readable stream in response body.', 'STREAM_ERROR', response.status, false);
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
      buffer = lines.pop() || ''; // Buffer partial line across chunks (edge case 2.1.6)

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const candidate = parsed.candidates?.[0];

          if (candidate?.finishReason === 'SAFETY') {
            throw new AIProviderError(
              'The model declined to complete this response due to safety filters.',
              'SAFETY_BLOCK', null, false
            );
          }

          const parts = candidate?.content?.parts || [];
          const nonThought = parts.filter(p => p.text && !p.thought);
          const partsToUse = nonThought.length > 0 ? nonThought : parts.filter(p => p.text);
          const chunkText = partsToUse.map(p => p.text).join('');

          if (chunkText) {
            fullText += chunkText;
            if (onChunk) onChunk(chunkText);
          }
        } catch (parseErr) {
          if (parseErr instanceof AIProviderError) throw parseErr;
          // Incomplete JSON boundary (edge case 2.1.6)
          console.warn('[GeminiProvider] SSE parse warning:', parseErr.message);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text: fullText, model: cleanModel };
}

/**
 * Query the ListModels endpoint to get all generative models available for the key.
 *
 * @param {string} apiKey
 * @returns {Promise<Array<{name: string, displayName: string, supportedGenerationMethods: string[]}>>}
 */
async function listModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    await handleHttpError(response);
  }
  const data = await response.json();
  return (data.models || []).filter(m =>
    Array.isArray(m.supportedGenerationMethods) &&
    m.supportedGenerationMethods.includes('generateContent')
  );
}

// Export for use in service worker modules
// (using globalThis since SW doesn't support ES module exports in all setups)
globalThis.GeminiProvider = { callGemini, streamGemini, listModels, AIProviderError };

