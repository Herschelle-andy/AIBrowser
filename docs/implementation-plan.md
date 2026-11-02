# Sahayak — Phase-Wise Implementation Plan

> 17 vertical slices across 4 weeks. Each slice produces a testable, working increment.
> Build order follows the dependency graph: foundation → read → understand → act → remember → protect → ship.

---

## How To Use This Plan

1. **Work in order.** Each slice depends on the ones above it.
2. **One slice = one PR.** Commit and manually test before starting the next.
3. **Test on real pages.** Every slice ends with a concrete "test it" checklist — do not skip.
4. **Time estimates are per-slice**, not cumulative. A day means one focused coding session (4–6 hours).

---

## Phase 1 — Week 1: The Eyes (Read the Web)

**Goal:** A loadable Chrome extension with a side panel that can summarise articles and YouTube videos in English or Hinglish.

---

### Slice 1.1 — Extension Shell + Side Panel + Settings

**Time estimate:** 1 day

**What to build:**
1. Create `manifest.json` (Manifest V3) with permissions: `sidePanel`, `activeTab`, `tabs`, `scripting`, `storage`, `contextMenus`, `alarms`, and host permission `<all_urls>`.
2. Create `background/index.js` — minimal service worker that sets `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
3. Create `sidepanel/index.html` — basic HTML page with a tab navigation bar (Summary | Chat | Agent | Screenshot | Profile | Skills) and a settings gear icon.
4. Create `sidepanel/styles/panel.css` — clean, compact styling for the 400px-wide side panel.
5. Create `sidepanel/app.js` — tab switching logic (show/hide `<section>` elements).
6. Create `sidepanel/components/SettingsView.js` — modal/section with two input fields: Gemini API Key and Groq API Key (optional). Save/load from `chrome.storage.local` key `sahayak_api_keys`.
7. Create `icons/` — generate simple PNG icons at 16×16, 48×48, and 128×128 (or omit from manifest if not generating real PNGs).
8. Create `.gitignore` — exclude `node_modules/`, `.env`, `*.zip`, `dist/`.

**Files created:**
```
manifest.json
background/index.js
sidepanel/index.html
sidepanel/app.js
sidepanel/styles/panel.css
sidepanel/components/SettingsView.js
icons/icon-16.png
icons/icon-48.png
icons/icon-128.png
.gitignore
```

**Architecture references:** §3 (Manifest), §4 (Runtime Contexts), §16 (Directory Structure)

**Test checklist:**
- [ ] Go to `chrome://extensions`, enable Developer Mode, click "Load unpacked", select project folder.
- [ ] Extension appears in toolbar with icon.
- [ ] Click icon → side panel opens beside the current page.
- [ ] Tab navigation switches between placeholder sections.
- [ ] Enter a Gemini API key in Settings, close and reopen the panel — key persists.
- [ ] Key is stored in `chrome.storage.local` (verify via DevTools → Application → Storage).

---

### Slice 1.2 — First Gemini API Call

**Time estimate:** 0.5 days

**What to build:**
1. Create `services/ai/geminiProvider.js` — a function `callGemini(apiKey, model, prompt, options)` that:
   - POSTs to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`.
   - Parses the response and returns the text content.
   - Throws typed errors for 400, 401, 403, 429, 500 responses.
2. Create `services/ai/modelGateway.js` — a thin wrapper that:
   - Reads the API key from `chrome.storage.local`.
   - Calls `geminiProvider` with model `gemini-2.0-flash-lite` by default.
   - For now, no fallback logic (that comes in Slice 2.4).
3. Wire a simple test: user selects text on a page, clicks a button in the side panel → text is sent to Gemini with prompt "Explain this in simple terms:" → response displayed in the Summary tab.

**Prerequisite:** Slice 1.1

**Files created:**
```
services/ai/geminiProvider.js
services/ai/modelGateway.js
```

**Architecture references:** §7.1–7.2 (Model Gateway), Appendix B (API call examples)

**Test checklist:**
- [ ] Select text on any webpage.
- [ ] Click "Explain" in the side panel.
- [ ] AI response appears in the panel within a few seconds.
- [ ] Enter a wrong API key → clear, user-friendly error message (not a crash or silent failure).
- [ ] No API key set → message: "Please add your Gemini API key in Settings."

---

### Slice 1.3 — Article Extraction & Summarisation

**Time estimate:** 1 day

**What to build:**
1. Download and bundle `Readability.js` into `content/lib/Readability.js`.
2. Create `content/reader.js` — function that clones the document, runs `new Readability(clone).parse()`, and returns `{ title, byline, content (plaintext), excerpt, siteName, wordCount }`.
3. Create `content/index.js` — content script entry point that listens for messages from the service worker and dispatches to the reader.
4. Update `background/index.js` (message router) to handle `SUMMARIZE_PAGE`:
   - Send `EXTRACT_ARTICLE` to the content script.
   - Receive cleaned text.
   - Build a prompt requesting: TL;DR (1 line), 5 Key Points, What To Do Next.
   - Send to Gemini via model gateway.
   - Return result to side panel.
5. Create `services/ai/promptBuilder.js` — function `buildSummaryPrompt(articleText, language)` that returns the formatted system + user prompt.
6. Create `sidepanel/components/SummaryView.js` — renders the structured summary with clear section headings. Includes a "Summarise This Page" button.

**Prerequisite:** Slice 1.2

**Files created:**
```
content/index.js
content/reader.js
content/lib/Readability.js
services/ai/promptBuilder.js
sidepanel/components/SummaryView.js
```

**Files modified:**
```
background/index.js  (add SUMMARIZE_PAGE handler + message routing to content script)
manifest.json        (add content_scripts entry if not already present)
```

**Architecture references:** §6.1 (Readability extraction), §6.2 (Structured summary format)

**Test checklist:**
- [ ] Open a long news article (e.g., BBC, The Hindu, Wired).
- [ ] Click "Summarise This Page" in the side panel.
- [ ] Summary appears with TL;DR, 5 Key Points, and What To Do Next.
- [ ] Open a non-article page (e.g., Google homepage) → graceful message: "Could not extract article content from this page."
- [ ] Open a very long Wikipedia article → summary still works (content is truncated to ~28K tokens before sending).

---

### Slice 1.4 — Public YouTube Summarisation

**Time estimate:** 1 day

**What to build:**
1. Create `content/youtube.js` — detects YouTube video pages and either:
   - Extracts timed captions from the YouTube timedtext API (XML parsing), or
   - Returns the video URL for Gemini's native YouTube URL support.
2. Update `background/index.js` to handle `SUMMARIZE_YOUTUBE`:
   - Detect YouTube URL pattern (`youtube.com/watch?v=` or `youtu.be/`).
   - Try caption extraction first; fall back to passing URL directly to Gemini.
   - Build prompt requesting chapter-style notes with timestamps.
3. Update `SummaryView.js`:
   - Auto-detect if the current page is YouTube; show "Summarise Video" button instead.
   - Render timestamps as clickable links in format `[MM:SS](url&t=Ns)`.
4. Add timestamp click handler: when a timestamp link is clicked in the side panel, send a message to the content script to set `document.querySelector('video').currentTime = seconds`.

**Prerequisite:** Slice 1.3

**Files created:**
```
content/youtube.js
```

**Files modified:**
```
content/index.js          (add youtube message handler)
background/index.js       (add SUMMARIZE_YOUTUBE route + YouTube URL detection)
sidepanel/components/SummaryView.js  (YouTube mode + timestamp rendering)
```

**Architecture references:** §6.3 (YouTube pipeline)

**Test checklist:**
- [ ] Open a public YouTube video with English captions.
- [ ] Click "Summarise Video" → chapter-style notes appear with timestamps.
- [ ] Click a timestamp → video jumps to that time.
- [ ] Open a YouTube video without captions → still produces a summary (via Gemini URL input).
- [ ] Open a non-YouTube page → YouTube summarise button does not appear.

---

### Slice 1.5 — English / Hinglish Language Toggle

**Time estimate:** 0.5 days

**What to build:**
1. Add a toggle switch (EN | Hinglish) to the side panel header or settings.
2. Store the preference in `chrome.storage.local` key `sahayak_preferences.language`.
3. Update `promptBuilder.js` to append language-specific system instructions:
   - English: `"Respond in clear, concise English."`
   - Hinglish: `"Respond in Hinglish — natural Hindi-English mix written in Roman script. Keep technical terms in English. Example tone: 'Is article ka main point yeh hai ki...'"`.
4. The toggle should apply to all existing features: article summary, YouTube summary, and text explanation.

**Prerequisite:** Slice 1.3

**Files modified:**
```
sidepanel/index.html      (add toggle UI)
sidepanel/app.js           (toggle state management)
services/ai/promptBuilder.js  (language-aware prompt building)
```

**Architecture references:** §6.4 (Language toggle)

**Test checklist:**
- [ ] Set language to Hinglish → summarise an article → output is in Hinglish.
- [ ] Switch to English → re-summarise → output is in English.
- [ ] Close and reopen the panel → language preference persists.
- [ ] YouTube summary also respects the language toggle.

---

### ✅ Week 1 Milestone Checklist

- [ ] Extension loads in Chrome via Load unpacked.
- [ ] Side panel opens next to any webpage.
- [ ] API key entry in Settings; key persists in local storage.
- [ ] Selected text can be explained by the AI.
- [ ] Article summarised into TL;DR + 5 Points + Next Steps.
- [ ] Public YouTube video summarised with clickable timestamps.
- [ ] English / Hinglish toggle works on all outputs.

---

## Phase 2 — Week 2: The Brain (Understand Page & Screen)

**Goal:** Context-grounded page chat, right-click quick actions, screenshot Q&A, and resilient API error handling.

---

### Slice 2.1 — Grounded Page Chat

**Time estimate:** 1.5 days

**What to build:**
1. Create `sidepanel/components/ChatView.js`:
   - Chat input bar at the bottom.
   - Scrollable message area with user/assistant bubbles.
   - Typing indicator while streaming.
2. Update `background/index.js` to handle `CHAT_QUERY`:
   - Extract page text via content script (reuse `reader.js`).
   - Build the grounded prompt with `<PAGE_CONTEXT>` delimiters and strict grounding instructions: *"Answer ONLY from the provided PAGE_CONTEXT. If the answer is not in the context, say: 'This information is not available on the current page.'"*
   - Include conversation history in the prompt.
3. Implement streaming via `chrome.runtime.connect` port:
   - Service worker calls Gemini's `streamGenerateContent?alt=sse` endpoint.
   - Parses SSE chunks and sends them to the side panel via port messages (`STREAM_CHUNK`, `STREAM_DONE`, `STREAM_ERROR`).
   - Side panel appends chunks to the assistant bubble in real time.
4. Store chat history in `chrome.storage.session` key `sahayak_chat_history`. Clear when the user navigates to a different page.
5. For large pages (>28K tokens): split into ~4K-token chunks, score each against the query using keyword overlap, send top 3–4 chunks.

**Prerequisite:** Slice 1.3

**Files created:**
```
sidepanel/components/ChatView.js
```

**Files modified:**
```
background/index.js           (CHAT_QUERY handler, streaming port)
services/ai/geminiProvider.js (add streaming method)
services/ai/promptBuilder.js  (grounded chat prompt template)
```

**Architecture references:** §8 (Grounded Page Chat), §5 (Streaming support)

**Test checklist:**
- [ ] Open a Wikipedia article. Ask "What is this page about?" → answer uses only page content.
- [ ] Ask a question whose answer is NOT on the page → response says "This information is not available on the current page."
- [ ] Response streams in word-by-word (not all at once).
- [ ] Ask a follow-up question → previous context is maintained.
- [ ] Navigate to a different page → chat history clears.
- [ ] Open a very long page → chat still works (content is chunked).

---

### Slice 2.2 — Right-Click Context Menu Actions

**Time estimate:** 0.5 days

**What to build:**
1. Create `background/contextMenus.js`:
   - Register three context menu items on `chrome.runtime.onInstalled`:
     - `sahayak-explain` — "Sahayak: Explain this"
     - `sahayak-translate` — "Sahayak: Translate"
     - `sahayak-draft-reply` — "Sahayak: Draft a reply"
   - All use `contexts: ['selection']`.
2. Handle `chrome.contextMenus.onClicked`:
   - Open the side panel via `chrome.sidePanel.open({ windowId })`.
   - Send the selected text and action type to the side panel.
3. Update the side panel to receive `CONTEXT_ACTION` messages:
   - Switch to a "Quick Action" result card.
   - Show a spinner, call the appropriate prompt, display the result.
   - Include a "Copy to Clipboard" button on the result.
4. Prompt templates in `promptBuilder.js`:
   - Explain: "Explain the following in simple, plain language: {text}"
   - Translate: "Translate the following into Hindi: {text}"
   - Draft Reply: "Draft a polite, professional reply to the following message: {text}"

**Prerequisite:** Slice 1.2

**Files created:**
```
background/contextMenus.js
```

**Files modified:**
```
background/index.js            (import contextMenus, handle CONTEXT_ACTION routing)
sidepanel/app.js                (receive and display context action results)
services/ai/promptBuilder.js   (add explain/translate/draft templates)
```

**Architecture references:** §5 (Messaging), Appendix A (Context menu registration)

**Test checklist:**
- [ ] Select text on any page → right-click → "Sahayak: Explain this" appears.
- [ ] Click it → side panel opens (if not already open) and shows the explanation.
- [ ] Repeat with "Translate" → Hindi translation appears.
- [ ] Repeat with "Draft a reply" → professional reply appears.
- [ ] Click "Copy" on the result → text copied to clipboard.

---

### Slice 2.3 — Screenshot-and-Ask

**Time estimate:** 1.5 days

**What to build:**
1. Create `background/tabCapture.js` — wrapper around `chrome.tabs.captureVisibleTab(null, { format: 'png' })` that returns the base64 data URL.
2. Create `sidepanel/components/ScreenshotView.js`:
   - "Capture Screenshot" button.
   - Displays the captured image in a `<canvas>` element.
   - Click-drag crop tool: user draws a rectangle over the region of interest.
   - Crop produces a new base64 image from the canvas selection.
   - Text input: "Ask a question about this image."
   - Submit sends the (cropped) image + question to the service worker.
3. Update `background/index.js` to handle `SCREENSHOT_ASK`:
   - Build a multimodal Gemini request with `inline_data` (image) + `text` (question).
   - Use `gemini-2.0-flash` (not flash-lite — vision requires the larger model).
   - Stream or return the response.
4. Update `geminiProvider.js` to support multimodal payloads.

**Prerequisite:** Slice 1.2

**Files created:**
```
background/tabCapture.js
sidepanel/components/ScreenshotView.js
```

**Files modified:**
```
background/index.js            (SCREENSHOT_ASK handler, call tabCapture)
services/ai/geminiProvider.js  (multimodal payload support)
```

**Architecture references:** §9 (Screenshot pipeline), Appendix B (multimodal call)

**Test checklist:**
- [ ] Click "Capture Screenshot" → current tab's visible area appears in the side panel.
- [ ] Draw a crop rectangle over a chart or diagram → only that region is highlighted.
- [ ] Type "What does this chart show?" → relevant answer appears.
- [ ] Take a screenshot of an error message → ask "What does this error mean?" → useful answer.
- [ ] Full-page screenshot (no crop) also works.

---

### Slice 2.4 — Free-Tier Resilience (Retry + Groq Fallback)

**Time estimate:** 1 day

**What to build:**
1. Create `services/ai/retryWithFallback.js`:
   - `callWithFallback(primaryFn, fallbackFn, maxRetries=2)`.
   - On HTTP 429 or `RESOURCE_EXHAUSTED`: exponential backoff with jitter (1s, 2s, 4s + random 0–500ms).
   - After all retries exhausted: call `fallbackFn` if provided.
   - On non-retryable errors: throw immediately.
2. Create `services/ai/groqProvider.js`:
   - Function `callGroq(apiKey, model, prompt)` that POSTs to `https://api.groq.com/openai/v1/chat/completions`.
   - Default model: `llama-3.1-8b-instant`.
   - Parse OpenAI-compatible response format.
3. Update `modelGateway.js` to:
   - Wrap every Gemini call with `callWithFallback`.
   - Use Groq as the fallback for text-only tasks.
   - For vision tasks: no fallback (show error: "Vision quota reached. Please try later.").
4. Update the side panel to display user-friendly error states:
   - Rate limited, retrying…
   - Switched to backup model.
   - All models unavailable — please try again in a few minutes.

**Prerequisite:** Slices 1.2, 2.1

**Files created:**
```
services/ai/retryWithFallback.js
services/ai/groqProvider.js
```

**Files modified:**
```
services/ai/modelGateway.js   (wrap calls with retry+fallback)
sidepanel/app.js               (error state UI)
```

**Architecture references:** §7.3 (Retry logic), §7.1 (Provider matrix)

**Test checklist:**
- [ ] Temporarily set an invalid Gemini key but valid Groq key → text features fall back to Groq.
- [ ] Set both keys invalid → clear error message, no crash.
- [ ] Simulate rate limit (send many rapid requests) → see "Retrying…" indicator → eventual fallback.
- [ ] Screenshot-and-ask with Gemini quota exhausted → message: "Vision requires Gemini Flash, which has reached its limit."
- [ ] Restore valid keys → everything works normally again.

---

### ✅ Week 2 Milestone Checklist

- [ ] User can chat with the current page; answers are grounded in page content.
- [ ] "Explain", "Translate", "Draft a reply" work from the right-click menu.
- [ ] Screenshot capture with optional crop + visual Q&A works.
- [ ] Rate limits and API errors produce friendly messages, not crashes.
- [ ] Groq fallback activates automatically when Gemini is rate-limited.

---

## Phase 3 — Week 3: The Hands (Act With User Approval)

**Goal:** Detect interactive elements, number them, let the AI propose one action at a time, and execute only with user approval.

---

### Slice 3.1 — Interactive Element Scanner

**Time estimate:** 1 day

**What to build:**
1. Create `content/scanner.js`:
   - Query DOM with the interactive selectors list: `a[href]`, `button`, `input:not([type="hidden"])`, `textarea`, `select`, `summary`, `[role="button"]`, `[role="link"]`, `[role="checkbox"]`, etc.
   - Apply visibility filters: `offsetParent !== null`, `visibility !== 'hidden'`, `opacity > 0.05`, `rect.width > 4 && rect.height > 4`, `elementFromPoint` occlusion check, `!disabled`.
   - Assign sequential IDs (1, 2, 3…) to each qualifying element.
   - Build a `PageActionMap` object: `{ url, title, totalElements, elements[], scannedAt }`.
   - Each element in the map: `{ id, tag, type, role, text, placeholder, name, value, checked, href, disabled }`.
   - Store a `Map<number, HTMLElement>` in the content script's module scope so element references survive until the next scan.
2. Update `content/index.js` to handle `SCAN_ELEMENTS` messages.
3. Update `background/index.js` to route `SCAN_ELEMENTS` to the content script and return the action map.

**Prerequisite:** Slice 1.1 (content script infrastructure)

**Files created:**
```
content/scanner.js
```

**Files modified:**
```
content/index.js     (add SCAN_ELEMENTS handler)
background/index.js  (route SCAN_ELEMENTS)
```

**Architecture references:** §10.1–10.4 (Scanner, filters, schema)

**Test checklist:**
- [ ] Open a form page (e.g., a practice form or Google search). Trigger scan from DevTools console.
- [ ] Action map JSON is logged — verify it contains all visible buttons, inputs, links.
- [ ] Hidden elements (display:none, visibility:hidden) are NOT included.
- [ ] Disabled elements are NOT included.
- [ ] Elements behind overlays/modals are NOT included (occlusion check).

---

### Slice 3.2 — Shadow DOM Numbered Badges

**Time estimate:** 0.5 days

**What to build:**
1. Create `content/overlay.js`:
   - Create a `<sahayak-overlay>` custom element appended to `document.documentElement`.
   - Attach a **closed** Shadow DOM root.
   - Inject scoped CSS for `.sahayak-badge`: `position: absolute`, `z-index: 2147483647`, `pointer-events: none`, high-contrast colors (navy background `#1A237E`, yellow text `#FFC107`).
   - Function `showBadges(elements[])` — for each element, calculate position using `getBoundingClientRect() + window.scrollX/Y`, create a badge `<span>` with the element's ID number.
   - Function `clearBadges()` — remove all badges (or remove the overlay host entirely).
   - Function `highlightElement(id)` — add a pulsing border to a specific element (for "Find It" feature).
2. Update `content/index.js` to handle `SHOW_BADGES`, `CLEAR_BADGES`, `HIGHLIGHT_ELEMENT`.

**Prerequisite:** Slice 3.1

**Files created:**
```
content/overlay.js
```

**Files modified:**
```
content/index.js  (add badge-related message handlers)
```

**Architecture references:** §10.5 (Shadow DOM badges)

**Test checklist:**
- [ ] Trigger scan + show badges → numbered labels (1, 2, 3…) appear over interactive elements.
- [ ] Badges do NOT intercept clicks — clicking through a badge still activates the page element beneath.
- [ ] Badges are NOT affected by the host page's CSS (Shadow DOM isolation).
- [ ] Scroll the page → badges stay positioned correctly (re-position on scroll if needed).
- [ ] Clear badges → all labels disappear, no DOM residue.

---

### Slice 3.3 — "Find It For Me" (Structured Element Selection)

**Time estimate:** 0.5 days

**What to build:**
1. Add a "Find Element" input in the Agent tab of the side panel: user types a natural-language query like "Where do I upload my resume?"
2. Handle `FIND_ELEMENT` in the service worker:
   - Scan the page for elements (reuse scanner).
   - Build a prompt: "Given this action map, which element best matches the user's request? Return JSON: `{ elementId: number, reasoning: string }`".
   - Use Gemini's structured output (`responseMimeType: 'application/json'`, `responseSchema`).
   - Validate the returned JSON.
3. Send `HIGHLIGHT_ELEMENT` to the content script with the matched ID.
4. Display the result in the side panel: "Element #5: 'Upload Resume' button — {reasoning}".

**Prerequisite:** Slices 3.1, 3.2

**Files modified:**
```
sidepanel/components/AgentView.js  (add Find Element input + result display)
background/index.js                (FIND_ELEMENT handler)
services/ai/promptBuilder.js       (element-finding prompt template)
```

**Architecture references:** §11.3 (Structured JSON output), Appendix B (structured output)

**Test checklist:**
- [ ] Open a job application page. Type "Where do I upload my resume?" → correct element highlighted.
- [ ] Open Google. Type "Where do I search?" → search input highlighted.
- [ ] Ask about an element that doesn't exist → message: "Could not find a matching element on this page."

---

### Slice 3.4 — Agent Execution Loop + Approval UI

**Time estimate:** 2 days

**What to build:**
1. Create `services/state/agentStateMachine.js`:
   - States: `IDLE`, `SCANNING`, `THINKING`, `SAFETY_CHECK`, `AWAITING_APPROVAL`, `EXECUTING`, `COMPLETED`, `CLEANUP`.
   - Transition functions that enforce valid state changes.
   - Each transition writes the full state to `chrome.storage.session` (checkpoint).
2. Create `sidepanel/components/ActionCard.js`:
   - Displays one proposed action: "Step 3: Type 'John Doe' into element #2 (Name field)"
   - Shows the AI's reasoning.
   - Three buttons: **[✓ Approve]** (green), **[→ Skip]** (yellow), **[✕ Stop]** (red).
   - For consequential actions: red warning banner + checkbox before Approve is enabled.
3. Update `sidepanel/components/AgentView.js`:
   - Goal input field + "Start" button.
   - Max steps slider (default 10, max 25).
   - Dry-run toggle checkbox.
   - Step counter: "Step 3 of 10".
   - Embeds `ActionCard` for the current proposed action.
   - Persistent red **[STOP]** button visible during any active task.
4. Implement the agent loop in the service worker:
   ```
   START → scan → send actionMap+goal to LLM → receive JSON action
   → safety check → show ActionCard → wait for user decision
   → if approve: execute → re-scan → next step
   → if skip: re-query LLM → next step
   → if stop: cleanup
   → if action.type === 'done' or step >= max: cleanup
   ```
5. Use Gemini structured output with the `BrowserAction` schema: `{ action, targetElementId, value, reasoning, isConsequential }`.
6. Prompt includes: goal, current action map, user profile (if relevant), list of previous actions taken.

**Prerequisite:** Slices 3.1, 3.2, 3.3

**Files created:**
```
services/state/agentStateMachine.js
sidepanel/components/ActionCard.js
```

**Files modified:**
```
sidepanel/components/AgentView.js  (goal input, step counter, stop button, embed ActionCard)
background/index.js                (AGENT_START, AGENT_APPROVE, AGENT_SKIP, AGENT_STOP handlers)
services/ai/promptBuilder.js       (agent action prompt template)
```

**Architecture references:** §11.1–11.3 (State machine, loop pseudocode, action schema)

**Test checklist:**
- [ ] Open a practice form. Enter goal: "Fill in the name field with 'Test User'".
- [ ] Agent scans, badges appear, action card shows: "Type 'Test User' into element #N".
- [ ] Click Approve → **nothing happens yet** (executor not built — this slice only tests the loop + UI).
- [ ] Click Skip → agent proposes a different action.
- [ ] Click Stop → badges clear, agent returns to idle.
- [ ] Step counter updates correctly.
- [ ] After max steps → agent auto-stops.

---

### Slice 3.5 — Action Executor (Synthetic Events)

**Time estimate:** 1 day

**What to build:**
1. Create `content/executor.js`:
   - `executeClick(element)` — scroll into view, focus, dispatch `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`.
   - `executeType(element, value)` — scroll into view, focus, set value via native property descriptor setter (to work with React/Vue/Angular), dispatch `input` and `change` events.
   - `executeSelect(element, value)` — set value, dispatch `change`.
   - `executeScroll(direction)` — `window.scrollBy({ top: ±400, behavior: 'smooth' })`.
2. Update `content/index.js` to handle `EXECUTE_ACTION`:
   - Look up element by ID from the stored `Map<number, HTMLElement>`.
   - Call the appropriate executor function based on `action.action`.
   - Return success/failure.
3. Wire the agent loop: when user approves, service worker sends `EXECUTE_ACTION` to content script.
4. After execution, the loop re-scans the page (elements may have changed) and continues.

**Prerequisite:** Slice 3.4

**Files created:**
```
content/executor.js
```

**Files modified:**
```
content/index.js   (EXECUTE_ACTION handler, element lookup)
background/index.js (wire approve → execute → re-scan flow)
```

**Architecture references:** §11.4 (Synthetic event dispatcher)

**Test checklist:**
- [ ] Open a practice form. Start agent: "Fill name with 'Test User' and email with 'test@example.com'".
- [ ] Approve the first action → the name field is filled (text appears in the input).
- [ ] Approve the second action → the email field is filled.
- [ ] The input's framework-level change handlers fire (test on a React form if possible).
- [ ] Click action works: agent proposes clicking a button → approve → button is clicked.
- [ ] Select action works on a dropdown.

---

### Slice 3.6 — Dry Run, Step Limits, Persistence, Action Log

**Time estimate:** 1 day

**What to build:**
1. **Dry-run mode:** When the dry-run toggle is active, the executor does NOT dispatch events. Instead, it highlights the target element with a pulsing purple border and shows a toast: "Dry Run — would type 'Test' into element #3".
2. **Step limit enforcement:** Agent auto-stops when `stepCount >= maxSteps` and shows "Step limit reached."
3. **Service worker persistence:**
   - Create `services/state/checkpoint.js` with `saveCheckpoint()`, `loadCheckpoint()`, `clearCheckpoint()`.
   - Every state machine transition calls `saveCheckpoint()`.
   - On service worker wake-up: check for existing checkpoint → if status was `AWAITING_APPROVAL`, re-send the proposed action to the side panel.
   - Keepalive alarm: `chrome.alarms.create('sahayak-keepalive', { periodInMinutes: 0.4 })` during active tasks. Clear on IDLE.
4. **Action log:**
   - Create `sidepanel/components/ActionLog.js` — scrollable list of all steps: step number, proposed action, reasoning, user decision (approved/skipped/stopped), whether it was executed or dry-run.
   - Save completed task logs to `chrome.storage.local` key `sahayak_action_history` (array of arrays).

**Prerequisite:** Slice 3.5

**Files created:**
```
services/state/checkpoint.js
sidepanel/components/ActionLog.js
```

**Files modified:**
```
services/state/agentStateMachine.js  (checkpoint on every transition)
sidepanel/components/AgentView.js    (embed ActionLog, dry-run toggle)
content/executor.js                  (dry-run highlight mode)
background/index.js                  (keepalive alarm, rehydration on wake)
```

**Architecture references:** §11.5 (Dry-run), §15 (Persistence strategy)

**Test checklist:**
- [ ] Enable dry-run → start agent → approve action → element pulses purple, NO actual typing/clicking.
- [ ] Action log shows the action as "dry run".
- [ ] Set max steps to 3 → after 3 approvals, agent auto-stops.
- [ ] During an active task with a pending approval, wait 60 seconds (service worker may sleep). Open the side panel again → the pending action card re-appears, agent resumes.
- [ ] Complete a task → action log persists. Reopen the panel → can review past logs.

---

### ✅ Week 3 Milestone Checklist

- [ ] Interactive elements are detected and numbered with badges on supported pages.
- [ ] "Find it for me" correctly identifies elements from natural language.
- [ ] Agent proposes one strict-JSON action at a time.
- [ ] No browser action happens before user approval.
- [ ] Approve, Skip, Stop, step limit, and dry-run all work.
- [ ] Agent survives service worker sleep (state checkpointed and restored).
- [ ] Action log records all proposed steps, decisions, and outcomes.
- [ ] Agent can complete at least two practice errands (form fill, search + filter) with approval at every step.

---

## Phase 4 — Week 4: Memory, Safety & Shipping

**Goal:** Local profile memory, reusable skills, hardcoded safety rails, and a shippable release.

---

### Slice 4.1 — Local Profile Memory

**Time estimate:** 1 day

**What to build:**
1. Create `services/storage/profileStore.js` — CRUD functions: `getProfile()`, `saveProfile(profile)`, `clearProfile()`. Reads/writes `chrome.storage.local` key `sahayak_user_profile`.
2. Create `sidepanel/components/ProfileView.js` — form with fields:
   - Personal: Full Name, Email, Phone, City.
   - Academic: College, Degree, Major, Graduation Year.
   - Professional: Skills (comma-separated), Short Bio, LinkedIn, GitHub, Portfolio.
   - Preferences: Language (EN/Hinglish), Response Tone (concise/detailed/formal/casual).
   - Save button, Clear button.
3. Wire profile into agent prompts:
   - When the agent task involves form-filling: include profile data in the prompt inside `<USER_PROFILE>` delimiters.
   - When drafting replies: include tone preference and name.
4. Update language toggle to read from profile's `preferredLanguage` as default.

**Prerequisite:** Slices 1.5, 3.4

**Files created:**
```
services/storage/profileStore.js
sidepanel/components/ProfileView.js
```

**Files modified:**
```
services/ai/promptBuilder.js  (inject profile into agent/draft prompts)
sidepanel/app.js               (language default from profile)
```

**Architecture references:** §13 (Local Profile Memory)

**Test checklist:**
- [ ] Fill in profile fields → click Save → close and reopen panel → data persists.
- [ ] Start an agent task on a form: "Fill this form from my profile" → agent uses profile data for name, email, etc.
- [ ] Draft a reply → response uses the tone from the profile.
- [ ] Click Clear → all profile data is removed.

---

### Slice 4.2 — One-Click Saved Skills

**Time estimate:** 1 day

**What to build:**
1. Create `services/storage/skillsStore.js` — CRUD: `getSkills()`, `saveSkill(skill)`, `deleteSkill(id)`, `exportSkills()`, `importSkills(json)`.
2. Create `sidepanel/components/SkillsView.js`:
   - List of saved skills as clickable cards with icon + name + description.
   - "Create New Skill" button → form with: name, description, icon (emoji picker), prompt template, checkboxes for requires (page content, selected text, profile, agent loop).
   - "Run" button on each skill → executes the skill against the current page.
   - "Export All" button → downloads `sahayak-skills.json`.
   - "Import" button → file picker → validates and merges skills.
   - Delete button on each skill (with confirmation).
3. Ship 4 built-in default skills (not deletable, but can be duplicated and customised):
   - 📝 Exam Notes
   - 🗣️ Explain in Hinglish
   - 💬 Reply Politely
   - 📋 Fill Form From Profile
4. Template substitution: replace `{{selectedText}}`, `{{profile.fullName}}`, `{{profile.email}}`, etc. before sending to the AI.
5. Skills with `requiresAgentLoop: true` trigger the agent flow instead of a simple text query.

**Prerequisite:** Slices 4.1, 3.4

**Files created:**
```
services/storage/skillsStore.js
sidepanel/components/SkillsView.js
```

**Files modified:**
```
background/index.js  (skill execution routing)
```

**Architecture references:** §14 (Skills Engine)

**Test checklist:**
- [ ] Click "Exam Notes" on an article page → structured revision notes appear.
- [ ] Click "Reply Politely" with text selected → draft reply uses profile name and tone.
- [ ] Create a custom skill: "Summarise in 3 bullet points" → run it → works correctly.
- [ ] Export skills → `sahayak-skills.json` downloads.
- [ ] Delete all custom skills → import the file → skills reappear.
- [ ] Built-in skills cannot be deleted.

---

### Slice 4.3 — Deterministic Safety Rails

**Time estimate:** 1 day

**What to build:**
1. Create `safety/blocklists.js`:
   - `BLOCKED_DOMAIN_PATTERNS` — regex array covering banking, payment, UPI, crypto, government ID sites.
   - `BLOCKED_INPUT_PATTERNS` — regex array: password, otp, cvv, cvc, card number, expiry, ssn, aadhaar, pin.
   - `CONSEQUENTIAL_KEYWORDS` — regex array: submit, pay, purchase, buy, delete, remove, send, transfer, checkout, proceed.
   - Export: `isDomainBlocked(url)`, `isFieldBlocked(element)`, `isConsequential(element)`.
2. Create `safety/guardrails.js`:
   - `checkSafety(action, url, actionMap)` → returns `{ allowed: boolean, reason?: string, isConsequential?: boolean }`.
   - Pipeline: check domain → check field → check consequential.
3. Create `safety/consequential.js` — consequential action detection extracted as a separate module for clarity.
4. Wire into the agent loop:
   - After the LLM returns a proposed action, run `checkSafety()` BEFORE showing the ActionCard.
   - If blocked: show a red warning card: "🛑 Blocked: Sahayak cannot act on banking/payment pages" or "🛑 Blocked: Cannot type into password fields". Do NOT show Approve button.
   - If consequential: show ActionCard with a red warning banner and a checkbox the user must tick before Approve is enabled.
5. Also wire into non-agent features:
   - Before any AI call, check `isDomainBlocked(url)`. If on a sensitive domain, refuse to send page content to the AI. Show: "Sahayak does not send content from sensitive pages to external AI services."

**Prerequisite:** Slice 3.4

**Files created:**
```
safety/blocklists.js
safety/guardrails.js
safety/consequential.js
```

**Files modified:**
```
services/state/agentStateMachine.js  (call checkSafety before AWAITING_APPROVAL)
sidepanel/components/ActionCard.js   (consequential warning + checkbox)
background/index.js                  (domain check before AI calls)
```

**Architecture references:** §12 (Safety Rails Engine)

**Test checklist:**
- [ ] Navigate to a banking site (e.g., onlinesbi.com). Try to summarise → blocked message.
- [ ] Navigate to a banking site. Try to start agent → blocked message, no scan, no badges.
- [ ] Open a form with a password field. Start agent → if agent tries to type into password field → "🛑 Blocked: Cannot type into password fields."
- [ ] Agent proposes clicking a "Submit" button → red warning + checkbox appears → must tick checkbox to approve.
- [ ] Agent proposes clicking a normal link → standard approval card (no warning).
- [ ] Test with a UPI page, PayPal page → all blocked.

---

### Slice 4.4 — README, Release Packaging & Landing Page

**Time estimate:** 1 day

**What to build:**
1. Write `README.md`:
   - Project description and screenshot.
   - Features list.
   - Installation instructions (download ZIP → Load unpacked).
   - Configuration (API key setup).
   - Usage guide with examples.
   - Safety information.
   - Contributing guidelines.
   - License.
2. Create `package.json` with a `build` script that creates a release ZIP:
   ```json
   {
     "scripts": {
       "build:zip": "..."
     }
   }
   ```
   The ZIP includes: `manifest.json`, `background/`, `content/`, `sidepanel/`, `services/`, `safety/`, `icons/`, `README.md`. Excludes: `.git/`, `node_modules/`, `docs/`, `.env`, test files.
3. Create `docs/landing/index.html` — single-page GitHub Pages site:
   - Project name "Sahayak" + tagline.
   - Feature cards with icons.
   - Installation steps.
   - Screenshot carousel placeholder.
   - Links to GitHub repo and releases.
4. Take screenshots of key features and place in `docs/screenshots/`.
5. Create a GitHub Actions workflow `.github/workflows/release.yml` that:
   - Triggers on tag push (`v*`).
   - Builds the ZIP.
   - Creates a GitHub Release with the ZIP attached.

**Prerequisite:** All previous slices

**Files created:**
```
README.md
package.json
docs/landing/index.html
docs/screenshots/  (placeholder)
.github/workflows/release.yml
CHANGELOG.md
```

**Architecture references:** §18 (Build, Package & Distribution)

**Test checklist:**
- [ ] Run the build script → ZIP is created with only the required files.
- [ ] Unzip into a fresh folder → Load unpacked in Chrome → extension works.
- [ ] README is clear enough that someone else can follow it to install.
- [ ] Landing page renders correctly when served locally.
- [ ] No API keys, `.env` files, or `node_modules` in the ZIP.

---

### ✅ Week 4 Milestone Checklist

- [ ] User profile memory works locally — save, load, clear.
- [ ] Saved skills can be created, run, deleted.
- [ ] Skills export and import work correctly.
- [ ] Banking, payment, and UPI pages are blocked.
- [ ] Password, OTP, CVV, and card fields are blocked.
- [ ] Consequential actions (Submit, Pay, Delete) require extra confirmation.
- [ ] API key is NOT in the repository.
- [ ] Another user can install from the release ZIP and set up successfully.
- [ ] README contains clear instructions.
- [ ] GitHub Pages landing page exists.

---

## Final Definition of Done

A new user should be able to:

| # | End-to-End Flow | Slices Required |
|---|----------------|-----------------|
| 1 | Download ZIP → Load unpacked → extension appears | 4.4, 1.1 |
| 2 | Enter API key in Settings | 1.1 |
| 3 | Summarise an article | 1.3 |
| 4 | Summarise a public YouTube video | 1.4 |
| 5 | Switch between English and Hinglish | 1.5 |
| 6 | Chat with the current page | 2.1 |
| 7 | Right-click → Explain / Translate / Draft Reply | 2.2 |
| 8 | Screenshot a chart and ask about it | 2.3 |
| 9 | Ask "Where do I upload my resume?" → element highlighted | 3.3 |
| 10 | Give agent a form-filling task → approve each step | 3.4, 3.5 |
| 11 | Use dry-run mode to preview without acting | 3.6 |
| 12 | Review the action log | 3.6 |
| 13 | Fill a form using profile data | 4.1 |
| 14 | Run a saved skill | 4.2 |
| 15 | Confirm banking pages are blocked | 4.3 |
| 16 | Confirm password/OTP fields are blocked | 4.3 |
| 17 | Confirm Submit/Pay buttons require extra confirmation | 4.3 |

---

## Appendix: File Creation Order (All 17 Slices)

For quick reference, every file listed in creation order:

```
Slice 1.1:
  manifest.json
  background/index.js
  sidepanel/index.html
  sidepanel/app.js
  sidepanel/styles/panel.css
  sidepanel/components/SettingsView.js
  icons/icon-{16,48,128}.png
  .gitignore

Slice 1.2:
  services/ai/geminiProvider.js
  services/ai/modelGateway.js

Slice 1.3:
  content/index.js
  content/reader.js
  content/lib/Readability.js
  services/ai/promptBuilder.js
  sidepanel/components/SummaryView.js

Slice 1.4:
  content/youtube.js

Slice 1.5:
  (modifications only)

Slice 2.1:
  sidepanel/components/ChatView.js

Slice 2.2:
  background/contextMenus.js

Slice 2.3:
  background/tabCapture.js
  sidepanel/components/ScreenshotView.js

Slice 2.4:
  services/ai/retryWithFallback.js
  services/ai/groqProvider.js

Slice 3.1:
  content/scanner.js

Slice 3.2:
  content/overlay.js

Slice 3.3:
  (modifications only)

Slice 3.4:
  services/state/agentStateMachine.js
  sidepanel/components/ActionCard.js

Slice 3.5:
  content/executor.js

Slice 3.6:
  services/state/checkpoint.js
  sidepanel/components/ActionLog.js

Slice 4.1:
  services/storage/profileStore.js
  sidepanel/components/ProfileView.js

Slice 4.2:
  services/storage/skillsStore.js
  sidepanel/components/SkillsView.js

Slice 4.3:
  safety/blocklists.js
  safety/guardrails.js
  safety/consequential.js

Slice 4.4:
  README.md
  package.json
  CHANGELOG.md
  docs/landing/index.html
  .github/workflows/release.yml
```

