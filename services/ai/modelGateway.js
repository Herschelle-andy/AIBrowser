/**
 * Sahayak — Model Gateway (Slice 2.4)
 *
 * Unified entry point for all AI calls.
 *
 * Responsibilities:
 *  - Read API keys from chrome.storage.local
 *  - Select appropriate models for text, vision, and reasoning tasks
 *  - Throttle requests to prevent spam / quota bursts (Edge case 2.4.4)
 *  - Wrap all calls with RetryWithFallback:
 *    - Exponential backoff with jitter on rate limits (HTTP 429 / RESOURCE_EXHAUSTED)
 *    - Respect Retry-After header if provided (Edge case 2.4.3)
 *    - Automatic fallback to Groq (llama-3.1-8b-instant) for text/reasoning tasks
 *    - Handles vision quota exhaustion with specific user messaging
 *    - Indicates when fallback model is in use via isFallback flag (Edge case 2.4.5)
 */

(function () {
  'use strict';

  /** Default models for each task type. */
  const MODELS = {
    text: 'gemini-2.0-flash',             // Standard GA model
    reasoning: 'gemini-2.0-flash',        // Structured output & complex reasoning
    vision: 'gemini-2.0-flash',           // Required for multimodal (image) input
  };

  /** Candidate models to try in order of preference. */
  const PREFERRED_CANDIDATES = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash-lite',
  ];

  /** Candidate Groq models in order of preference. */
  const GROQ_PREFERRED_CANDIDATES = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ];

  // Memory cache of known working models for the current worker lifetime
  let _discoveredWorkingModel = null;
  let _discoveredWorkingGroqModel = null;

  // Rate-limiting throttle state (Edge case 2.4.4)
  let _lastRequestTime = 0;
  const MIN_REQUEST_INTERVAL_MS = 600;

  /**
   * Resolve an active Groq chat model for the given API key via live models list.
   * Free call (0 token cost) that guarantees we never call decommissioned models
   * or burn user credits on 404s.
   *
   * @param {string} apiKey
   * @returns {Promise<string>}
   */
  async function resolveWorkingGroqModel(apiKey) {
    if (_discoveredWorkingGroqModel) {
      return _discoveredWorkingGroqModel;
    }

    try {
      const available = await GroqProvider.listModels(apiKey);
      if (available && available.length > 0) {
        const activeIds = available
          .map((m) => m.id)
          .filter((id) => {
            if (!id || typeof id !== 'string') return false;
            const lower = id.toLowerCase();
            return (
              !lower.includes('whisper') &&
              !lower.includes('orpheus') &&
              !lower.includes('guard') &&
              !lower.includes('embed') &&
              !lower.includes('mixtral') &&
              !lower.includes('vision')
            );
          });

        console.log('[ModelGateway] Active Groq text models for key:', activeIds);

        // 1. Try matching against preferred candidates
        for (const preferred of GROQ_PREFERRED_CANDIDATES) {
          if (activeIds.includes(preferred)) {
            _discoveredWorkingGroqModel = preferred;
            console.log(`[ModelGateway] Selected preferred Groq model: ${_discoveredWorkingGroqModel}`);
            return _discoveredWorkingGroqModel;
          }
        }

        // 2. Pick any active llama-3 model
        const anyLlama = activeIds.find((id) => id.startsWith('llama-3') || id.startsWith('llama3'));
        if (anyLlama) {
          _discoveredWorkingGroqModel = anyLlama;
          console.log(`[ModelGateway] Selected active Llama Groq model: ${_discoveredWorkingGroqModel}`);
          return _discoveredWorkingGroqModel;
        }

        // 3. Fallback to first active chat model
        if (activeIds.length > 0) {
          _discoveredWorkingGroqModel = activeIds[0];
          console.log(`[ModelGateway] Selected first available Groq model: ${_discoveredWorkingGroqModel}`);
          return _discoveredWorkingGroqModel;
        }
      }
    } catch (listErr) {
      console.warn('[ModelGateway] Live Groq models listing warning:', listErr.message);
    }

    // Safe fallback
    _discoveredWorkingGroqModel = GROQ_PREFERRED_CANDIDATES[0];
    return _discoveredWorkingGroqModel;
  }

  /**
   * Execute Groq call with candidate model progression and dynamic discovery.
   */
  async function executeGroqCall(apiKey, prompt, options = {}) {
    const model = await resolveWorkingGroqModel(apiKey);
    try {
      return await GroqProvider.callGroq(apiKey, model, prompt, options);
    } catch (err) {
      if (err.code === 'MODEL_NOT_FOUND' || err.status === 404 || err.status === 400) {
        console.warn(`[ModelGateway] Groq model '${model}' rejected (${err.message}). Invalidate and retry with fallback...`);
        _discoveredWorkingGroqModel = null;
        // Try fallback between 70b and 8b
        const fallbackModel = (model === 'llama-3.3-70b-versatile') ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile';
        const res = await GroqProvider.callGroq(apiKey, fallbackModel, prompt, options);
        _discoveredWorkingGroqModel = fallbackModel;
        return res;
      }
      throw err;
    }
  }

  /**
   * Execute Groq stream with candidate model progression and dynamic discovery.
   */
  async function executeGroqStream(apiKey, prompt, options = {}, onChunk = null) {
    const model = await resolveWorkingGroqModel(apiKey);
    try {
      return await GroqProvider.streamGroq(apiKey, model, prompt, options, onChunk);
    } catch (err) {
      if (err.code === 'MODEL_NOT_FOUND' || err.status === 404 || err.status === 400) {
        console.warn(`[ModelGateway] Groq stream model '${model}' rejected (${err.message}). Invalidate and retry with fallback...`);
        _discoveredWorkingGroqModel = null;
        // Try fallback between 70b and 8b
        const fallbackModel = (model === 'llama-3.3-70b-versatile') ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile';
        const res = await GroqProvider.streamGroq(apiKey, fallbackModel, prompt, options, onChunk);
        _discoveredWorkingGroqModel = fallbackModel;
        return res;
      }
      throw err;
    }
  }

  /**
   * Enforce minimum spacing between calls.
   */
  async function throttleGateway() {
    const now = Date.now();
    const elapsed = now - _lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    _lastRequestTime = Date.now();
  }

  /**
   * Send a prompt to the AI with automatic retries and fallback.
   *
   * @param {Object} params
   * @param {string} params.prompt
   * @param {string} [params.systemPrompt]
   * @param {string} [params.task='text'] - 'text' | 'reasoning' | 'vision'
   * @param {number} [params.temperature=0.3]
   * @param {number} [params.maxTokens=2048]
   * @param {string} [params.videoUrl]
   * @param {Object} [params.inlineData]
   * @returns {Promise<{text: string, model: string, provider: string, isFallback: boolean}>}
   */
  async function queryAI({
    prompt,
    systemPrompt,
    task = 'text',
    temperature = 0.3,
    maxTokens = 2048,
    videoUrl = null,
    inlineData = null,
    responseMimeType = null,
    responseSchema = null,
    jsonMode = false,
  }) {
    await throttleGateway();

    const keys = await getApiKeys();
    const hasGemini = !!(keys.geminiKey && keys.geminiKey.trim());
    const hasGroq = !!(keys.groqKey && keys.groqKey.trim());

    if (!hasGemini && !hasGroq) {
      throw new GeminiProvider.AIProviderError(
        'No API key configured. Please add your Gemini or Groq API key in Settings.',
        'NO_KEY',
        null,
        false
      );
    }

    // Direct Groq execution if user only provided a Groq key (and task is text-based)
    if (!hasGemini && hasGroq) {
      if (task === 'vision') {
        throw new GeminiProvider.AIProviderError(
          'Screenshot visual questions require a Gemini API key. Please add a Gemini key in Settings.',
          'NO_GEMINI_KEY_FOR_VISION',
          null,
          false
        );
      }
      console.log('[ModelGateway] No Gemini key found; using Groq primary.');
      const groqRes = await executeGroqCall(keys.groqKey, prompt, {
        systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        jsonMode: jsonMode || (responseMimeType === 'application/json') || task === 'reasoning',
      });
      return {
        text: groqRes.text,
        model: groqRes.model,
        provider: 'groq',
        isFallback: true,
      };
    }

    // Primary function: Try Gemini model candidates
    const primaryFn = async () => {
      const initialModel = _discoveredWorkingModel || MODELS[task] || MODELS.text;
      const modelsToTry = [
        initialModel,
        ...PREFERRED_CANDIDATES.filter((m) => m !== initialModel),
      ];

      let lastError = null;

      for (const model of modelsToTry) {
        try {
          const text = await GeminiProvider.callGemini(keys.geminiKey, model, prompt, {
            systemPrompt,
            temperature,
            maxOutputTokens: maxTokens,
            videoUrl,
            inlineData,
            responseMimeType,
            responseSchema,
          });

          _discoveredWorkingModel = model;

          return {
            text,
            model,
            provider: 'gemini',
            isFallback: false,
          };
        } catch (err) {
          lastError = err;
          if (err.code === 'MODEL_NOT_FOUND' || err.code === 'SERVER_ERROR' || err.code === 'TIMEOUT') {
            console.warn(`[ModelGateway] Model '${model}' failed (${err.code}). Trying next candidate...`);
            continue;
          }
          throw err;
        }
      }

      // If predefined models failed, query ListModels dynamically
      try {
        console.log('[ModelGateway] Predefined candidates unavailable. Querying ListModels...');
        const available = await GeminiProvider.listModels(keys.geminiKey);
        if (available && available.length > 0) {
          const sorted = [...available].sort((a, b) => b.name.localeCompare(a.name));
          for (const item of sorted) {
            const modelId = item.name.replace(/^models\//, '');
            try {
              const text = await GeminiProvider.callGemini(keys.geminiKey, modelId, prompt, {
                systemPrompt,
                temperature,
                maxOutputTokens: maxTokens,
                videoUrl,
                inlineData,
                responseMimeType,
                responseSchema,
              });

              _discoveredWorkingModel = modelId;
              return {
                text,
                model: modelId,
                provider: 'gemini',
                isFallback: false,
              };
            } catch (callErr) {
              if (callErr.code === 'MODEL_NOT_FOUND' || callErr.code === 'SERVER_ERROR' || callErr.code === 'TIMEOUT') continue;
              throw callErr;
            }
          }
        }
      } catch (discErr) {
        // Fall through to throw lastError
      }

      throw lastError;
    };

    // Fallback function: Groq (text only, if key configured)
    let fallbackFn = null;
    if (task !== 'vision' && hasGroq) {
      fallbackFn = async () => {
        console.warn('[ModelGateway] Executing Groq fallback with model candidate resolution...');
        const groqRes = await executeGroqCall(keys.groqKey, prompt, {
          systemPrompt,
          temperature,
          maxOutputTokens: maxTokens,
          jsonMode: jsonMode || (responseMimeType === 'application/json') || task === 'reasoning',
        });

        return {
          text: groqRes.text,
          model: groqRes.model,
          provider: 'groq',
          isFallback: true,
        };
      };
    }

    // Execute with retry & fallback
    return await RetryWithFallback.callWithFallback(primaryFn, fallbackFn, {
      task,
      hasGroqKey: hasGroq,
      maxRetries: 2,
    });
  }

  /**
   * Stream prompt response with automatic retries and fallback.
   *
   * @param {Object} params
   * @param {string} params.prompt
   * @param {string} [params.systemPrompt]
   * @param {string} [params.task='text']
   * @param {number} [params.temperature=0.3]
   * @param {number} [params.maxTokens=2048]
   * @param {AbortSignal} [params.signal]
   * @param {function(string): void} params.onChunk
   * @param {Object} [params.inlineData]
   * @returns {Promise<{text: string, model: string, provider: string, isFallback: boolean}>}
   */
  async function streamAI({
    prompt,
    systemPrompt,
    task = 'text',
    temperature = 0.3,
    maxTokens = 2048,
    signal = null,
    onChunk,
    inlineData = null,
  }) {
    await throttleGateway();

    const keys = await getApiKeys();
    const hasGemini = !!(keys.geminiKey && keys.geminiKey.trim());
    const hasGroq = !!(keys.groqKey && keys.groqKey.trim());

    if (!hasGemini && !hasGroq) {
      throw new GeminiProvider.AIProviderError(
        'No API key configured. Please add your Gemini or Groq API key in Settings.',
        'NO_KEY',
        null,
        false
      );
    }

    // Direct Groq streaming if only Groq key is present
    if (!hasGemini && hasGroq) {
      if (task === 'vision') {
        throw new GeminiProvider.AIProviderError(
          'Vision streaming requires a Gemini API key.',
          'NO_GEMINI_KEY_FOR_VISION',
          null,
          false
        );
      }
      const groqRes = await executeGroqStream(keys.groqKey, prompt, {
        systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        signal,
      }, onChunk);
      return {
        text: groqRes.text,
        model: groqRes.model,
        provider: 'groq',
        isFallback: true,
      };
    }

    // Primary Gemini streaming function
    const primaryFn = async () => {
      const initialModel = _discoveredWorkingModel || MODELS[task] || MODELS.text;
      const modelsToTry = [
        initialModel,
        ...PREFERRED_CANDIDATES.filter((m) => m !== initialModel),
      ];

      let lastError = null;

      for (const model of modelsToTry) {
        try {
          const result = await GeminiProvider.streamGemini(keys.geminiKey, model, prompt, {
            systemPrompt,
            temperature,
            maxOutputTokens: maxTokens,
            signal,
            inlineData,
          }, onChunk);

          _discoveredWorkingModel = model;

          return {
            text: result.text,
            model: result.model,
            provider: 'gemini',
            isFallback: false,
          };
        } catch (err) {
          lastError = err;
          if (err.code === 'MODEL_NOT_FOUND' || err.code === 'SERVER_ERROR' || err.code === 'TIMEOUT') {
            console.warn(`[ModelGateway] Stream: Model '${model}' failed (${err.code}). Trying next...`);
            continue;
          }
          throw err;
        }
      }

      // If predefined models failed, query ListModels dynamically for streaming
      try {
        console.log('[ModelGateway] Predefined stream candidates unavailable. Querying ListModels...');
        const available = await GeminiProvider.listModels(keys.geminiKey);
        if (available && available.length > 0) {
          const sorted = [...available].sort((a, b) => b.name.localeCompare(a.name));
          for (const item of sorted) {
            const modelId = item.name.replace(/^models\//, '');
            try {
              const result = await GeminiProvider.streamGemini(keys.geminiKey, modelId, prompt, {
                systemPrompt,
                temperature,
                maxOutputTokens: maxTokens,
                signal,
                inlineData,
              }, onChunk);

              _discoveredWorkingModel = modelId;
              return {
                text: result.text,
                model: result.model,
                provider: 'gemini',
                isFallback: false,
              };
            } catch (streamErr) {
              if (streamErr.code === 'MODEL_NOT_FOUND' || streamErr.code === 'SERVER_ERROR' || streamErr.code === 'TIMEOUT') continue;
              throw streamErr;
            }
          }
        }
      } catch (discErr) {
        // Fall through to throw lastError
      }

      throw lastError;
    };

    // Fallback Groq streaming function
    let fallbackFn = null;
    if (task !== 'vision' && hasGroq) {
      fallbackFn = async () => {
        console.warn('[ModelGateway] Stream: Switching to Groq streaming fallback with model resolution...');
        const groqResult = await executeGroqStream(keys.groqKey, prompt, {
          systemPrompt,
          temperature,
          maxOutputTokens: maxTokens,
          signal,
        }, onChunk);

        return {
          text: groqResult.text,
          model: groqResult.model,
          provider: 'groq',
          isFallback: true,
        };
      };
    }

    return await RetryWithFallback.callWithFallback(primaryFn, fallbackFn, {
      task,
      hasGroqKey: hasGroq,
      maxRetries: 2,
    });
  }

  /**
   * Read stored API keys. Returns { geminiKey, groqKey }.
   */
  async function getApiKeys() {
    if (chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get('sahayak_api_keys');
      return result.sahayak_api_keys || { geminiKey: '', groqKey: '' };
    }
    return { geminiKey: '', groqKey: '' };
  }

  /**
   * Clear cached working model (e.g. when API keys are changed).
   */
  function clearModelCache() {
    _discoveredWorkingModel = null;
    _discoveredWorkingGroqModel = null;
  }

  // Export
  globalThis.ModelGateway = {
    queryAI,
    streamAI,
    MODELS,
    clearModelCache,
  };
})();
