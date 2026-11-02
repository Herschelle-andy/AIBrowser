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
  '/services/ai/modelGateway.js',
  '/services/ai/promptBuilder.js'
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

      return { success: true, data: { text: result.text, model: result.model } };
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
    if (ping && ping.alive) return true;
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
