/**
 * Model Gateway — Unified entry point for all AI calls.
 *
 * Responsibilities:
 *  - Read API keys from chrome.storage.local
 *  - Route to the correct provider (Gemini, later Groq)
 *  - Select the right model for the task
 *  - Later (Slice 2.4): retry + fallback logic
 *
 * For now this is a thin passthrough to GeminiProvider.
 */

/** Default models for each task type. */
const MODELS = {
  text: 'gemini-3.8-flash',             // Current standard GA multimodal model
  reasoning: 'gemini-3.8-flash',        // Stronger — complex reasoning or structured output
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

/**
 * Send a text prompt to the AI and get a text response.
 * Dynamically resolves working models via ListModels if standard IDs 404.
 *
 * @param {Object} params
 * @param {string} params.prompt          — The user-facing prompt text
 * @param {string} [params.systemPrompt]  — System instruction
 * @param {string} [params.task]          — 'text' | 'reasoning' | 'vision' (selects model)
 * @param {number} [params.temperature]   — 0.0–2.0
 * @param {number} [params.maxTokens]     — Max output tokens
 * @param {string} [params.videoUrl]      — Optional video URL for multimodal analysis
 * @returns {Promise<{text: string, model: string, provider: string}>}
 */
async function queryAI({ prompt, systemPrompt, task = 'text', temperature, maxTokens, videoUrl = null }) {
  // 1. Read API keys
  const keys = await getApiKeys();

  if (!keys.geminiKey) {
    throw new GeminiProvider.AIProviderError(
      'No API key configured. Please add your Gemini API key in Settings.',
      'NO_KEY', null, false
    );
  }

  // 2. Build model candidates list (putting any previously verified working model first)
  const initialModel = _discoveredWorkingModel || MODELS[task] || MODELS.text;
  const modelsToTry = [
    initialModel,
    ...PREFERRED_CANDIDATES.filter(m => m !== initialModel)
  ];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const text = await GeminiProvider.callGemini(keys.geminiKey, model, prompt, {
        systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        videoUrl,
      });

      // Cache this working model
      _discoveredWorkingModel = model;

      return {
        text,
        model,
        provider: 'gemini',
      };
    } catch (err) {
      lastError = err;
      // If model not found (404), continue trying next candidates
      if (err.code === 'MODEL_NOT_FOUND') {
        console.warn(`[ModelGateway] Model '${model}' returned 404. Trying next candidate...`);
        continue;
      }
      // For auth errors (401, 403), rate limits, or safety blocks, do not retry
      throw err;
    }
  }

  // 3. Fallback: Query ListModels dynamically to find what models this API key actually supports
  try {
    console.log('[ModelGateway] Predefined candidates failed. Querying ListModels to discover supported models...');
    const available = await GeminiProvider.listModels(keys.geminiKey);

    if (available && available.length > 0) {
      // Score and sort models: prefer 3.8 > flash > latest versions
      const scoreModel = (name) => {
        const lower = name.toLowerCase();
        if (lower.includes('3.8-flash')) return 100;
        if (lower.includes('3.8')) return 90;
        if (lower.includes('gemini-3')) return 80;
        if (lower.includes('flash') && !lower.includes('2.5') && !lower.includes('1.5')) return 70;
        if (lower.includes('flash')) return 60;
        if (lower.includes('gemini')) return 40;
        return 10;
      };

      const sortedModels = [...available].sort((a, b) => scoreModel(b.name) - scoreModel(a.name));

      for (const item of sortedModels) {
        const modelId = item.name.replace(/^models\//, '');
        try {
          console.log(`[ModelGateway] Trying discovered model from API: ${modelId}`);
          const text = await GeminiProvider.callGemini(keys.geminiKey, modelId, prompt, {
            systemPrompt,
            temperature,
            maxOutputTokens: maxTokens,
            videoUrl,
          });

          _discoveredWorkingModel = modelId;

          return {
            text,
            model: modelId,
            provider: 'gemini',
          };
        } catch (callErr) {
          if (callErr.code === 'MODEL_NOT_FOUND') {
            console.warn(`[ModelGateway] Discovered model '${modelId}' returned 404/unavailable. Trying next...`);
            continue;
          }
          throw callErr;
        }
      }
    }
  } catch (discoveryErr) {
    console.error('[ModelGateway] Model discovery via ListModels failed:', discoveryErr);
  }

  // If all attempts failed
  throw lastError;
}

/**
 * Stream prompt responses from the AI provider chunk by chunk.
 *
 * @param {Object} params
 * @param {string} params.prompt
 * @param {string} [params.systemPrompt]
 * @param {string} [params.task='text']
 * @param {number} [params.temperature=0.3]
 * @param {number} [params.maxTokens=2048]
 * @param {AbortSignal} [params.signal]
 * @param {function(string): void} params.onChunk
 * @returns {Promise<{text: string, model: string, provider: string}>}
 */
async function streamAI({ prompt, systemPrompt, task = 'text', temperature = 0.3, maxTokens = 2048, signal = null, onChunk }) {
  const keys = await getApiKeys();

  if (!keys.geminiKey) {
    throw new GeminiProvider.AIProviderError(
      'No API key configured. Please add your Gemini API key in Settings.',
      'NO_KEY', null, false
    );
  }

  const initialModel = _discoveredWorkingModel || MODELS[task] || MODELS.text;
  const modelsToTry = [
    initialModel,
    ...PREFERRED_CANDIDATES.filter(m => m !== initialModel)
  ];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const result = await GeminiProvider.streamGemini(keys.geminiKey, model, prompt, {
        systemPrompt,
        temperature,
        maxOutputTokens: maxTokens,
        signal,
      }, onChunk);

      _discoveredWorkingModel = model;

      return {
        text: result.text,
        model: result.model,
        provider: 'gemini',
      };
    } catch (err) {
      lastError = err;
      if (err.code === 'MODEL_NOT_FOUND') {
        console.warn(`[ModelGateway] Stream: Model '${model}' returned 404. Trying next candidate...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Read stored API keys. Returns { geminiKey, groqKey }.
 */
async function getApiKeys() {
  const result = await chrome.storage.local.get('sahayak_api_keys');
  return result.sahayak_api_keys || { geminiKey: '', groqKey: '' };
}

/**
 * Clear cached working model (e.g. when API keys are changed).
 */
function clearModelCache() {
  _discoveredWorkingModel = null;
}

// Export
globalThis.ModelGateway = { queryAI, streamAI, MODELS, clearModelCache };

