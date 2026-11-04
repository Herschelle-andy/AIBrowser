/**
 * Sahayak — Agent View Component (Slice 3.3 & Slice 3.4)
 *
 * Provides:
 * - "Find It For Me" natural-language element finder (Slice 3.3)
 * - Page interactive element badge controls (Slice 3.2)
 * - Agent Goal setup: goal input, max steps slider (1-25), dry-run toggle (Slice 3.4)
 * - Agent Execution Loop UI: step counter, status badge, ActionCard embed (Slice 3.4)
 * - Persistent [STOP] button during any active task (Slice 3.4 / §12.6)
 */

(function () {
  'use strict';

  let containerEl = null;
  let lastMatchedElementId = null;
  let isSearching = false;
  let currentAgentState = null;
  let isMessageListenerRegistered = false;

  /**
   * Render the Agent View into the given container element.
   * @param {HTMLElement} container
   */
  async function render(container) {
    containerEl = container;
    container.innerHTML = `
      <div class="agent-view">
        <!-- ── Section: Overlay Controls ────────────────────────────── -->
        <div class="agent-card">
          <div class="agent-card-header">
            <h3 class="section-title">🏷️ Page Interactive Elements</h3>
            <span id="agent-element-count" class="element-count-badge" style="display: none;">0 elements</span>
          </div>
          <p class="section-desc">
            Toggle numbered badges directly on the active webpage to see all interactive elements.
          </p>
          <div class="agent-toolbar">
            <button id="btn-show-badges" class="btn btn-primary btn-sm" title="Scan and display numbered badges on the page">
              👁️ Show Badges
            </button>
            <button id="btn-clear-badges" class="btn btn-secondary btn-sm" title="Remove all badges from the page">
              ✕ Clear Badges
            </button>
            <button id="btn-rescan-page" class="btn btn-secondary btn-sm" title="Re-scan the current page">
              🔄 Scan Page
            </button>
          </div>
          <div id="agent-scan-status" class="agent-status-text" style="display: none;"></div>
        </div>

        <!-- ── Section: Browser Agent Autonomous Loop (Slice 3.4) ────── -->
        <div class="agent-card agent-task-card">
          <div class="agent-card-header">
            <h3 class="section-title">🤖 Browser Action Agent</h3>
            <span id="agent-active-badge" class="feature-tag">Human in the Loop</span>
          </div>
          <p class="section-desc">
            Give Sahayak a multi-step objective. It scans the page, proposes each action as a card, and executes only with your approval.
          </p>

          <!-- 1. Goal Input & Setup (Visible when IDLE) -->
          <div id="agent-setup-panel" class="agent-setup-panel">
            <form id="agent-start-form" class="agent-form">
              <label for="agent-goal-input" class="agent-label">What is your goal on this page?</label>
              <textarea
                id="agent-goal-input"
                class="form-input agent-goal-textarea"
                rows="3"
                placeholder="e.g. Fill in the name field with 'Test User' or Find the documentation search bar"
                maxlength="500"
                required
              ></textarea>

              <!-- Controls: Max Steps Slider & Dry Run -->
              <div class="agent-controls-row">
                <div class="agent-slider-group">
                  <div class="agent-slider-label-row">
                    <span class="control-label">Max steps:</span>
                    <strong id="agent-max-steps-val" class="slider-val">10</strong>
                  </div>
                  <input
                    type="range"
                    id="agent-max-steps-slider"
                    class="agent-slider"
                    min="1"
                    max="25"
                    value="10"
                  />
                </div>

                <label class="agent-dryrun-label" title="Preview actions with highlights without clicking or typing">
                  <input type="checkbox" id="agent-dryrun-check" class="dryrun-checkbox" />
                  <span>Dry-run mode</span>
                </label>
              </div>

              <button type="submit" id="btn-agent-start" class="btn btn-primary btn-start-task">
                <span>▶ Start Agent Task</span>
              </button>
            </form>
          </div>

          <!-- 2. Active Task Progress & Persistent Stop (Visible when ACTIVE) -->
          <div id="agent-active-panel" class="agent-active-panel" style="display: none;">
            <div class="agent-active-header">
              <div class="agent-active-status-group">
                <span id="agent-step-counter" class="agent-step-counter">Step 1 of 10</span>
                <span id="agent-state-pill" class="agent-state-pill">SCANNING</span>
              </div>
              <button id="btn-agent-stop-persistent" class="btn btn-danger btn-sm btn-persistent-stop" title="Stop agent task immediately">
                🛑 STOP
              </button>
            </div>

            <div id="agent-goal-display" class="agent-active-goal"></div>
            <div id="agent-status-msg" class="agent-status-msg"></div>

            <!-- Loading indicator when thinking/scanning -->
            <div id="agent-thinking-spinner" class="loading-area" style="display: none;">
              <div class="loading-spinner"></div>
              <span id="agent-spinner-text" class="loading-text">Analyzing page elements…</span>
            </div>

            <!-- ActionCard Container (Proposed action) -->
            <div id="agent-action-card-container" class="action-card-container"></div>
          </div>

          <!-- 3. Task Finished / Error Banner -->
          <div id="agent-completion-banner" class="agent-completion-banner" style="display: none;">
            <div id="agent-completion-icon" class="completion-icon">✓</div>
            <div class="completion-text-group">
              <strong id="agent-completion-title">Task Complete</strong>
              <p id="agent-completion-desc" class="completion-desc"></p>
            </div>
            <button id="btn-agent-reset" class="btn btn-secondary btn-sm">
              New Task
            </button>
          </div>

          <!-- Action Log Component Container (Slice 3.6) -->
          <div id="agent-action-log-container" class="agent-action-log-container"></div>
        </div>

        <!-- ── Section: Find It For Me (Slice 3.3) ────────────────────── -->
        <div class="agent-card find-element-card">
          <div class="agent-card-header">
            <h3 class="section-title">🔍 Find It For Me</h3>
            <span class="feature-tag">Single Element</span>
          </div>
          <p class="section-desc">
            Ask where any button, form input, or link is, and Sahayak will locate and highlight it on the page.
          </p>

          <form id="find-element-form" class="find-element-form">
            <div class="find-input-group">
              <input
                type="text"
                id="find-element-input"
                class="form-input find-input"
                placeholder="e.g. Where do I upload my resume? or Where do I search?"
                maxlength="200"
                autocomplete="off"
              />
              <button type="submit" id="btn-find-submit" class="btn btn-primary" title="Search for element">
                <span id="find-btn-text">Find</span>
              </button>
            </div>
          </form>

          <!-- Quick query suggestions -->
          <div class="find-query-chips">
            <span class="chips-label">Quick suggestions:</span>
            <div class="chips-wrapper">
              <button class="find-chip" type="button" data-query="Where do I search?">Where do I search?</button>
              <button class="find-chip" type="button" data-query="Where is the submit button?">Submit button</button>
              <button class="find-chip" type="button" data-query="Where do I sign in or login?">Sign in / Login</button>
              <button class="find-chip" type="button" data-query="Where do I upload my resume?">Upload resume</button>
            </div>
          </div>

          <!-- Loading State -->
          <div id="find-loading" class="loading-area" style="display: none;">
            <div class="loading-spinner"></div>
            <span class="loading-text">Scanning page & locating element…</span>
          </div>

          <!-- Result Area -->
          <div id="find-result" class="result-area find-result-card" style="display: none;">
            <div class="result-header">
              <div class="find-result-title-group">
                <span id="find-badge-pill" class="find-badge-pill">#1</span>
                <span id="find-element-name" class="find-element-name">Button</span>
              </div>
              <div class="result-actions">
                <button id="btn-rehighlight" class="btn btn-secondary btn-sm" title="Highlight this element again">
                  ✨ Highlight
                </button>
                <button id="btn-close-find-result" class="btn btn-secondary btn-sm" title="Dismiss result">
                  ✕
                </button>
              </div>
            </div>
            <div id="find-result-reasoning" class="find-result-reasoning"></div>
            <div class="find-result-meta">
              <span id="find-model-badge" class="model-badge"></span>
            </div>
          </div>

          <!-- Error / Not Found Area -->
          <div id="find-error" class="error-area" style="display: none;">
            <div id="find-error-text" class="error-text"></div>
          </div>
        </div>
      </div>
    `;

    bindEvents();

    // Query active state on mount
    try {
      const stateRes = await chrome.runtime.sendMessage({ type: 'GET_AGENT_STATE' });
      if (stateRes && stateRes.success && stateRes.data) {
        updateAgentUI(stateRes.data);
      } else {
        renderActionLog({ history: [], state: 'IDLE', dryRun: false });
      }
    } catch (e) {
      renderActionLog({ history: [], state: 'IDLE', dryRun: false });
    }

    // Register broadcast listener
    if (!isMessageListenerRegistered && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'AGENT_STATE_CHANGED') {
          updateAgentUI(message.payload);
        }
      });
      isMessageListenerRegistered = true;
    }
  }

  /**
   * Bind DOM event listeners.
   */
  function bindEvents() {
    if (!containerEl) return;

    // Overlay controls
    const btnShowBadges = containerEl.querySelector('#btn-show-badges');
    const btnClearBadges = containerEl.querySelector('#btn-clear-badges');
    const btnRescan = containerEl.querySelector('#btn-rescan-page');

    if (btnShowBadges) {
      btnShowBadges.addEventListener('click', async () => {
        showStatus('Scanning and displaying badges…');
        try {
          const scanRes = await chrome.runtime.sendMessage({ type: 'SCAN_ELEMENTS' });
          if (!scanRes || !scanRes.success) {
            const errMsg = scanRes?.error?.message || (typeof scanRes?.error === 'string' ? scanRes.error : '') || 'Scan failed.';
            showStatus(errMsg, 'error');
            return;
          }
          if (scanRes.data) {
            updateElementCount(scanRes.data.totalElements);
          }
          const badgeRes = await chrome.runtime.sendMessage({ type: 'SHOW_BADGES' });
          if (badgeRes && badgeRes.success) {
            showStatus(`✓ Numbered badges displayed (${badgeRes.count || 0} elements).`, 'success');
          } else {
            const errMsg = badgeRes?.error?.message || (typeof badgeRes?.error === 'string' ? badgeRes.error : '') || 'Could not show badges.';
            showStatus(errMsg, 'error');
          }
        } catch (err) {
          showStatus(err.message || 'Failed to communicate with page.', 'error');
        }
      });
    }

    if (btnClearBadges) {
      btnClearBadges.addEventListener('click', async () => {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'CLEAR_BADGES' });
          if (res && res.success) {
            showStatus('✓ Badges cleared.', 'info');
          } else {
            const errMsg = res?.error?.message || (typeof res?.error === 'string' ? res.error : '') || 'Could not clear badges.';
            showStatus(errMsg, 'error');
          }
        } catch (err) {
          showStatus(err.message || 'Could not clear badges.', 'error');
        }
      });
    }

    if (btnRescan) {
      btnRescan.addEventListener('click', async () => {
        showStatus('Scanning page elements…');
        try {
          const res = await chrome.runtime.sendMessage({ type: 'SCAN_ELEMENTS' });
          if (res && res.success && res.data) {
            updateElementCount(res.data.totalElements);
            showStatus(`✓ Found ${res.data.totalElements} interactive elements.`, 'success');
          } else {
            const errMsg = res?.error?.message || (typeof res?.error === 'string' ? res.error : '') || 'Scan failed.';
            showStatus(errMsg, 'error');
          }
        } catch (err) {
          showStatus(err.message || 'Could not scan page.', 'error');
        }
      });
    }

    // Agent Goal Setup controls
    const stepsSlider = containerEl.querySelector('#agent-max-steps-slider');
    const stepsVal = containerEl.querySelector('#agent-max-steps-val');
    if (stepsSlider && stepsVal) {
      stepsSlider.addEventListener('input', () => {
        stepsVal.textContent = stepsSlider.value;
      });
    }

    const agentStartForm = containerEl.querySelector('#agent-start-form');
    if (agentStartForm) {
      agentStartForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const goalInput = containerEl.querySelector('#agent-goal-input');
        const dryRunCheck = containerEl.querySelector('#agent-dryrun-check');
        const goal = goalInput ? goalInput.value.trim() : '';
        const maxSteps = stepsSlider ? Number(stepsSlider.value) : 10;
        const dryRun = dryRunCheck ? dryRunCheck.checked : false;

        if (!goal) {
          if (goalInput) goalInput.focus();
          return;
        }

        startAgentTask(goal, maxSteps, dryRun);
      });
    }

    // Persistent Stop button
    const btnStop = containerEl.querySelector('#btn-agent-stop-persistent');
    if (btnStop) {
      btnStop.addEventListener('click', () => {
        stopAgentTask();
      });
    }

    // Reset button after completion
    const btnReset = containerEl.querySelector('#btn-agent-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        resetAgentTaskUI();
      });
    }

    // Find Element controls (Slice 3.3)
    const findForm = containerEl.querySelector('#find-element-form');
    const findInput = containerEl.querySelector('#find-element-input');
    const btnRehighlight = containerEl.querySelector('#btn-rehighlight');
    const btnCloseResult = containerEl.querySelector('#btn-close-find-result');
    const chipButtons = containerEl.querySelectorAll('.find-chip');

    if (findForm) {
      findForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = findInput ? findInput.value.trim() : '';
        if (!query) {
          if (findInput) findInput.focus();
          return;
        }
        executeFindElement(query);
      });
    }

    chipButtons.forEach((chip) => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (query && findInput) {
          findInput.value = query;
          executeFindElement(query);
        }
      });
    });

    if (btnRehighlight) {
      btnRehighlight.addEventListener('click', async () => {
        if (!lastMatchedElementId) return;
        try {
          await chrome.runtime.sendMessage({
            type: 'HIGHLIGHT_ELEMENT',
            payload: { elementId: lastMatchedElementId }
          });
        } catch (err) {}
      });
    }

    if (btnCloseResult) {
      btnCloseResult.addEventListener('click', () => {
        const resultCard = containerEl.querySelector('#find-result');
        if (resultCard) resultCard.style.display = 'none';
      });
    }
  }

  /**
   * Start an agent task.
   */
  async function startAgentTask(goal, maxSteps, dryRun) {
    const setupPanel = containerEl.querySelector('#agent-setup-panel');
    const activePanel = containerEl.querySelector('#agent-active-panel');
    const completionBanner = containerEl.querySelector('#agent-completion-banner');
    const historyBox = containerEl.querySelector('#agent-history-box');
    const cardContainer = containerEl.querySelector('#agent-action-card-container');

    if (setupPanel) setupPanel.style.display = 'none';
    if (completionBanner) completionBanner.style.display = 'none';
    if (historyBox) historyBox.style.display = 'none';
    if (cardContainer) cardContainer.innerHTML = '';
    if (activePanel) activePanel.style.display = 'block';

    const goalDisplay = containerEl.querySelector('#agent-goal-display');
    if (goalDisplay) goalDisplay.textContent = `Goal: "${goal}"`;

    const statusMsg = containerEl.querySelector('#agent-status-msg');
    if (statusMsg) statusMsg.textContent = 'Initializing agent…';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AGENT_START',
        payload: { goal, maxSteps, dryRun }
      });

      if (!res || !res.success) {
        const errMsg = res?.error?.message || (typeof res?.error === 'string' ? res.error : '') || 'Could not start agent task.';
        showAgentCompletion(false, errMsg);
      } else if (res.data) {
        updateAgentUI(res.data);
      }
    } catch (err) {
      console.error('[AgentView] Start agent error:', err);
      showAgentCompletion(false, err.message || 'Communication error starting agent.');
    }
  }

  /**
   * Handle user action approval.
   */
  async function onApproveAction(stepIndex, action) {
    const cardContainer = containerEl.querySelector('#agent-action-card-container');
    if (cardContainer) cardContainer.innerHTML = '';

    const statusMsg = containerEl.querySelector('#agent-status-msg');
    if (statusMsg) statusMsg.textContent = `Approved action for step ${stepIndex}. Advancing…`;

    const spinner = containerEl.querySelector('#agent-thinking-spinner');
    if (spinner) spinner.style.display = 'flex';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AGENT_APPROVE',
        payload: { stepIndex }
      });

      if (!res || !res.success) {
        showAgentCompletion(false, res?.error?.message || 'Error processing action approval.');
      } else if (res.data) {
        updateAgentUI(res.data);
      }
    } catch (err) {
      showAgentCompletion(false, err.message || 'Approval communication error.');
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  }

  /**
   * Handle user skipping action.
   */
  async function onSkipAction(stepIndex, action) {
    const cardContainer = containerEl.querySelector('#agent-action-card-container');
    if (cardContainer) cardContainer.innerHTML = '';

    const statusMsg = containerEl.querySelector('#agent-status-msg');
    if (statusMsg) statusMsg.textContent = `Action skipped. Re-querying AI for alternate step…`;

    const spinner = containerEl.querySelector('#agent-thinking-spinner');
    if (spinner) spinner.style.display = 'flex';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AGENT_SKIP',
        payload: { stepIndex }
      });

      if (!res || !res.success) {
        showAgentCompletion(false, res?.error?.message || 'Error processing action skip.');
      } else if (res.data) {
        updateAgentUI(res.data);
      }
    } catch (err) {
      showAgentCompletion(false, err.message || 'Skip communication error.');
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  }

  /**
   * Stop active agent task.
   */
  async function stopAgentTask() {
    try {
      await chrome.runtime.sendMessage({ type: 'AGENT_STOP' });
      showAgentCompletion(false, 'Task was stopped by user.');
    } catch (err) {
      showAgentCompletion(false, err.message || 'Could not stop task.');
    }
  }

  /**
   * Updates the UI based on agent state machine context.
   */
  function updateAgentUI(context) {
    if (!containerEl || !context) return;
    currentAgentState = context;

    const setupPanel = containerEl.querySelector('#agent-setup-panel');
    const activePanel = containerEl.querySelector('#agent-active-panel');
    const completionBanner = containerEl.querySelector('#agent-completion-banner');
    const stepCounter = containerEl.querySelector('#agent-step-counter');
    const statePill = containerEl.querySelector('#agent-state-pill');
    const statusMsg = containerEl.querySelector('#agent-status-msg');
    const goalDisplay = containerEl.querySelector('#agent-goal-display');
    const spinner = containerEl.querySelector('#agent-thinking-spinner');
    const cardContainer = containerEl.querySelector('#agent-action-card-container');

    const state = context.state;

    // IDLE
    if (state === 'IDLE') {
      if (setupPanel) setupPanel.style.display = 'block';
      if (activePanel) activePanel.style.display = 'none';
      if (completionBanner) completionBanner.style.display = 'none';
      renderActionLog(context);
      return;
    }

    // COMPLETED or CLEANUP with finish/error
    if (state === 'COMPLETED' || (state === 'CLEANUP' && context.error)) {
      showAgentCompletion(!context.error, context.statusMessage || (context.error ? 'Task ended with an error.' : 'Task completed successfully!'));
      renderActionLog(context);
      return;
    }

    // ACTIVE STATES: SCANNING, THINKING, SAFETY_CHECK, AWAITING_APPROVAL, EXECUTING
    if (setupPanel) setupPanel.style.display = 'none';
    if (completionBanner) completionBanner.style.display = 'none';
    if (activePanel) activePanel.style.display = 'block';

    if (stepCounter) {
      stepCounter.textContent = `Step ${context.stepCount} of ${context.maxSteps}`;
    }

    if (statePill) {
      statePill.textContent = state.replace(/_/g, ' ');
      statePill.className = `agent-state-pill state-${state.toLowerCase()}`;
    }

    if (statusMsg) {
      statusMsg.textContent = context.statusMessage || '';
    }

    if (goalDisplay && context.goal) {
      goalDisplay.textContent = `Goal: "${context.goal}"`;
    }

    // Spinner visibility
    if (spinner) {
      const isWorking = state === 'SCANNING' || state === 'THINKING' || state === 'SAFETY_CHECK' || state === 'EXECUTING';
      spinner.style.display = isWorking ? 'flex' : 'none';
      const spinnerText = containerEl.querySelector('#agent-spinner-text');
      if (spinnerText) {
        if (state === 'SCANNING') spinnerText.textContent = 'Scanning live elements…';
        else if (state === 'THINKING') spinnerText.textContent = 'Analyzing next action…';
        else if (state === 'SAFETY_CHECK') spinnerText.textContent = 'Checking action safety…';
        else if (state === 'EXECUTING') spinnerText.textContent = 'Executing action…';
      }
    }

    // Render ActionCard when awaiting approval
    if (state === 'AWAITING_APPROVAL' && context.currentAction && cardContainer) {
      cardContainer.innerHTML = '';
      if (window.ActionCard && typeof window.ActionCard.create === 'function') {
        const cardEl = window.ActionCard.create({
          action: context.currentAction,
          stepIndex: context.stepCount,
          maxSteps: context.maxSteps,
          dryRun: context.dryRun,
          onApprove: onApproveAction,
          onSkip: onSkipAction,
          onStop: stopAgentTask,
          onHighlight: (id) => {
            chrome.runtime.sendMessage({ type: 'HIGHLIGHT_ELEMENT', payload: { elementId: id } }).catch(() => {});
          }
        });
        cardContainer.appendChild(cardEl);
      }
    } else if (state !== 'AWAITING_APPROVAL' && cardContainer) {
      cardContainer.innerHTML = '';
    }

    // Update ActionLog (Slice 3.6)
    renderActionLog(context);
  }

  /**
   * Renders completion or abort banner.
   */
  function showAgentCompletion(isSuccess, message) {
    if (!containerEl) return;
    const activePanel = containerEl.querySelector('#agent-active-panel');
    const completionBanner = containerEl.querySelector('#agent-completion-banner');
    const completionIcon = containerEl.querySelector('#agent-completion-icon');
    const completionTitle = containerEl.querySelector('#agent-completion-title');
    const completionDesc = containerEl.querySelector('#agent-completion-desc');

    if (activePanel) activePanel.style.display = 'none';
    if (completionBanner) {
      completionBanner.style.display = 'flex';
      completionBanner.className = `agent-completion-banner ${isSuccess ? 'banner-success' : 'banner-stop'}`;
    }
    if (completionIcon) {
      completionIcon.textContent = isSuccess ? '✓' : '🛑';
    }
    if (completionTitle) {
      completionTitle.textContent = isSuccess ? 'Goal Completed' : 'Task Stopped';
    }
    if (completionDesc) {
      completionDesc.textContent = message || '';
    }
  }

  /**
   * Resets the agent UI back to setup form.
   */
  function resetAgentTaskUI() {
    if (!containerEl) return;
    const setupPanel = containerEl.querySelector('#agent-setup-panel');
    const activePanel = containerEl.querySelector('#agent-active-panel');
    const completionBanner = containerEl.querySelector('#agent-completion-banner');

    if (setupPanel) setupPanel.style.display = 'block';
    if (activePanel) activePanel.style.display = 'none';
    if (completionBanner) completionBanner.style.display = 'none';

    renderActionLog({ history: [], state: 'IDLE', dryRun: false });
    chrome.runtime.sendMessage({ type: 'AGENT_STOP' }).catch(() => {});
  }

  /**
   * Renders the ActionLog component (Slice 3.6).
   */
  function renderActionLog(context = {}) {
    if (!containerEl) return;
    const logContainer = containerEl.querySelector('#agent-action-log-container');
    if (!logContainer) return;

    if (window.ActionLog && typeof window.ActionLog.render === 'function') {
      window.ActionLog.render(logContainer, {
        history: context.history || [],
        isDryRun: Boolean(context.dryRun),
        status: context.state || 'IDLE'
      });
    }
  }

  /**
   * Executes the natural-language element search (Slice 3.3).
   */
  async function executeFindElement(query) {
    if (isSearching || !containerEl) return;
    isSearching = true;

    const findInput = containerEl.querySelector('#find-element-input');
    const btnSubmit = containerEl.querySelector('#btn-find-submit');
    const loadingArea = containerEl.querySelector('#find-loading');
    const resultArea = containerEl.querySelector('#find-result');
    const errorArea = containerEl.querySelector('#find-error');

    if (findInput) findInput.disabled = true;
    if (btnSubmit) btnSubmit.disabled = true;
    if (loadingArea) loadingArea.style.display = 'flex';
    if (resultArea) resultArea.style.display = 'none';
    if (errorArea) errorArea.style.display = 'none';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FIND_ELEMENT',
        payload: { query }
      });

      if (!response || !response.success) {
        const errMsg = response?.error?.message || (typeof response?.error === 'string' ? response.error : '') || 'Could not search elements on this page.';
        showError(errMsg);
        return;
      }

      const data = response.data;
      if (data && data.found && data.elementId) {
        lastMatchedElementId = data.elementId;
        displayFoundResult(data);
      } else {
        lastMatchedElementId = null;
        showError(data?.reasoning || 'Could not find a matching element on this page.');
      }
    } catch (err) {
      console.error('[AgentView] Find element error:', err);
      showError(err.message || 'An unexpected error occurred while searching for the element.');
    } finally {
      isSearching = false;
      if (findInput) findInput.disabled = false;
      if (btnSubmit) btnSubmit.disabled = false;
      if (loadingArea) loadingArea.style.display = 'none';
    }
  }

  function displayFoundResult(data) {
    if (!containerEl) return;
    const resultArea = containerEl.querySelector('#find-result');
    const badgePill = containerEl.querySelector('#find-badge-pill');
    const elementName = containerEl.querySelector('#find-element-name');
    const reasoningEl = containerEl.querySelector('#find-result-reasoning');
    const modelBadge = containerEl.querySelector('#find-model-badge');

    if (badgePill) badgePill.textContent = `#${data.elementId}`;
    if (elementName) {
      const el = data.element || {};
      const label = el.text || el.placeholder || el.name || el.value || el.tag || 'Element';
      const tag = (el.tag || '').toLowerCase();
      elementName.textContent = `"${label}" (${tag})`;
    }
    if (reasoningEl) reasoningEl.textContent = data.reasoning || `Element #${data.elementId} matches your query.`;
    if (modelBadge) {
      modelBadge.textContent = data.model ? `via ${data.model}` : '';
      modelBadge.style.display = data.model ? 'inline-block' : 'none';
    }
    if (resultArea) resultArea.style.display = 'block';
  }

  function showError(msg) {
    if (!containerEl) return;
    const errorArea = containerEl.querySelector('#find-error');
    const errorText = containerEl.querySelector('#find-error-text');
    if (errorText) errorText.textContent = msg;
    if (errorArea) errorArea.style.display = 'block';
  }

  function updateElementCount(count) {
    if (!containerEl) return;
    const badge = containerEl.querySelector('#agent-element-count');
    if (badge) {
      badge.textContent = `${count} elements`;
      badge.style.display = 'inline-block';
    }
  }

  function showStatus(msg, type = 'info') {
    if (!containerEl) return;
    const statusEl = containerEl.querySelector('#agent-scan-status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `agent-status-text agent-status-${type}`;
    statusEl.style.display = 'block';

    setTimeout(() => {
      if (statusEl.textContent === msg) {
        statusEl.style.display = 'none';
      }
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Export globally
  window.AgentView = {
    render,
    updateAgentUI,
    startAgentTask,
    stopAgentTask,
    executeFindElement
  };
})();
