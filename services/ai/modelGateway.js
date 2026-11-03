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
    text: 'gemini-3.8-flash',             // Standard GA model
    reasoning: 'gemini-3.8-flash',        // Structured output & complex reasoning
    vision: 'gemini-3.8-flash',           // Required for multimodal (image) input
  };

  /** Candidate models to try in order of preference. */
  const PREFERRED_CANDIDATES = [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ];

  // Memory cache of a known working model for the current worker lifetime
  let _discoveredWorkingModel = null;

  // Rate-limiting throttle state (Edge case 2.4.4)
  let _lastRequestTime = 0;
  const MIN_REQUEST_INTERVAL_MS = 600;

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
      const groqRes = await GroqProvider.callGroq(keys.groqKey, 'llama-3.1-8b-instant', prompt, {
        systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        jsonMode: task === 'reasoning',
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
          if (err.code === 'MODEL_NOT_FOUND') {
            console.warn(`[ModelGateway] Model '${model}' returned 404. Trying next candidate...`);
            continue;
          }
          throw err;
        }
      }

      // If predefined models 404, query ListModels dynamically
      try {
        console.log('[ModelGateway] Predefined candidates 404. Querying ListModels...');
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
              });

              _discoveredWorkingModel = modelId;
              return {
                text,
                model: modelId,
                provider: 'gemini',
                isFallback: false,
              };
            } catch (callErr) {
              if (callErr.code === 'MODEL_NOT_FOUND') continue;
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
        console.warn('[ModelGateway] Executing Groq fallback (llama-3.1-8b-instant)...');
        const groqRes = await GroqProvider.callGroq(keys.groqKey, 'llama-3.1-8b-instant', prompt, {
          systemPrompt,
          temperature,
          maxOutputTokens: maxTokens,
          jsonMode: task === 'reasoning',
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
      const groqRes = await GroqProvider.streamGroq(keys.groqKey, 'llama-3.1-8b-instant', prompt, {
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
          if (err.code === 'MODEL_NOT_FOUND') {
            console.warn(`[ModelGateway] Stream: Model '${model}' returned 404. Trying next...`);
            continue;
          }
          throw err;
        }
      }

      throw lastError;
    };

    // Fallback Groq streaming function
    let fallbackFn = null;
    if (task !== 'vision' && hasGroq) {
      fallbackFn = async () => {
        console.warn('[ModelGateway] Stream: Switching to Groq streaming fallback...');
        const groqResult = await GroqProvider.streamGroq(keys.groqKey, 'llama-3.1-8b-instant', prompt, {
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
  }

  // Export
  globalThis.ModelGateway = {
    queryAI,
    streamAI,
    MODELS,
    clearModelCache,
  };
})();
