/**
 * Sahayak — Background Service Worker
 *
 * Central orchestrator:
 * - Opens the side panel on extension icon click.
 * - Routes messages between the side panel and content scripts.
 * - Injects content scripts dynamically when needed.
 * - Calls AI model APIs via the Model Gateway.
 */

// ── Load service modules ──────────────────────────────────────────────
// Service workers use importScripts for non-module scripts.
// Absolute extension paths ensure reliable resolution across contexts.
importScripts(
  '/services/ai/geminiProvider.js',
  '/services/ai/groqProvider.js',
  '/services/ai/retryWithFallback.js',
  '/services/ai/modelGateway.js',
  '/services/ai/promptBuilder.js',
  '/services/state/agentStateMachine.js',
  '/background/contextMenus.js',
  '/background/tabCapture.js'
);

// ── Side Panel Behaviour ──────────────────────────────────────────────
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('[Sahayak] Could not set panel behavior:', err);
  });
}

// ── Extension Install / Update ────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const existing = await chrome.storage.local.get('sahayak_preferences');
    if (!existing.sahayak_preferences) {
      await chrome.storage.local.set({
        sahayak_preferences: {
          language: 'en',
          schemaVersion: 1
        }
      });
    }
    console.log('[Sahayak] Extension installed. Defaults initialised.');
  }

  if (details.reason === 'update') {
    console.log(`[Sahayak] Extension updated to v${chrome.runtime.getManifest().version}`);
  }
});

// ── Message Router ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  (async () => {
    try {
      const response = await handleMessage(message, sender);
      try {
        sendResponse(response);
      } catch (sendErr) {
        console.warn('[Sahayak] Could not send response (port closed):', sendErr.message);
      }
    } catch (err) {
      console.error('[Sahayak] Message handler error:', err);

      try {
        if (err.name === 'AIProviderError') {
          sendResponse({
            success: false,
            error: {
              code: err.code,
              message: err.message,
              retryable: err.retryable
            }
          });
        } else {
          sendResponse({
            success: false,
            error: { code: 'UNKNOWN', message: err.message || 'An unexpected error occurred.' }
          });
        }
      } catch (sendErr) {
        console.warn('[Sahayak] Could not send error response:', sendErr.message);
      }
    }
  })();
  return true; // Keep the message channel open for async response
});

// ── Streaming Port Connection Handler (Slice 2.1) ──────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chat-stream' && port.name !== 'stream') {
    return;
  }

  let abortController = new AbortController();

  port.onDisconnect.addListener(() => {
    // Edge case 2.1.5: streaming port disconnects mid-response
    console.log('[Sahayak] Chat stream port disconnected by client. Aborting in-flight AI stream.');
    abortController.abort();
  });

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'CHAT_QUERY') return;

    if (abortController.signal.aborted) {
      abortController = new AbortController();
    }

    try {
      await handleChatStreamQuery(msg, port, abortController.signal);
    } catch (err) {
      console.error('[Sahayak] Chat stream query error:', err);
      try {
        port.postMessage({
          type: 'STREAM_ERROR',
          error: {
            code: err.code || 'STREAM_ERROR',
            message: err.message || 'An error occurred while streaming response.'
          }
        });
      } catch (postErr) {
        // Port may be closed
      }
    }
  });
});

/**
 * Route an incoming message to the appropriate handler.
 */
async function handleMessage(message, sender) {
  switch (message.type) {

    // ── Settings & Preferences ──────────────────────────────
    case 'GET_API_KEYS': {
      const result = await chrome.storage.local.get('sahayak_api_keys');
      return {
        success: true,
        data: result.sahayak_api_keys || { geminiKey: '', groqKey: '' }
      };
    }

    case 'SAVE_API_KEYS': {
      const keys = message.payload || {};
      const cleaned = {
        geminiKey: (keys.geminiKey || '').trim(),
        groqKey: (keys.groqKey || '').trim()
      };
      await chrome.storage.local.set({ sahayak_api_keys: cleaned });
      if (globalThis.ModelGateway && typeof ModelGateway.clearModelCache === 'function') {
        ModelGateway.clearModelCache();
      }
      return { success: true };
    }

    case 'GET_PREFERENCES': {
      const result = await chrome.storage.local.get('sahayak_preferences');
      return {
        success: true,
        data: result.sahayak_preferences || { language: 'en', schemaVersion: 1 }
      };
    }

    case 'SAVE_PREFERENCES': {
      const prefs = message.payload || {};
      await chrome.storage.local.set({ sahayak_preferences: prefs });
      return { success: true };
    }

    // ── Tab Info ─────────────────────────────────────────────
    case 'GET_ACTIVE_TAB_INFO': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        return { success: false, error: { code: 'NO_TAB', message: 'No active tab found.' } };
      }
      const restricted = isRestrictedUrl(tab.url);
      const isYouTube = isYouTubeUrl(tab.url);
      return {
        success: true,
        data: { tabId: tab.id, url: tab.url, title: tab.title, isRestricted: restricted, isYouTube }
      };
    }

    // ── AI: Context Menu Quick Actions (Slice 2.2) ───────────
    case 'EXECUTE_CONTEXT_ACTION': {
      const { action = 'explain', text, language } = message.payload || {};

      if (!text || text.trim().length === 0) {
        return {
          success: false,
          error: { code: 'EMPTY_INPUT', message: 'No text provided. Please select or paste some text.' }
        };
      }

      // Truncate very long input to 2,000 characters (edge case 2.2.2)
      let isTruncated = false;
      let trimmedText = text.trim();
      if (trimmedText.length > 2000) {
        trimmedText = trimmedText.substring(0, 2000);
        isTruncated = true;
      }

      let lang = language;
      if (!lang) {
        const prefs = await chrome.storage.local.get('sahayak_preferences');
        lang = prefs.sahayak_preferences?.language || 'en';
      }

      const { systemPrompt, userPrompt } = PromptBuilder.buildContextActionPrompt(action, trimmedText, lang);

      const result = await ModelGateway.queryAI({
        prompt: userPrompt,
        systemPrompt,
        task: 'text',
        temperature: 0.3,
        maxTokens: 1024,
      });

      return {
        success: true,
        data: {
          text: result.text,
          model: result.model,
          provider: result.provider,
          isFallback: result.isFallback,
          action,
          isTruncated
        }
      };
    }

    // ── AI: Explain Text (Slice 1.2) ────────────────────────
    case 'EXPLAIN_TEXT': {
      const { text, language } = message.payload || {};

      if (!text || text.trim().length === 0) {
        return {
          success: false,
          error: { code: 'EMPTY_INPUT', message: 'No text provided. Please select or paste some text.' }
        };
      }

      // Truncate very long input (edge case 2.2.2 — preemptive)
      const trimmedText = text.length > 3000 ? text.substring(0, 3000) + '\n\n[...text truncated]' : text;

      let lang = language;
      if (!lang) {
        const prefs = await chrome.storage.local.get('sahayak_preferences');
        lang = prefs.sahayak_preferences?.language || 'en';
      }

      const langInstruction = PromptBuilder.getLanguageInstruction(lang);

      const result = await ModelGateway.queryAI({
        prompt: `Explain the following in simple, plain language:\n\n${trimmedText}`,
        systemPrompt: `You are Sahayak, a helpful browser assistant. ${langInstruction}`,
        task: 'text',
        temperature: 0.3,
        maxTokens: 1024,
      });

      return {
        success: true,
        data: {
          text: result.text,
          model: result.model,
          provider: result.provider,
          isFallback: result.isFallback
        }
      };
    }

    // ── Article Extraction & Summary (Slice 1.3) ─────────────
    case 'EXTRACT_ARTICLE': {
      return await handleExtractArticle();
    }

    case 'SUMMARIZE_PAGE': {
      return await handleSummarizePage(message.payload || {});
    }

    // ── YouTube Summarisation (Slice 1.4) ────────────────────
    case 'SUMMARIZE_YOUTUBE': {
      return await handleSummarizeYouTube(message.payload || {});
    }

    case 'SEEK_VIDEO': {
      return await handleSeekVideo(message.payload || {});
    }

    // ── Grounded Page Chat (Slice 2.1) ───────────────────────
    case 'CHAT_QUERY': {
      return await handleChatQuery(message.payload || {});
    }

    // ── Screenshot & Ask (Slice 2.3) ──────────────────────────
    case 'CAPTURE_SCREENSHOT': {
      try {
        const dataUrl = await TabCapture.captureTab();
        return { success: true, data: { dataUrl } };
      } catch (err) {
        return {
          success: false,
          error: { code: 'CAPTURE_FAILED', message: err.message || 'Could not capture screenshot.' }
        };
      }
    }

    case 'SCREENSHOT_ASK': {
      const { image, question, language } = message.payload || {};

      if (!image) {
        return {
          success: false,
          error: { code: 'EMPTY_IMAGE', message: 'No screenshot provided.' }
        };
      }

      if (!question || !question.trim()) {
        return {
          success: false,
          error: { code: 'EMPTY_QUESTION', message: 'Please enter a question about the image.' }
        };
      }

      let lang = language;
      if (!lang) {
        const prefs = await chrome.storage.local.get('sahayak_preferences');
        lang = prefs.sahayak_preferences?.language || 'en';
      }

      const langRule = PromptBuilder.getLanguageInstruction(lang);
      const systemPrompt = `You are Sahayak, an intelligent visual browser assistant. ${langRule} Analyze the provided screenshot carefully and answer the user's question accurately. Focus on visual details, charts, numbers, text, buttons, diagrams, or errors shown in the image.`;

      try {
        const result = await ModelGateway.queryAI({
          prompt: question.trim(),
          systemPrompt,
          task: 'vision',
          temperature: 0.3,
          maxTokens: 1536,
          inlineData: {
            mimeType: 'image/png',
            data: image
          }
        });

        return {
          success: true,
          data: {
            text: result.text,
            model: result.model
          }
        };
      } catch (err) {
        if (err.code === 'RATE_LIMIT' || err.status === 429) {
          return {
            success: false,
            error: {
              code: 'VISION_QUOTA_EXHAUSTED',
              message: 'Screenshot questions require Gemini Flash, which has reached its limit. Please try again later.'
            }
          };
        }
        return {
          success: false,
          error: {
            code: err.code || 'VISION_ERROR',
            message: err.message || 'Could not analyze screenshot.'
          }
        };
      }
    }

    // ── Interactive Element Scanner (Slice 3.1) ──────────────
    case 'SCAN_ELEMENTS': {
      return await handleScanElements(message.payload || {});
    }

    // ── Find Element (Slice 3.3) ─────────────────────────────
    case 'FIND_ELEMENT': {
      return await handleFindElement(message.payload || message || {});
    }

    // ── Agent Loop & Approval UI (Slice 3.4) ─────────────────
    case 'AGENT_START': {
      return await handleAgentStart(message.payload || message || {});
    }

    case 'AGENT_APPROVE': {
      return await handleAgentApprove(message.payload || message || {});
    }

    case 'AGENT_SKIP': {
      return await handleAgentSkip(message.payload || message || {});
    }

    case 'AGENT_STOP': {
      return await handleAgentStop();
    }

    case 'GET_AGENT_STATE': {
      return { success: true, data: AgentStateMachine.getState() };
    }

    // ── Numbered Badges & Overlay (Slice 3.2) ─────────────────
    case 'SHOW_BADGES': {
      return await handleForwardToTab(message);
    }

    case 'CLEAR_BADGES': {
      return await handleForwardToTab(message);
    }

    case 'HIGHLIGHT_ELEMENT': {
      return await handleForwardToTab(message);
    }

    // ── Health Check ─────────────────────────────────────────
    case 'PING': {
      return { success: true, data: { alive: true, timestamp: Date.now() } };
    }

    default:
      return {
        success: false,
        error: { code: 'UNKNOWN_MESSAGE', message: `Unknown message type: ${message.type}` }
      };
  }
}

// ── Helpers & Action Handlers ──────────────────────────────────────────

/**
 * Ensures the content script and Readability library are active in the target tab.
 * Injects dynamically if the tab was opened before extension was loaded.
 */
async function ensureContentScriptInjected(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (ping && ping.alive) {
      const toInject = [];
      if (!ping.hasScanner) toInject.push('content/scanner.js');
      if (!ping.hasOverlay) toInject.push('content/overlay.js');
      if (toInject.length > 0) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: toInject
        });
      }
      return true;
    }
  } catch (e) {
    // Content script not listening in this tab yet; proceed to inject
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'content/lib/Readability.js',
        'content/reader.js',
        'content/youtube.js',
        'content/scanner.js',
        'content/overlay.js',
        'content/index.js'
      ]
    });
    // Brief breather for the script to register message listener
    await new Promise((resolve) => setTimeout(resolve, 80));
    return true;
  } catch (err) {
    console.error('[Sahayak] Script injection failed:', err);
    throw err;
  }
}

/**
 * Forwards an overlay or content message (SHOW_BADGES, CLEAR_BADGES, HIGHLIGHT_ELEMENT)
 * to the active tab, ensuring content scripts are injected.
 */
async function handleForwardToTab(message) {
  let tabId = message.payload?.tabId || message.tabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
    }
    if (isRestrictedUrl(tab.url)) {
      return {
        success: false,
        error: { code: 'RESTRICTED_URL', message: 'Sahayak cannot interact with system or internal browser pages.' }
      };
    }
    tabId = tab.id;
  }

  try {
    await ensureContentScriptInjected(tabId);
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.error(`[Sahayak] Message forwarding error (${message.type}):`, err);
    return {
      success: false,
      error: {
        code: 'COMMUNICATION_FAILED',
        message: err.message || `Could not send ${message.type} to page.`
      }
    };
  }
}

/**
 * Handle interactive element scanning on the active tab (Slice 3.1).
 */
async function handleScanElements(payload = {}) {
  let tabId = payload.tabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
    }
    if (isRestrictedUrl(tab.url)) {
      return {
        success: false,
        error: { code: 'RESTRICTED_URL', message: 'Sahayak cannot scan system or internal browser pages.' }
      };
    }
    tabId = tab.id;
  }

  try {
    await ensureContentScriptInjected(tabId);
    return await chrome.tabs.sendMessage(tabId, { type: 'SCAN_ELEMENTS' });
  } catch (err) {
    console.error('[Sahayak] Scan communication error:', err);
    return {
      success: false,
      error: {
        code: 'SCAN_FAILED',
        message: err.message || 'Could not communicate with the page. Please refresh the page and try again.'
      }
    };
  }
}

/**
 * Handles finding a matching interactive element on the page based on natural language query (Slice 3.3).
 * Scans the page, calls AI structured output, highlights the matched element, and returns result.
 *
 * @param {Object} payload
 * @param {string} payload.query
 * @param {string} [payload.language]
 * @param {number} [payload.tabId]
 * @returns {Promise<Object>}
 */
async function handleFindElement(payload = {}) {
  const query = (payload.query || '').trim();
  if (!query) {
    return {
      success: false,
      error: { code: 'EMPTY_QUERY', message: 'Please enter what you are looking for on the page.' }
    };
  }

  let tabId = payload.tabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
    }
    if (isRestrictedUrl(tab.url)) {
      return {
        success: false,
        error: { code: 'RESTRICTED_URL', message: 'Sahayak cannot interact with system or internal browser pages.' }
      };
    }
    tabId = tab.id;
  }

  // 1. Ensure scripts are injected
  await ensureContentScriptInjected(tabId);

  // 2. Scan elements on the page
  let scanRes;
  try {
    scanRes = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_ELEMENTS' });
  } catch (err) {
    console.error('[Sahayak] Scan error during find element:', err);
    return {
      success: false,
      error: { code: 'SCAN_FAILED', message: 'Could not scan the page. Please refresh the page and try again.' }
    };
  }

  if (!scanRes || !scanRes.success || !scanRes.data) {
    return {
      success: false,
      error: { code: 'SCAN_FAILED', message: scanRes?.error?.message || 'Could not scan page elements.' }
    };
  }

  const actionMap = scanRes.data;
  if (!actionMap.elements || actionMap.elements.length === 0) {
    return {
      success: true,
      data: {
        found: false,
        elementId: null,
        reasoning: 'No interactive elements were found on this page.'
      }
    };
  }

  // 3. Show badges so user has visual reference
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_BADGES' });
  } catch (e) {
    // Non-fatal if badge overlay encounters transient issue
  }

  // 4. Resolve output language
  let lang = payload.language;
  if (!lang) {
    const prefs = await chrome.storage.local.get('sahayak_preferences');
    lang = prefs.sahayak_preferences?.language || 'en';
  }

  // 5. Build prompt
  const { systemPrompt, userPrompt } = PromptBuilder.buildFindElementPrompt(query, actionMap, lang);

  // 6. Gemini structured output schema
  const responseSchema = {
    type: 'OBJECT',
    properties: {
      found: {
        type: 'BOOLEAN',
        description: 'True if an element on the page matches the user request, false if no matching element exists.'
      },
      elementId: {
        type: 'INTEGER',
        description: 'The numeric ID of the matching element from the provided elements list. If found is false, set to 0.'
      },
      reasoning: {
        type: 'STRING',
        description: 'Brief explanation of why this element was selected or why no match was found.'
      }
    },
    required: ['found', 'elementId', 'reasoning']
  };

  // 7. Query Model Gateway
  let aiResult;
  try {
    aiResult = await ModelGateway.queryAI({
      prompt: userPrompt,
      systemPrompt,
      task: 'text',
      temperature: 0.1,
      maxTokens: 512,
      responseMimeType: 'application/json',
      responseSchema
    });
  } catch (err) {
    console.error('[Sahayak] Model query failed in FIND_ELEMENT:', err);
    return {
      success: false,
      error: { code: err.code || 'AI_ERROR', message: err.message || 'AI request failed.' }
    };
  }

  // 8. Parse JSON response
  let parsed = null;
  const rawText = aiResult.text || '';
  const cleanJson = rawText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try {
    parsed = JSON.parse(cleanJson);
  } catch (e) {
    const match = cleanJson.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (e2) {}
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      success: false,
      error: { code: 'PARSE_ERROR', message: 'Could not parse element search result.' }
    };
  }

  // 9. If element matched, send HIGHLIGHT_ELEMENT and return result
  const matchedId = Number(parsed.elementId);
  const found = Boolean(parsed.found && matchedId > 0);

  if (found) {
    const matchedElement = actionMap.elements.find((el) => el.id === matchedId);
    if (matchedElement) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'HIGHLIGHT_ELEMENT', elementId: matchedId });
      } catch (hlErr) {
        console.warn('[Sahayak] Could not send HIGHLIGHT_ELEMENT:', hlErr);
      }

      return {
        success: true,
        data: {
          found: true,
          elementId: matchedId,
          element: matchedElement,
          reasoning: parsed.reasoning || `Matched element #${matchedId}.`,
          model: aiResult.model,
          provider: aiResult.provider
        }
      };
    }
  }

  // If not found or elementId wasn't in actionMap
  return {
    success: true,
    data: {
      found: false,
      elementId: null,
      reasoning: parsed.reasoning || 'Could not find a matching element on this page.',
      model: aiResult.model,
      provider: aiResult.provider
    }
  };
}

// ── Consequential Action Keywords (§12.5) ─────────────────────────────
const CONSEQUENTIAL_KEYWORDS = [
  /\bsubmit\b/i, /\bpay\b/i, /\bpurchase\b/i, /\bbuy\b/i,
  /\bplace.?order\b/i, /\bconfirm.?order\b/i,
  /\bdelete\b/i, /\bremove\b/i,
  /\bsend\b/i, /\btransfer\b/i,
  /\bcheckout\b/i, /\bproceed\b/i,
];

/**
 * Checks whether an action or target element is consequential.
 * @param {Object} element
 * @param {Object} action
 * @returns {boolean}
 */
function checkIsConsequential(element, action) {
  if (action && action.isConsequential) return true;
  if (!element) return false;
  const haystack = [element.text, element.name, element.value, element.placeholder].filter(Boolean).join(' ');
  return CONSEQUENTIAL_KEYWORDS.some((re) => re.test(haystack));
}

/**
 * Start a new agent execution loop task (Slice 3.4).
 */
async function handleAgentStart(payload = {}) {
  const goal = (payload.goal || '').trim();
  const maxSteps = Math.min(Math.max(Number(payload.maxSteps) || 10, 1), 25);
  const dryRun = Boolean(payload.dryRun);

  if (!goal) {
    return {
      success: false,
      error: { code: 'EMPTY_GOAL', message: 'Please enter a goal for the browser agent.' }
    };
  }

  let tabId = payload.tabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
    }
    if (isRestrictedUrl(tab.url)) {
      return {
        success: false,
        error: { code: 'RESTRICTED_URL', message: 'Sahayak cannot automate internal browser or system pages.' }
      };
    }
    tabId = tab.id;
  }

  // Reset any active state
  await AgentStateMachine.reset();

  await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.SCANNING, {
    goal,
    maxSteps,
    dryRun,
    stepCount: 1,
    tabId,
    history: [],
    currentAction: null,
    statusMessage: 'Starting task… scanning page.',
    startedAt: Date.now()
  });

  return await runAgentStep();
}

/**
 * Advances the agent loop for the current step.
 */
async function runAgentStep(skipNote = null) {
  const state = AgentStateMachine.getState();
  const tabId = state.tabId;
  const goal = state.goal;
  const stepCount = state.stepCount;
  const maxSteps = state.maxSteps;

  if (stepCount > maxSteps) {
    await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.COMPLETED, {
      statusMessage: `Reached maximum step limit (${maxSteps} steps). Task ended.`,
      currentAction: { action: 'done', reasoning: `Max step limit (${maxSteps}) reached.` }
    });
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_BADGES' });
    } catch (e) {}
    return { success: true, data: AgentStateMachine.getState() };
  }

  try {
    // 1. Scan page
    await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.SCANNING, {
      statusMessage: `Step ${stepCount}/${maxSteps}: Scanning page…`
    });
    await ensureContentScriptInjected(tabId);
    const scanRes = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_ELEMENTS' });
    if (!scanRes || !scanRes.success || !scanRes.data) {
      throw new Error(scanRes?.error?.message || 'Could not scan page elements.');
    }
    const actionMap = scanRes.data;

    // Show numbered badges
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'SHOW_BADGES' });
    } catch (bErr) {}

    // 2. Think / query model
    await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.THINKING, {
      statusMessage: `Step ${stepCount}/${maxSteps}: Analyzing next action…`
    });

    const prefs = await chrome.storage.local.get('sahayak_preferences');
    const lang = prefs.sahayak_preferences?.language || 'en';

    // Prepare history
    let previousActions = [...state.history];
    if (skipNote) {
      previousActions.push({
        step: stepCount,
        action: { action: 'skip', reasoning: skipNote },
        decision: 'skipped'
      });
    }

    const { systemPrompt, userPrompt } = PromptBuilder.buildAgentActionPrompt(
      goal,
      actionMap,
      previousActions,
      null, // userProfile injected in Slice 4.1
      lang
    );

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['click', 'type', 'select', 'scroll', 'done']
        },
        targetElementId: { type: 'INTEGER' },
        value: { type: 'STRING' },
        reasoning: { type: 'STRING' },
        isConsequential: { type: 'BOOLEAN' }
      },
      required: ['action', 'reasoning', 'isConsequential']
    };

    const aiRes = await ModelGateway.queryAI({
      prompt: userPrompt,
      systemPrompt,
      task: 'text',
      temperature: 0.1,
      maxTokens: 512,
      responseMimeType: 'application/json',
      responseSchema
    });

    // Parse JSON
    let parsed = null;
    const cleanJson = (aiRes.text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    try {
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      const match = cleanJson.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch (e2) {}
      }
    }

    if (!parsed || !parsed.action) {
      throw new Error('AI model proposed an unreadable action structure.');
    }

    // 3. Safety Check
    await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.SAFETY_CHECK, {
      statusMessage: `Step ${stepCount}/${maxSteps}: Checking safety rails…`
    });

    const targetEl = parsed.targetElementId ? actionMap.elements.find((e) => e.id === parsed.targetElementId) : null;
    const isConsequential = checkIsConsequential(targetEl, parsed);
    parsed.isConsequential = isConsequential;

    // Highlight proposed element
    if (parsed.targetElementId) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'HIGHLIGHT_ELEMENT', elementId: parsed.targetElementId });
      } catch (hlErr) {}
    }

    // 4. Awaiting Approval
    const nextState = await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.AWAITING_APPROVAL, {
      currentAction: parsed,
      statusMessage: `Step ${stepCount}/${maxSteps}: Awaiting your approval.`
    });

    return { success: true, data: nextState };

  } catch (err) {
    console.error('[Sahayak] Agent step error:', err);
    await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.CLEANUP, {
      error: err.message,
      statusMessage: `Agent stopped due to error: ${err.message}`
    });
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_BADGES' });
    } catch (e) {}
    return { success: false, error: { code: 'AGENT_ERROR', message: err.message } };
  }
}

/**
 * Handle user approval of the proposed action.
 */
async function handleAgentApprove(payload = {}) {
  const state = AgentStateMachine.getState();
  if (state.state !== AgentStateMachine.AgentState.AWAITING_APPROVAL) {
    return { success: false, error: { code: 'INVALID_STATE', message: 'No action currently awaiting approval.' } };
  }

  const action = state.currentAction;
  const stepIndex = state.stepCount;

  // Record approval in history
  const history = [
    ...state.history,
    {
      step: stepIndex,
      action,
      decision: 'approved',
      timestamp: Date.now()
    }
  ];

  // If action is done, finish task
  if (action?.action === 'done') {
    await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.COMPLETED, {
      history,
      statusMessage: '✓ Goal completed successfully!',
      currentAction: action
    });
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: 'CLEAR_BADGES' });
    } catch (e) {}
    return { success: true, data: AgentStateMachine.getState() };
  }

  // Transition to EXECUTING
  await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.EXECUTING, {
    history,
    stepCount: stepIndex + 1,
    statusMessage: `Step ${stepIndex}: Action approved. Preparing next step…`
  });

  // Note for Slice 3.4: Synthetic executor is implemented in Slice 3.5.
  // In Slice 3.4, approval records the action and advances the loop to the next step.
  return await runAgentStep();
}

/**
 * Handle user skipping the proposed action.
 */
async function handleAgentSkip(payload = {}) {
  const state = AgentStateMachine.getState();
  if (state.state !== AgentStateMachine.AgentState.AWAITING_APPROVAL) {
    return { success: false, error: { code: 'INVALID_STATE', message: 'No action currently awaiting approval.' } };
  }

  const action = state.currentAction;
  const stepIndex = state.stepCount;

  // Record skip in history
  const history = [
    ...state.history,
    {
      step: stepIndex,
      action,
      decision: 'skipped',
      timestamp: Date.now()
    }
  ];

  await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.THINKING, {
    history,
    stepCount: stepIndex + 1,
    statusMessage: `Step ${stepIndex} skipped. Re-querying AI for an alternate action…`
  });

  return await runAgentStep(`User skipped element #${action?.targetElementId || ''} (${action?.action}). Propose a different action.`);
}

/**
 * Handle user emergency stop (kill switch §12.6).
 */
async function handleAgentStop() {
  const state = AgentStateMachine.getState();
  const tabId = state.tabId;

  await AgentStateMachine.transitionTo(AgentStateMachine.AgentState.CLEANUP, {
    statusMessage: 'Task stopped by user.',
    currentAction: null
  });

  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_BADGES' });
    } catch (e) {}
  }

  await AgentStateMachine.reset();
  return { success: true, data: AgentStateMachine.getState() };
}

/**
 * Handle article extraction only (without running AI summary).
 */
async function handleExtractArticle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
  }

  if (isRestrictedUrl(tab.url)) {
    return {
      success: false,
      error: { code: 'RESTRICTED_URL', message: 'Sahayak cannot read system or internal browser pages.' }
    };
  }

  try {
    await ensureContentScriptInjected(tab.id);
    return await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
  } catch (err) {
    console.error('[Sahayak] Extraction communication error:', err);
    return {
      success: false,
      error: {
        code: 'EXTRACTION_FAILED',
        message: 'Could not communicate with the page. Please refresh the page and try again.'
      }
    };
  }
}

/**
 * Handle full page summarisation: extract -> prompt -> AI -> structured summary.
 */
async function handleSummarizePage(payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
  }

  if (isRestrictedUrl(tab.url)) {
    return {
      success: false,
      error: {
        code: 'RESTRICTED_URL',
        message: 'Sahayak cannot read system or internal browser pages (such as chrome://, settings, or Web Store).'
      }
    };
  }

  const initialUrl = tab.url;
  const tabId = tab.id;

  // 1. Ensure content script is active & extract article
  try {
    await ensureContentScriptInjected(tabId);
  } catch (err) {
    // Edge case 1.1.5: Local file access permission
    if (initialUrl && initialUrl.startsWith('file://')) {
      return {
        success: false,
        error: {
          code: 'FILE_ACCESS_DENIED',
          message: 'Cannot access local file. Please enable "Allow access to file URLs" for Sahayak in chrome://extensions.'
        }
      };
    }

    return {
      success: false,
      error: {
        code: 'INJECTION_FAILED',
        message: 'Could not access the page content. Please refresh the tab and try again.'
      }
    };
  }

  let extractRes;
  try {
    extractRes = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_ARTICLE' });
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'COMMUNICATION_ERROR',
        message: 'Lost connection to the page. Please refresh and try again.'
      }
    };
  }

  if (!extractRes || !extractRes.success) {
    return {
      success: false,
      error: {
        code: extractRes?.code || 'EXTRACTION_FAILED',
        message: extractRes?.error || "This page doesn't appear to contain an article or readable text."
      }
    };
  }

  const article = extractRes.data;

  // 2. Language preference
  let language = payload.language;
  if (!language) {
    const prefs = await chrome.storage.local.get('sahayak_preferences');
    language = prefs.sahayak_preferences?.language || 'en';
  }

  // 3. Build structured prompt
  const { systemPrompt, userPrompt } = PromptBuilder.buildSummaryPrompt(article, language);

  // 4. Query AI model
  const aiResult = await ModelGateway.queryAI({
    prompt: userPrompt,
    systemPrompt,
    task: 'text',
    temperature: 0.3,
    maxTokens: 2048
  });

  // 5. Edge case 1.3.7: check if user navigated away or closed the tab mid-summarisation
  try {
    const tabCheck = await chrome.tabs.get(tabId);
    if (!tabCheck || tabCheck.url !== initialUrl) {
      return {
        success: false,
        error: {
          code: 'TAB_NAVIGATED',
          message: 'You navigated away from the original page while the summary was being prepared.'
        }
      };
    }
  } catch (tabErr) {
    return {
      success: false,
      error: {
        code: 'TAB_CLOSED',
        message: 'The page tab was closed while the summary was being prepared.'
      }
    };
  }

  return {
    success: true,
    data: {
      summary: aiResult.text,
      model: aiResult.model,
      provider: aiResult.provider,
      isFallback: aiResult.isFallback,
      article: {
        title: article.title,
        byline: article.byline,
        siteName: article.siteName,
        wordCount: article.wordCount,
        isTruncated: article.isTruncated,
        paywallWarning: article.paywallWarning,
        url: article.url
      }
    }
  };
}

/**
 * Handle YouTube summarisation: captions -> prompt -> AI -> chapter notes.
 * Falls back to direct video analysis if no captions are available.
 */
async function handleSummarizeYouTube(payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
  }

  const initialUrl = tab.url;
  const tabId = tab.id;

  if (!isYouTubeUrl(initialUrl)) {
    return {
      success: false,
      error: { code: 'NOT_YOUTUBE', message: 'The current active tab is not a supported YouTube video.' }
    };
  }

  // Edge case 1.4.3: Livestreams
  if (initialUrl.includes('/live/') || initialUrl.includes('feature=live')) {
    return {
      success: false,
      error: { code: 'LIVESTREAM_NOT_SUPPORTED', message: 'Live streams cannot be summarised.' }
    };
  }

  // 1. Ensure content script is active in the YouTube tab
  try {
    await ensureContentScriptInjected(tabId);
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'INJECTION_FAILED',
        message: 'Could not connect to the YouTube page. Please refresh the tab and try again.'
      }
    };
  }

  // 2. Extract captions and metadata from content script
  let captionsRes;
  try {
    captionsRes = await chrome.tabs.sendMessage(tabId, { type: 'GET_YOUTUBE_CAPTIONS' });
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'COMMUNICATION_ERROR',
        message: 'Could not communicate with the YouTube page. Please refresh and try again.'
      }
    };
  }

  if (captionsRes && !captionsRes.success) {
    if (captionsRes.isLive) {
      return {
        success: false,
        error: { code: 'LIVESTREAM_NOT_SUPPORTED', message: 'Live streams cannot be summarised.' }
      };
    }
    if (captionsRes.isRestricted) {
      return {
        success: false,
        error: {
          code: 'RESTRICTED_VIDEO',
          message: captionsRes.error || 'This video is private, restricted, or requires login. Sahayak can only summarise public YouTube videos.'
        }
      };
    }
  }

  const videoData = captionsRes?.data || {};
  const hasCaptions = Boolean(captionsRes?.success && videoData.hasCaptions && videoData.captionsText);

  // 3. Language preference
  let language = payload.language;
  if (!language) {
    const prefs = await chrome.storage.local.get('sahayak_preferences');
    language = prefs.sahayak_preferences?.language || 'en';
  }

  let aiResult;

  if (hasCaptions) {
    // Primary path: Summarise extracted timestamped captions
    const { systemPrompt, userPrompt } = PromptBuilder.buildYouTubePrompt({
      videoId: videoData.videoId || extractVideoId(initialUrl),
      title: videoData.title || tab.title,
      author: videoData.author,
      url: initialUrl,
      captionsText: videoData.captionsText,
      hasCaptions: true,
      isAutoGenerated: videoData.isAutoGenerated,
      isTruncated: videoData.isTruncated
    }, language);

    aiResult = await ModelGateway.queryAI({
      prompt: userPrompt,
      systemPrompt,
      task: 'text',
      temperature: 0.3,
      maxTokens: 2048
    });
  } else {
    // Fallback path (Edge case 1.4.1): No captions available — pass URL directly to Gemini
    const videoId = extractVideoId(initialUrl);
    const { systemPrompt, userPrompt } = PromptBuilder.buildYouTubePrompt({
      videoId,
      title: tab.title,
      url: initialUrl,
      hasCaptions: false
    }, language);

    try {
      aiResult = await ModelGateway.queryAI({
        prompt: userPrompt,
        systemPrompt,
        task: 'vision',
        temperature: 0.3,
        maxTokens: 2048,
        videoUrl: initialUrl
      });
    } catch (fallbackErr) {
      return {
        success: false,
        error: {
          code: 'NO_CAPTIONS_OR_AI_FAILED',
          message: "This video doesn't have captions and couldn't be processed."
        }
      };
    }
  }

  // Edge case 1.3.7: check if user navigated away or closed the tab mid-summarisation
  try {
    const tabCheck = await chrome.tabs.get(tabId);
    if (!tabCheck || tabCheck.url !== initialUrl) {
      return {
        success: false,
        error: {
          code: 'TAB_NAVIGATED',
          message: 'You navigated away from the YouTube video while the summary was being prepared.'
        }
      };
    }
  } catch (tabErr) {
    return {
      success: false,
      error: {
        code: 'TAB_CLOSED',
        message: 'The YouTube tab was closed while the summary was being prepared.'
      }
    };
  }

  return {
    success: true,
    data: {
      summary: aiResult.text,
      model: aiResult.model,
      provider: aiResult.provider,
      isFallback: aiResult.isFallback,
      video: {
        videoId: videoData.videoId || extractVideoId(initialUrl),
        title: videoData.title || tab.title,
        author: videoData.author,
        url: initialUrl,
        hasCaptions,
        isAutoGenerated: videoData.isAutoGenerated,
        isTruncated: videoData.isTruncated,
        usedDirectUrl: !hasCaptions
      }
    }
  };
}

/**
 * Handle seeking YouTube video player to specific seconds timestamp.
 */
async function handleSeekVideo(payload = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { success: false, error: { code: 'NO_TAB', message: 'No active browser tab found.' } };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'SEEK_VIDEO',
      payload: { seconds: payload.seconds }
    });
  } catch (err) {
    return {
      success: false,
      error: { code: 'SEEK_FAILED', message: 'Could not find the video player on this page.' }
    };
  }
}

/**
 * Detect whether a URL belongs to YouTube.
 */
function isYouTubeUrl(url) {
  if (!url) return false;
  return /(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/i.test(url);
}

/**
 * Extract YouTube 11-character video ID from URL.
 */
function extractVideoId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
      const id = parsed.pathname.slice(1).split('/')[0];
      return id && id.length > 0 ? id : null;
    }

    if (hostname.includes('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;

      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        const prefix = pathParts[0];
        if (['shorts', 'embed', 'live', 'v'].includes(prefix)) {
          return pathParts[1];
        }
      }
    }
  } catch (e) {
    const match = url.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Handle streaming grounded chat query over long-lived port.
 * Architecture §8 & Slice 2.1.
 */
async function handleChatStreamQuery(msg, port, signal) {
  const { question, history = [], language, tabId: requestedTabId } = msg;

  if (!question || !question.trim()) {
    port.postMessage({
      type: 'STREAM_ERROR',
      error: { code: 'EMPTY_QUESTION', message: 'Please enter a question to ask.' }
    });
    return;
  }

  // 1. Resolve active tab
  let tab;
  if (requestedTabId) {
    try {
      tab = await chrome.tabs.get(requestedTabId);
    } catch (e) {}
  }
  if (!tab) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  }

  if (!tab || !tab.id) {
    port.postMessage({
      type: 'STREAM_ERROR',
      error: { code: 'NO_TAB', message: 'No active browser tab found to chat with.' }
    });
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    port.postMessage({
      type: 'STREAM_ERROR',
      error: { code: 'RESTRICTED_URL', message: 'Cannot chat with internal browser or system pages.' }
    });
    return;
  }

  // 2. Extract page content
  let pageContext = {
    title: tab.title || 'Web Page',
    url: tab.url,
    content: ''
  };

  try {
    await ensureContentScriptInjected(tab.id);

    if (isYouTubeUrl(tab.url)) {
      // YouTube page chat — extract transcript if available
      try {
        const captionsRes = await chrome.tabs.sendMessage(tab.id, { type: 'GET_YOUTUBE_CAPTIONS' });
        if (captionsRes?.success && captionsRes.data?.captionsText) {
          pageContext.content = captionsRes.data.captionsText;
          pageContext.title = captionsRes.data.title || tab.title;
        } else {
          pageContext.content = `YouTube video title: ${tab.title}. URL: ${tab.url}`;
        }
      } catch (ytErr) {
        pageContext.content = `YouTube video: ${tab.title}`;
      }
    } else {
      // Standard article extraction
      const extractRes = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
      if (extractRes?.success && extractRes.data?.content) {
        pageContext.content = extractRes.data.content;
        pageContext.title = extractRes.data.title || tab.title;
      } else {
        pageContext.content = tab.title || '';
      }
    }
  } catch (extractErr) {
    console.warn('[Sahayak] Chat content extraction warning:', extractErr.message);
    pageContext.content = tab.title || '';
  }

  // Edge case 2.1.2: page has very little text (< 50 words)
  const wordCount = pageContext.content.split(/\s+/).filter(Boolean).length;
  const isLowContent = wordCount < 50;

  // 3. Language preference
  let lang = language;
  if (!lang) {
    const prefs = await chrome.storage.local.get('sahayak_preferences');
    lang = prefs.sahayak_preferences?.language || 'en';
  }

  // 4. Build grounded chat prompt
  const { systemPrompt, userPrompt } = PromptBuilder.buildGroundedChatPrompt(
    pageContext,
    question,
    history,
    lang
  );

  // 5. Stream from Model Gateway
  const aiResult = await ModelGateway.streamAI({
    prompt: userPrompt,
    systemPrompt,
    task: 'text',
    temperature: 0.2, // Low temperature for strict factual grounding
    maxTokens: 2048,
    signal,
    onChunk: (chunk) => {
      try {
        port.postMessage({ type: 'STREAM_CHUNK', chunk });
      } catch (err) {
        // Port closed
      }
    }
  });

  // 6. Complete stream
  try {
    port.postMessage({
      type: 'STREAM_DONE',
      fullText: aiResult.text,
      model: aiResult.model,
      provider: aiResult.provider,
      isFallback: aiResult.isFallback,
      lowContent: isLowContent
    });
  } catch (err) {
    // Port closed
  }
}

/**
 * Handle non-streaming chat query (fallback).
 */
async function handleChatQuery(payload = {}) {
  const { question, history = [], language } = payload;
  if (!question || !question.trim()) {
    return { success: false, error: { code: 'EMPTY_QUESTION', message: 'Please enter a question to ask.' } };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { success: false, error: { code: 'NO_TAB', message: 'No active tab found.' } };
  }
  if (isRestrictedUrl(tab.url)) {
    return { success: false, error: { code: 'RESTRICTED_URL', message: 'Cannot chat with internal browser or system pages.' } };
  }

  let pageContext = { title: tab.title, url: tab.url, content: '' };
  try {
    await ensureContentScriptInjected(tab.id);
    const extractRes = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' });
    if (extractRes?.success && extractRes.data?.content) {
      pageContext.content = extractRes.data.content;
      pageContext.title = extractRes.data.title || tab.title;
    }
  } catch (err) {}

  let lang = language;
  if (!lang) {
    const prefs = await chrome.storage.local.get('sahayak_preferences');
    lang = prefs.sahayak_preferences?.language || 'en';
  }

  const { systemPrompt, userPrompt } = PromptBuilder.buildGroundedChatPrompt(pageContext, question, history, lang);
  const aiResult = await ModelGateway.queryAI({
    prompt: userPrompt,
    systemPrompt,
    task: 'text',
    temperature: 0.2,
    maxTokens: 2048
  });

  return {
    success: true,
    data: {
      text: aiResult.text,
      model: aiResult.model,
      provider: aiResult.provider,
      lowContent: (pageContext.content.split(/\s+/).filter(Boolean).length < 50)
    }
  };
}

/**
 * Check if a URL is a browser-internal, web store, or restricted URL.
 */
function isRestrictedUrl(url) {
  if (!url) return true;
  const restricted = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'devtools://',
    'chrome-search://',
    'chrome-untrusted://',
    'view-source:',
    'https://chrome.google.com/webstore',
    'https://chromewebstore.google.com',
  ];
  return restricted.some((prefix) => url.startsWith(prefix));
}
