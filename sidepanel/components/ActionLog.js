/**
 * Sahayak — ActionLog Component (Slice 3.6)
 *
 * Displays a scrollable, inspectable audit log of all browser agent actions,
 * including step numbers, proposed actions, AI reasoning, user decisions
 * (approved / skipped / stopped), execution status (live vs dry-run),
 * and past task history from chrome.storage.local.
 *
 * Architecture references: §11.5, §15
 */

(function () {
  'use strict';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTime(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function formatActionHeadline(action) {
    if (!action) return 'Action';
    const type = (action.action || '').toLowerCase();
    const id = action.targetElementId;

    switch (type) {
      case 'click':
        return `Click element #${id}`;
      case 'type':
        return `Type "${escapeHtml(action.value || '')}" into element #${id}`;
      case 'select':
        return `Select "${escapeHtml(action.value || '')}" in element #${id}`;
      case 'scroll':
        return `Scroll page ${action.value || 'down'}`;
      case 'done':
        return 'Task Complete';
      default:
        return `${type} on element #${id || 'page'}`;
    }
  }

  /**
   * Renders the ActionLog component inside a container.
   *
   * @param {HTMLElement} container
   * @param {Object} options
   * @param {Array<Object>} [options.history=[]] - Current task history entries
   * @param {boolean} [options.isDryRun=false] - Whether current task is dry-run
   * @param {string} [options.status=''] - Current agent status
   * @param {Function} [options.onClearHistory] - Callback to clear past history
   * @returns {HTMLElement}
   */
  function render(container, options = {}) {
    if (!container) return null;

    const history = Array.isArray(options.history) ? options.history : [];
    const isDryRun = Boolean(options.isDryRun);

    container.innerHTML = `
      <div class="sahayak-action-log">
        <div class="action-log-header">
          <div class="action-log-title-row">
            <span class="action-log-title">📋 Action Audit Log</span>
            <span class="action-log-count">${history.length} step${history.length === 1 ? '' : 's'}</span>
          </div>
          <div class="action-log-tabs">
            <button class="log-tab-btn active" data-tab="current">Current Task</button>
            <button class="log-tab-btn" data-tab="past">Past Sessions</button>
          </div>
        </div>

        <!-- 1. Current Task Step List -->
        <div id="log-view-current" class="log-tab-content active">
          ${history.length === 0 ? `
            <div class="action-log-empty">
              <span>No actions logged yet in this task.</span>
            </div>
          ` : `
            <ul class="action-log-list">
              ${history.map((entry) => {
                const act = entry.action || {};
                const type = (act.action || 'action').toUpperCase();
                const stepNum = entry.step || 1;
                const decision = entry.decision || 'approved';
                const isEntryDryRun = Boolean(entry.dryRun || isDryRun);
                const executed = Boolean(entry.executed && !isEntryDryRun);

                let statusBadge = '';
                if (isEntryDryRun) {
                  statusBadge = '<span class="log-tag tag-dryrun">Dry Run</span>';
                } else if (executed) {
                  statusBadge = '<span class="log-tag tag-executed">Executed</span>';
                } else if (decision === 'skipped') {
                  statusBadge = '<span class="log-tag tag-skipped">Skipped</span>';
                } else {
                  statusBadge = '<span class="log-tag tag-simulated">Logged</span>';
                }

                let decisionClass = 'decision-approved';
                if (decision === 'skipped') decisionClass = 'decision-skipped';
                if (decision === 'stopped') decisionClass = 'decision-stopped';

                return `
                  <li class="action-log-item">
                    <div class="log-item-top">
                      <div class="log-item-left">
                        <span class="log-step-badge">#${stepNum}</span>
                        <span class="log-action-type">${type}</span>
                        ${statusBadge}
                      </div>
                      <div class="log-item-right">
                        <span class="log-decision ${decisionClass}">${decision}</span>
                        <span class="log-time">${formatTime(entry.timestamp)}</span>
                      </div>
                    </div>
                    <div class="log-item-headline">${formatActionHeadline(act)}</div>
                    ${act.reasoning ? `
                      <div class="log-item-reasoning">
                        <em>💡 ${escapeHtml(act.reasoning)}</em>
                      </div>
                    ` : ''}
                  </li>
                `;
              }).join('')}
            </ul>
          `}
        </div>

        <!-- 2. Past Saved Sessions -->
        <div id="log-view-past" class="log-tab-content" style="display: none;">
          <div class="past-sessions-toolbar">
            <span class="past-sessions-label">Completed Tasks</span>
            <button id="btn-clear-past-history" class="btn btn-secondary btn-sm" title="Clear all saved task logs">
              🗑️ Clear
            </button>
          </div>
          <div id="past-sessions-list" class="past-sessions-container">
            <div class="action-log-empty">Loading history…</div>
          </div>
        </div>
      </div>
    `;

    bindTabEvents(container, options);
    return container;
  }

  /**
   * Binds tab switching and history loading.
   */
  function bindTabEvents(container, options) {
    const tabBtns = container.querySelectorAll('.log-tab-btn');
    const viewCurrent = container.querySelector('#log-view-current');
    const viewPast = container.querySelector('#log-view-past');
    const pastContainer = container.querySelector('#past-sessions-list');
    const btnClear = container.querySelector('#btn-clear-past-history');

    tabBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.getAttribute('data-tab');
        if (tab === 'current') {
          if (viewCurrent) viewCurrent.style.display = 'block';
          if (viewPast) viewPast.style.display = 'none';
        } else {
          if (viewCurrent) viewCurrent.style.display = 'none';
          if (viewPast) viewPast.style.display = 'block';
          await loadPastSessions(pastContainer);
        }
      });
    });

    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        try {
          if (chrome.runtime && chrome.runtime.sendMessage) {
            await chrome.runtime.sendMessage({ type: 'CLEAR_TASK_HISTORY' });
          } else if (chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove('sahayak_action_history');
          }
          if (pastContainer) {
            pastContainer.innerHTML = '<div class="action-log-empty">Task history cleared.</div>';
          }
        } catch (e) {
          console.warn('[ActionLog] Clear history error:', e);
        }
      });
    }
  }

  /**
   * Loads and renders past task sessions from storage.
   */
  async function loadPastSessions(container) {
    if (!container) return;

    let historyList = [];
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        const res = await chrome.runtime.sendMessage({ type: 'GET_TASK_HISTORY' });
        if (res && res.success && Array.isArray(res.data)) {
          historyList = res.data;
        }
      } else if (chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get('sahayak_action_history');
        if (Array.isArray(stored.sahayak_action_history)) {
          historyList = stored.sahayak_action_history;
        }
      }
    } catch (err) {
      console.warn('[ActionLog] Could not load past task history:', err);
    }

    if (!historyList || historyList.length === 0) {
      container.innerHTML = '<div class="action-log-empty">No past sessions recorded yet.</div>';
      return;
    }

    container.innerHTML = historyList.map((task) => {
      const goal = escapeHtml(task.goal || 'No goal stated');
      const stepsCount = Array.isArray(task.steps) ? task.steps.length : (task.totalSteps || 0);
      const isDry = Boolean(task.dryRun);
      const status = task.status || 'completed';
      const dateStr = task.savedAt ? new Date(task.savedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

      let statusBadge = '<span class="log-tag tag-executed">Completed</span>';
      if (status === 'stopped') statusBadge = '<span class="log-tag tag-stopped">Stopped</span>';
      if (status === 'limit_reached') statusBadge = '<span class="log-tag tag-skipped">Limit Reached</span>';

      return `
        <div class="past-session-card">
          <div class="past-session-top">
            <strong class="past-session-goal">"${goal}"</strong>
            <span class="past-session-date">${dateStr}</span>
          </div>
          <div class="past-session-meta">
            ${statusBadge}
            ${isDry ? '<span class="log-tag tag-dryrun">Dry Run</span>' : ''}
            <span class="past-session-steps">${stepsCount} step${stepsCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Export globally
  const ActionLog = {
    render
  };

  globalThis.ActionLog = ActionLog;
  if (typeof window !== 'undefined') {
    window.ActionLog = ActionLog;
  }
})();

