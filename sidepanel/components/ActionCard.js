/**
 * Sahayak — ActionCard Component (Slice 3.4)
 *
 * Renders a single proposed browser action card with:
 * - Step index & action summary (e.g. "Step 3: Type 'John Doe' into element #2")
 * - AI reasoning explanation
 * - Consequential action warning banner with mandatory confirmation checkbox
 * - [✓ Approve] (green), [→ Skip] (yellow), [✕ Stop] (red) buttons
 */

(function () {
  'use strict';

  /**
   * Generates a human-friendly description for a browser action.
   *
   * @param {Object} action - BrowserAction
   * @param {number} step - Current step number
   * @param {number} maxSteps - Max step limit
   * @returns {string}
   */
  function formatActionHeadline(action, step, maxSteps) {
    if (!action) return `Step ${step} of ${maxSteps}`;

    const stepLabel = `Step ${step}${maxSteps ? ` of ${maxSteps}` : ''}`;
    const type = (action.action || '').toLowerCase();
    const id = action.targetElementId;

    switch (type) {
      case 'click':
        return `${stepLabel}: Click element #${id}`;
      case 'type':
        return `${stepLabel}: Type "${action.value || ''}" into element #${id}`;
      case 'select':
        return `${stepLabel}: Select "${action.value || ''}" in element #${id}`;
      case 'scroll':
        return `${stepLabel}: Scroll page ${action.value || 'down'}`;
      case 'done':
        return `${stepLabel}: Task Complete`;
      default:
        return `${stepLabel}: Action on element #${id || 'page'}`;
    }
  }

  /**
   * Creates an ActionCard DOM element.
   *
   * @param {Object} options
   * @param {Object} options.action - BrowserAction object
   * @param {number} options.stepIndex - 1-based step counter
   * @param {number} options.maxSteps - Total step limit
   * @param {boolean} [options.dryRun=false] - Whether dry-run mode is enabled
   * @param {Function} options.onApprove - Callback when user approves action
   * @param {Function} options.onSkip - Callback when user skips action
   * @param {Function} options.onStop - Callback when user stops agent
   * @param {Function} [options.onHighlight] - Callback to highlight target element
   * @returns {HTMLElement}
   */
  function create(options) {
    const {
      action,
      stepIndex = 1,
      maxSteps = 10,
      dryRun = false,
      onApprove,
      onSkip,
      onStop,
      onHighlight
    } = options;

    const isBlocked = Boolean(action?.isBlocked);
    const isConsequential = Boolean(action?.isConsequential) && !isBlocked;
    const isDone = action?.action === 'done';

    let cardClasses = 'action-card';
    if (isBlocked) cardClasses += ' action-card-blocked';
    else if (isConsequential) cardClasses += ' action-card-consequential';

    const card = document.createElement('div');
    card.className = cardClasses;

    const headline = formatActionHeadline(action, stepIndex, maxSteps);

    card.innerHTML = `
      <div class="action-card-header">
        <div class="action-card-badge-row">
          <span class="action-step-badge">Step ${stepIndex}/${maxSteps}</span>
          <span class="action-type-pill action-type-${(action?.action || 'action').toLowerCase()}">
            ${(action?.action || 'action').toUpperCase()}
          </span>
          ${dryRun ? '<span class="action-dryrun-badge">Dry-Run</span>' : ''}
          ${isBlocked ? '<span class="action-blocked-badge">🛑 Blocked</span>' : ''}
        </div>
        ${action?.targetElementId ? `
          <button type="button" class="btn-highlight-target" title="Highlight element on page">
            ✨ Element #${action.targetElementId}
          </button>
        ` : ''}
      </div>

      <div class="action-headline">${headline}</div>

      ${action?.value && (action.action === 'type' || action.action === 'select') ? `
        <div class="action-value-box">
          <span class="action-value-label">Value:</span>
          <code class="action-value-text">${escapeHtml(action.value)}</code>
        </div>
      ` : ''}

      <div class="action-reasoning-box">
        <span class="action-reasoning-label">Reasoning:</span>
        <p class="action-reasoning-text">${escapeHtml(action?.reasoning || 'No reasoning provided.')}</p>
      </div>

      ${isBlocked ? `
        <div class="action-blocked-banner">
          <div class="blocked-header">
            <span class="blocked-icon">🛑</span>
            <strong>Action Blocked by Safety Rails</strong>
          </div>
          <p class="blocked-desc">
            ${escapeHtml(action?.blockedReason || 'Sahayak cannot perform this action for security and privacy reasons.')}
          </p>
        </div>
      ` : ''}

      ${isConsequential ? `
        <div class="action-consequential-banner">
          <div class="consequential-header">
            <span class="consequential-icon">⚠️</span>
            <strong>Consequential Action Detected</strong>
          </div>
          <p class="consequential-desc">
            This action looks like a Submit, Pay, Purchase, or Delete operation.
          </p>
          <label class="consequential-confirm-label">
            <input type="checkbox" id="consequential-confirm-check" class="consequential-check" />
            <span>I understand and confirm this action</span>
          </label>
        </div>
      ` : ''}

      <div class="action-card-actions">
        ${isBlocked ? `
          <button type="button" class="btn btn-action-skip">
            → Skip Action
          </button>
          <button type="button" class="btn btn-action-stop">
            ✕ Stop Task
          </button>
        ` : (isDone ? `
          <button type="button" class="btn btn-primary btn-complete-task" style="width: 100%;">
            ✓ Finish Task
          </button>
        ` : `
          <button type="button" class="btn btn-action-approve" ${isConsequential ? 'disabled' : ''}>
            ✓ Approve
          </button>
          <button type="button" class="btn btn-action-skip">
            → Skip
          </button>
          <button type="button" class="btn btn-action-stop">
            ✕ Stop
          </button>
        `)}
      </div>
    `;

    // DOM bindings
    const btnApprove = card.querySelector('.btn-action-approve');
    const btnSkip = card.querySelector('.btn-action-skip');
    const btnStop = card.querySelector('.btn-action-stop');
    const btnComplete = card.querySelector('.btn-complete-task');
    const btnHighlight = card.querySelector('.btn-highlight-target');
    const confirmCheck = card.querySelector('#consequential-confirm-check');

    // Consequential checkbox toggle
    if (confirmCheck && btnApprove) {
      confirmCheck.addEventListener('change', () => {
        btnApprove.disabled = !confirmCheck.checked;
      });
    }

    // Approve
    if (btnApprove) {
      btnApprove.addEventListener('click', () => {
        if (typeof onApprove === 'function') {
          onApprove(stepIndex, action);
        }
      });
    }

    // Finish (when action === 'done')
    if (btnComplete) {
      btnComplete.addEventListener('click', () => {
        if (typeof onApprove === 'function') {
          onApprove(stepIndex, action);
        }
      });
    }

    // Skip
    if (btnSkip) {
      btnSkip.addEventListener('click', () => {
        if (typeof onSkip === 'function') {
          onSkip(stepIndex, action);
        }
      });
    }

    // Stop
    if (btnStop) {
      btnStop.addEventListener('click', () => {
        if (typeof onStop === 'function') {
          onStop();
        }
      });
    }

    // Highlight
    if (btnHighlight && action?.targetElementId) {
      btnHighlight.addEventListener('click', () => {
        if (typeof onHighlight === 'function') {
          onHighlight(action.targetElementId);
        }
      });
    }

    return card;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Export
  window.ActionCard = {
    create,
    formatActionHeadline
  };
})();

