/**
 * Sahayak — ChatView Component (Slice 2.1)
 *
 * Implements Grounded Page Chat:
 *  - Real-time response streaming via chrome.runtime.connect port
 *  - Strict anti-hallucination grounding in current page content
 *  - Session history storage via chrome.storage.session
 *  - Dynamic page change & low-content detection
 *
 * Edge cases covered:
 *  2.1.1 — Strictly grounded anti-hallucination refusal
 *  2.1.2 — Low-content detection (< 50 words) with Screenshot suggestion
 *  2.1.3 — History capped to preserve token limits
 *  2.1.4 — Input length check (500 words limit warning)
 *  2.1.5 — Graceful handling of port disconnects & streaming cancellation
 *  2.1.6 — Resilient SSE chunk buffering
 *  2.1.7 — Navigation detection to reset/prompt new conversation
 *  2.1.9 — Tab switch detection
 */

const ChatView = (() => {
  let _container = null;
  let _port = null;
  let _messages = [];
  let _isStreaming = false;
  let _currentTabId = null;
  let _currentPageUrl = '';
  let _currentPageTitle = '';
  let _currentStreamingText = '';
  let _activeStreamingBubble = null;

  const MAX_INPUT_WORDS = 500;
  const STORAGE_KEY = 'sahayak_chat_history';

  /**
   * Render the Chat View into the container.
   * @param {HTMLElement} container
   */
  async function render(container) {
    _container = container;

    container.innerHTML = `
      <div class="chat-view-root">
        <!-- Chat Header -->
        <div class="chat-header">
          <div class="chat-header-info">
            <span class="chat-header-title" id="chat-header-page-title">Detecting page…</span>
            <span class="chat-header-domain" id="chat-header-page-domain"></span>
          </div>
          <div class="chat-header-actions">
            <button id="btn-clear-chat" class="btn btn-secondary btn-sm" title="Clear conversation history">
              🗑️ Clear
            </button>
          </div>
        </div>

        <!-- Low Content Notice Banner (Edge case 2.1.2) -->
        <div id="chat-low-content-banner" class="chat-banner chat-banner-warning" style="display: none;">
          <span>⚠️ This page has very little text (< 50 words). Answers may be limited; try <strong>Vision / Screenshot</strong> tab for visual content.</span>
        </div>

        <!-- Page Navigated Notice (Edge case 2.1.7) -->
        <div id="chat-navigated-banner" class="chat-banner chat-banner-info" style="display: none;">
          <span>ℹ️ You've navigated to a new page.</span>
          <button id="btn-new-chat-banner" class="banner-link">Start New Chat</button>
        </div>

        <!-- Messages Area -->
        <div id="chat-messages-scroll" class="chat-messages-container">
          <!-- Empty State / Suggestions (shown when no messages) -->
          <div id="chat-empty-state" class="chat-empty-state">
            <div class="empty-icon">💬</div>
            <h3>Ask anything about this page</h3>
            <p>Answers are grounded strictly in the current page content.</p>
            <div class="chat-suggestion-chips">
              <button class="suggestion-chip" data-prompt="What is this page about?">📄 What is this page about?</button>
              <button class="suggestion-chip" data-prompt="Summarise the key takeaways of this page.">📌 Key takeaways</button>
              <button class="suggestion-chip" data-prompt="Who is the author or publisher of this content?">👤 Who is the author?</button>
            </div>
          </div>

          <div id="chat-messages-list" class="chat-messages-list"></div>
        </div>

        <!-- Input Bar Area -->
        <div class="chat-input-wrapper">
          <div id="chat-word-limit-warning" class="chat-word-warning" style="display: none;">
            ⚠️ Questions longer than 500 words will be trimmed to fit context.
          </div>
          <div class="chat-input-row">
            <textarea
              id="chat-input-textarea"
              class="chat-textarea"
              placeholder="Ask a question about this page..."
              rows="1"
              maxlength="8000"
            ></textarea>
            <button id="btn-chat-send" class="btn btn-primary chat-send-btn" title="Send message (Enter)">
              ➤
            </button>
            <button id="btn-chat-stop" class="btn btn-secondary chat-stop-btn" title="Stop generating" style="display: none;">
              ⏹
            </button>
          </div>
          <div class="chat-input-footer">
            <span id="chat-input-counter" class="chat-counter">0 words</span>
            <span class="chat-hint">Shift+Enter for newline</span>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    await updateActivePageInfo();
    await loadSessionHistory();
  }

  /**
   * Bind event handlers.
   */
  function bindEvents() {
    const textarea = _container.querySelector('#chat-input-textarea');
    const btnSend = _container.querySelector('#btn-chat-send');
    const btnStop = _container.querySelector('#btn-chat-stop');
    const btnClear = _container.querySelector('#btn-clear-chat');
    const btnNewChat = _container.querySelector('#btn-new-chat-banner');
    const emptyState = _container.querySelector('#chat-empty-state');

    // Textarea input sizing and word counting (Edge case 2.1.4)
    textarea.addEventListener('input', () => {
      autoResizeTextarea(textarea);
      updateWordCount(textarea.value);
    });

    // Enter to submit, Shift+Enter for newline
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitQuery();
      }
    });

    btnSend.addEventListener('click', () => submitQuery());
    btnStop.addEventListener('click', () => stopStreaming());

    btnClear.addEventListener('click', () => clearConversation(true));
    btnNewChat.addEventListener('click', () => {
      clearConversation(false);
      _container.querySelector('#chat-navigated-banner').style.display = 'none';
      updateActivePageInfo();
    });

    // Suggestion chips
    emptyState.addEventListener('click', (e) => {
      const chip = e.target.closest('.suggestion-chip');
      if (!chip) return;
      const prompt = chip.dataset.prompt;
      if (prompt) {
        textarea.value = prompt;
        autoResizeTextarea(textarea);
        updateWordCount(prompt);
        submitQuery();
      }
    });
  }

  /**
   * Auto-grow textarea up to 4 rows.
   */
  function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = `${newHeight}px`;
  }

  /**
   * Word counter and 500-word limit check.
   */
  function updateWordCount(text) {
    const counter = _container.querySelector('#chat-input-counter');
    const warning = _container.querySelector('#chat-word-limit-warning');
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    const count = words.length;

    counter.textContent = `${count} word${count === 1 ? '' : 's'}`;
    if (count > MAX_INPUT_WORDS) {
      warning.style.display = 'block';
      counter.classList.add('counter-limit');
    } else {
      warning.style.display = 'none';
      counter.classList.remove('counter-limit');
    }
  }

  /**
   * Get or initialize a long-lived streaming port.
   */
  function getStreamPort() {
    if (_port) return _port;

    try {
      _port = chrome.runtime.connect({ name: 'chat-stream' });

      _port.onMessage.addListener((msg) => {
        handlePortMessage(msg);
      });

      _port.onDisconnect.addListener(() => {
        console.log('[ChatView] Stream port disconnected.');
        _port = null;
        if (_isStreaming) {
          if (_currentStreamingText && _currentStreamingText.trim()) {
            completeStreaming(_currentStreamingText, 'Gemini');
          } else {
            handleStreamingError('Connection to assistant was interrupted. Please try asking again.');
          }
        }
      });
    } catch (err) {
      console.warn('[ChatView] Failed to connect port:', err);
      _port = null;
    }

    return _port;
  }

  /**
   * Process chunks and status from background service worker stream.
   */
  function handlePortMessage(msg) {
    if (!msg) return;

    switch (msg.type) {
      case 'STREAM_CHUNK': {
        if (!_isStreaming) return;
        const chunk = msg.chunk || '';
        _currentStreamingText += chunk;
        updateStreamingBubble(_currentStreamingText);
        scrollToBottom();
        break;
      }

      case 'STREAM_DONE': {
        const fullText = msg.fullText || _currentStreamingText;
        const model = msg.model || 'Gemini';
        completeStreaming(fullText, model, msg.lowContent, msg.isFallback);
        break;
      }

      case 'STREAM_ERROR': {
        const errorMsg = msg.error?.message || 'Failed to complete response.';
        handleStreamingError(errorMsg);
        break;
      }
    }
  }

  /**
   * Submit the user's question and initiate grounded stream.
   */
  async function submitQuery() {
    const textarea = _container.querySelector('#chat-input-textarea');
    const text = (textarea.value || '').trim();
    if (!text || _isStreaming) return;

    // Clear textarea
    textarea.value = '';
    autoResizeTextarea(textarea);
    updateWordCount('');

    // Ensure empty state is hidden
    _container.querySelector('#chat-empty-state').style.display = 'none';

    // Append user message
    const userMsg = { role: 'user', text, timestamp: Date.now() };
    _messages.push(userMsg);
    renderMessage(userMsg);
    scrollToBottom();

    // Prepare assistant streaming placeholder
    _isStreaming = true;
    _currentStreamingText = '';
    toggleInputState(true);

    _activeStreamingBubble = createStreamingBubble();
    scrollToBottom();

    // Prepare history payload (last 8 turns, Edge case 2.1.3)
    const historyPayload = _messages.slice(0, -1).slice(-8).map(m => ({
      role: m.role,
      text: m.text
    }));

    const currentLanguage = window.SahayakApp ? window.SahayakApp.getCurrentLanguage() : 'en';

    // Send through streaming port
    const port = getStreamPort();
    if (!port) {
      handleStreamingError('Could not establish connection to background service.');
      return;
    }

    try {
      port.postMessage({
        type: 'CHAT_QUERY',
        question: text,
        history: historyPayload,
        language: currentLanguage,
        tabId: _currentTabId
      });
    } catch (sendErr) {
      handleStreamingError('Connection lost while sending question. Please retry.');
    }
  }

  /**
   * Create an empty assistant message bubble with animated cursor for streaming.
   */
  function createStreamingBubble() {
    const list = _container.querySelector('#chat-messages-list');
    const bubble = document.createElement('div');
    bubble.className = 'chat-message chat-message-assistant streaming';
    bubble.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-body">
        <div class="message-text"><span class="typing-cursor">▋</span></div>
      </div>
    `;
    list.appendChild(bubble);
    return bubble;
  }

  /**
   * Update active streaming bubble text in real time.
   */
  function updateStreamingBubble(text) {
    if (!_activeStreamingBubble) return;
    const textEl = _activeStreamingBubble.querySelector('.message-text');
    if (textEl) {
      textEl.innerHTML = formatChatMarkdown(text) + '<span class="typing-cursor">▋</span>';
    }
  }

  /**
   * Complete stream and persist.
   */
  function completeStreaming(fullText, model, lowContent, isFallback = false) {
    if (!_isStreaming) return;

    if (_activeStreamingBubble) {
      _activeStreamingBubble.classList.remove('streaming');
      const textEl = _activeStreamingBubble.querySelector('.message-text');
      if (textEl) {
        textEl.innerHTML = formatChatMarkdown(fullText);
      }
      const bodyEl = _activeStreamingBubble.querySelector('.message-body');
      if (bodyEl && !bodyEl.querySelector('.model-badge')) {
        const badge = document.createElement('div');
        badge.className = 'model-badge';
        const backupBadge = isFallback ? ' · 🔄 Backup model' : '';
        badge.textContent = `⚡ ${model}${backupBadge}`;
        bodyEl.appendChild(badge);
      }
    }

    const assistantMsg = {
      role: 'assistant',
      text: fullText,
      timestamp: Date.now(),
      model
    };
    _messages.push(assistantMsg);

    // Save history to session storage
    saveSessionHistory();

    // Show low content alert if flagged
    if (lowContent) {
      const banner = _container.querySelector('#chat-low-content-banner');
      if (banner) banner.style.display = 'flex';
    }

    finalizeStreamingBubble();
  }

  /**
   * Handle error during stream.
   */
  function handleStreamingError(errorMsg) {
    if (_activeStreamingBubble) {
      _activeStreamingBubble.classList.remove('streaming');
      _activeStreamingBubble.classList.add('error');
      const textEl = _activeStreamingBubble.querySelector('.message-text');
      if (textEl) {
        textEl.innerHTML = `⚠️ <span class="error-text">${escapeHtml(errorMsg)}</span>`;
      }
    }
    finalizeStreamingBubble();
  }

  /**
   * Stop active streaming request.
   */
  function stopStreaming() {
    if (!_isStreaming) return;
    if (_port) {
      try {
        _port.disconnect();
      } catch (e) {}
      _port = null;
    }
    completeStreaming(_currentStreamingText || 'Response stopped.', 'Gemini (aborted)');
  }

  function finalizeStreamingBubble() {
    if (_activeStreamingBubble) {
      _activeStreamingBubble.classList.remove('streaming');
      const cursor = _activeStreamingBubble.querySelector('.typing-cursor');
      if (cursor) cursor.remove();
    }
    _isStreaming = false;
    _activeStreamingBubble = null;
    _currentStreamingText = '';
    toggleInputState(false);
  }

  function toggleInputState(isBusy) {
    const btnSend = _container.querySelector('#btn-chat-send');
    const btnStop = _container.querySelector('#btn-chat-stop');
    const textarea = _container.querySelector('#chat-input-textarea');

    if (isBusy) {
      btnSend.style.display = 'none';
      btnStop.style.display = 'inline-flex';
      textarea.disabled = true;
    } else {
      btnSend.style.display = 'inline-flex';
      btnStop.style.display = 'none';
      textarea.disabled = false;
      textarea.focus();
    }
  }

  /**
   * Render a single historical or user message into the list.
   */
  function renderMessage(msg) {
    const list = _container.querySelector('#chat-messages-list');
    const bubble = document.createElement('div');
    bubble.className = `chat-message chat-message-${msg.role}`;

    if (msg.role === 'user') {
      bubble.innerHTML = `
        <div class="message-body">
          <div class="message-text">${formatChatMarkdown(msg.text)}</div>
        </div>
      `;
    } else {
      bubble.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-body">
          <div class="message-text">${formatChatMarkdown(msg.text)}</div>
          ${msg.model ? `<div class="model-badge">⚡ ${msg.model}</div>` : ''}
        </div>
      `;
    }

    list.appendChild(bubble);
  }

  /**
   * Format markdown formatting safely for chat bubbles.
   */
  function formatChatMarkdown(rawText) {
    if (!rawText) return '';
    const safe = escapeHtml(rawText);

    return safe
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function scrollToBottom() {
    const scrollEl = _container.querySelector('#chat-messages-scroll');
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  /**
   * Update active page title & domain in chat header.
   */
  async function updateActivePageInfo() {
    if (!_container) return;

    const titleEl = _container.querySelector('#chat-header-page-title');
    const domainEl = _container.querySelector('#chat-header-page-domain');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' });
      if (response?.success && response.data) {
        const tab = response.data;
        _currentTabId = tab.tabId;
        _currentPageUrl = tab.url || '';
        _currentPageTitle = tab.title || 'Untitled Tab';

        titleEl.textContent = _currentPageTitle;
        try {
          const u = new URL(_currentPageUrl);
          domainEl.textContent = u.hostname.replace(/^www\./, '');
        } catch (e) {
          domainEl.textContent = '';
        }
      }
    } catch (err) {
      titleEl.textContent = 'Active page';
      domainEl.textContent = '';
    }
  }

  /**
   * Save messages to chrome.storage.session.
   */
  async function saveSessionHistory() {
    try {
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.set({
          [STORAGE_KEY]: {
            messages: _messages,
            pageUrl: _currentPageUrl,
            pageTitle: _currentPageTitle,
            savedAt: Date.now()
          }
        });
      }
    } catch (err) {
      console.warn('[ChatView] Session storage write failed:', err);
    }
  }

  /**
   * Load messages from chrome.storage.session.
   */
  async function loadSessionHistory() {
    try {
      if (chrome.storage && chrome.storage.session) {
        const stored = await chrome.storage.session.get(STORAGE_KEY);
        const data = stored[STORAGE_KEY];

        if (data && Array.isArray(data.messages) && data.messages.length > 0) {
          // Check if session history matches current tab URL (Edge case 2.1.7)
          if (data.pageUrl && _currentPageUrl && data.pageUrl !== _currentPageUrl) {
            // Show prompt to start new conversation
            const banner = _container.querySelector('#chat-navigated-banner');
            if (banner) banner.style.display = 'flex';
          }

          _messages = data.messages;
          const list = _container.querySelector('#chat-messages-list');
          list.innerHTML = '';
          _messages.forEach(renderMessage);
          _container.querySelector('#chat-empty-state').style.display = 'none';
          scrollToBottom();
          return;
        }
      }
    } catch (err) {
      console.warn('[ChatView] Session storage read failed:', err);
    }

    _container.querySelector('#chat-empty-state').style.display = 'flex';
  }

  /**
   * Clear chat conversation history.
   */
  async function clearConversation(showToast = true) {
    if (_isStreaming) stopStreaming();

    _messages = [];
    const list = _container.querySelector('#chat-messages-list');
    if (list) list.innerHTML = '';

    const emptyState = _container.querySelector('#chat-empty-state');
    if (emptyState) emptyState.style.display = 'flex';

    const lowContentBanner = _container.querySelector('#chat-low-content-banner');
    if (lowContentBanner) lowContentBanner.style.display = 'none';

    try {
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.remove(STORAGE_KEY);
      }
    } catch (e) {}

    console.log('[ChatView] Chat history cleared.');
  }

  /**
   * Called when active tab navigates or changes URL (Edge cases 2.1.7 & 2.1.9).
   */
  async function onTabChanged(tabId, changeInfo) {
    if (!_container) return;

    if (changeInfo?.url && changeInfo.url !== _currentPageUrl) {
      await updateActivePageInfo();
      if (_messages.length > 0) {
        const banner = _container.querySelector('#chat-navigated-banner');
        if (banner) banner.style.display = 'flex';
      }
    }
  }

  return {
    render,
    clearConversation,
    onTabChanged,
    updateActivePageInfo
  };
})();

// Export globally
globalThis.ChatView = ChatView;

