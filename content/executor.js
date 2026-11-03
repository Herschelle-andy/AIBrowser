/**
 * Sahayak — Action Executor (Slice 3.5)
 *
 * Dispatches realistic synthetic events (click, type, select, scroll) to DOM elements.
 * Uses native property descriptor setters to bypass framework (React/Vue/Angular)
 * value-tracking overrides and trigger framework-level change handlers.
 *
 * Architecture references: §11.4
 */

(function () {
  'use strict';

  /**
   * Executes a synthetic click on an interactive element.
   * Dispatches pointerdown, mousedown, pointerup, mouseup, and click.
   *
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  function executeClick(element) {
    if (!element || !element.isConnected) {
      throw new Error('Element is not connected to DOM.');
    }

    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    if (typeof element.focus === 'function') {
      element.focus();
    }

    const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: typeof window !== 'undefined' ? window : null,
      clientX,
      clientY,
      button: 0,
      buttons: 1
    };

    const eventSequence = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

    for (const type of eventSequence) {
      let evt = null;
      try {
        if (type.startsWith('pointer') && typeof PointerEvent !== 'undefined') {
          evt = new PointerEvent(type, eventInit);
        } else if (typeof MouseEvent !== 'undefined') {
          evt = new MouseEvent(type, eventInit);
        } else {
          evt = new Event(type, { bubbles: true, cancelable: true });
        }
      } catch (e) {
        evt = new Event(type, { bubbles: true, cancelable: true });
      }

      element.dispatchEvent(evt);
    }

    return true;
  }

  /**
   * Executes typing a string value into an input, textarea, or contenteditable.
   * Uses native property descriptor setter to bypass React/Vue property overrides.
   * Dispatches 'input' and 'change' events with bubbles: true.
   *
   * @param {HTMLElement} element
   * @param {string} value
   * @returns {boolean}
   */
  function executeType(element, value) {
    if (!element || !element.isConnected) {
      throw new Error('Element is not connected to DOM.');
    }

    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    if (typeof element.focus === 'function') {
      element.focus();
    }

    const strValue = String(value !== undefined && value !== null ? value : '');
    const tag = (element.tagName || '').toUpperCase();

    // If target is a SELECT element, delegate to select executor
    if (tag === 'SELECT') {
      return executeSelect(element, strValue);
    }

    // Rich text / contenteditable
    if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
      element.textContent = strValue;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // Input / Textarea: use prototype setter to bypass framework internal trackers (React 16+)
    let nativeSetter = null;
    try {
      if (tag === 'INPUT' && typeof window !== 'undefined' && window.HTMLInputElement) {
        nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      } else if (tag === 'TEXTAREA' && typeof window !== 'undefined' && window.HTMLTextAreaElement) {
        nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      }
    } catch (e) {}

    if (nativeSetter) {
      nativeSetter.call(element, strValue);
    } else {
      element.value = strValue;
    }

    // Fire the event sequence frameworks listen for
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * Selects an option in a <select> element by value, label, or index.
   *
   * @param {HTMLSelectElement} selectElement
   * @param {string} value
   * @returns {boolean}
   */
  function executeSelect(selectElement, value) {
    if (!selectElement || !selectElement.isConnected) {
      throw new Error('Select element is not connected to DOM.');
    }

    if (typeof selectElement.scrollIntoView === 'function') {
      selectElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    if (typeof selectElement.focus === 'function') {
      selectElement.focus();
    }

    const strVal = String(value !== undefined && value !== null ? value : '').trim();
    let matched = false;

    if (selectElement.options && selectElement.options.length > 0) {
      // 1. Exact value match
      for (let i = 0; i < selectElement.options.length; i++) {
        if (selectElement.options[i].value === strVal) {
          selectElement.selectedIndex = i;
          matched = true;
          break;
        }
      }

      // 2. Exact text match
      if (!matched) {
        for (let i = 0; i < selectElement.options.length; i++) {
          if (selectElement.options[i].text.trim() === strVal) {
            selectElement.selectedIndex = i;
            matched = true;
            break;
          }
        }
      }

      // 3. Case-insensitive substring match
      if (!matched) {
        const lower = strVal.toLowerCase();
        for (let i = 0; i < selectElement.options.length; i++) {
          const optText = selectElement.options[i].text.toLowerCase();
          const optVal = selectElement.options[i].value.toLowerCase();
          if (optText.includes(lower) || optVal.includes(lower)) {
            selectElement.selectedIndex = i;
            matched = true;
            break;
          }
        }
      }
    }

    if (!matched) {
      let nativeSetter = null;
      try {
        if (typeof window !== 'undefined' && window.HTMLSelectElement) {
          nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
        }
      } catch (e) {}

      if (nativeSetter) {
        nativeSetter.call(selectElement, strVal);
      } else {
        selectElement.value = strVal;
      }
    }

    selectElement.dispatchEvent(new Event('input', { bubbles: true }));
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * Scrolls the page smoothly up or down.
   *
   * @param {'up'|'down'|number} direction
   * @returns {boolean}
   */
  function executeScroll(direction) {
    let delta = 400;
    if (typeof direction === 'number') {
      delta = direction;
    } else if (direction === 'up') {
      delta = -400;
    } else {
      delta = 400;
    }

    if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
      window.scrollBy({ top: delta, behavior: 'smooth' });
    }
    return true;
  }

  /**
   * Shows a floating toast message on the webpage (for Dry-Run feedback).
   * @param {string} message
   */
  function showDryRunToast(message) {
    if (typeof document === 'undefined' || !document.createElement) return;

    let toast = document.getElementById('sahayak-dryrun-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sahayak-dryrun-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: #4a148c;
        color: #ffffff;
        padding: 10px 20px;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        border: 1px solid #ba68c8;
        pointer-events: none;
        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
        opacity: 0;
      `;
      (document.body || document.documentElement).appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(8px)';
    }, 2800);
  }

  /**
   * Applies pulsing purple border highlight to an element for dry-run mode (§11.5).
   * @param {HTMLElement} element
   */
  function applyDryRunHighlight(element) {
    if (!element) return;

    if (typeof document !== 'undefined' && document.createElement && !document.getElementById('sahayak-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'sahayak-pulse-style';
      style.textContent = `
        @keyframes sahayak-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(156, 39, 176, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(156, 39, 176, 0.8); }
        }
        .sahayak-dryrun-pulse {
          animation: sahayak-pulse 1.2s infinite ease-in-out !important;
          outline: 2px solid #9c27b0 !important;
          outline-offset: 2px !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    if (typeof document !== 'undefined' && document.querySelectorAll) {
      const prev = document.querySelectorAll('.sahayak-dryrun-pulse');
      prev.forEach((el) => el.classList.remove('sahayak-dryrun-pulse'));
    }

    if (element.classList && typeof element.classList.add === 'function') {
      element.classList.add('sahayak-dryrun-pulse');
    }
  }

  /**
   * Main execution dispatcher.
   * Resolves target element via SahayakScanner and runs appropriate synthetic events.
   * If action.dryRun is active, highlights element and displays toast without firing events (§11.5).
   *
   * @param {Object} action - BrowserAction
   * @returns {Object} { success: boolean, ... }
   */
  function execute(action) {
    if (!action || typeof action !== 'object') {
      throw new Error('Invalid action object provided to executor.');
    }

    const type = (action.action || '').toLowerCase();
    const isDryRun = Boolean(action.dryRun || action.isDryRun);

    // ── Dry-Run Mode Handler (§11.5) ──────────────────────────
    if (isDryRun) {
      if (type === 'done') {
        showDryRunToast('Dry Run — Task Complete');
        return { success: true, executed: false, dryRun: true, action: 'done' };
      }

      if (type === 'scroll') {
        const scrollDir = action.value || 'down';
        showDryRunToast(`Dry Run — would scroll ${scrollDir}`);
        return { success: true, executed: false, dryRun: true, action: 'scroll', value: scrollDir };
      }

      const elementId = action.targetElementId;
      if (!elementId) {
        throw new Error(`Action "${type}" requires targetElementId.`);
      }

      const scanner = globalThis.SahayakScanner || (typeof SahayakScanner !== 'undefined' ? SahayakScanner : null) || (typeof window !== 'undefined' ? window.SahayakScanner : null);
      if (!scanner || typeof scanner.getElement !== 'function') {
        throw new Error('SahayakScanner module is not available to resolve elements.');
      }

      const element = scanner.getElement(elementId);
      if (!element || !element.isConnected) {
        throw new Error(`Element #${elementId} is not found on the page or was detached.`);
      }

      if (typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }

      applyDryRunHighlight(element);

      let toastText = '';
      if (type === 'type') {
        toastText = `Dry Run — would type '${action.value || ''}' into element #${elementId}`;
      } else if (type === 'click') {
        toastText = `Dry Run — would click element #${elementId}`;
      } else if (type === 'select') {
        toastText = `Dry Run — would select '${action.value || ''}' in element #${elementId}`;
      } else {
        toastText = `Dry Run — would perform ${type} on element #${elementId}`;
      }

      showDryRunToast(toastText);

      return {
        success: true,
        executed: false,
        dryRun: true,
        action: type,
        elementId,
        value: action.value
      };
    }

    // ── Live Execution Mode ───────────────────────────────────
    if (type === 'done') {
      return { success: true, action: 'done', reasoning: action.reasoning || 'Goal completed' };
    }

    if (type === 'scroll') {
      executeScroll(action.value || 'down');
      return { success: true, action: 'scroll', value: action.value || 'down' };
    }

    const elementId = action.targetElementId;
    if (!elementId) {
      throw new Error(`Action "${type}" requires targetElementId.`);
    }

    const scanner = globalThis.SahayakScanner || (typeof SahayakScanner !== 'undefined' ? SahayakScanner : null) || (typeof window !== 'undefined' ? window.SahayakScanner : null);
    if (!scanner || typeof scanner.getElement !== 'function') {
      throw new Error('SahayakScanner module is not available to resolve elements.');
    }

    const element = scanner.getElement(elementId);
    if (!element || !element.isConnected) {
      throw new Error(`Element #${elementId} is not found on the page or was detached.`);
    }

    switch (type) {
      case 'click':
        executeClick(element);
        return { success: true, action: 'click', elementId };

      case 'type':
        executeType(element, action.value || '');
        return { success: true, action: 'type', elementId, value: action.value };

      case 'select':
        executeSelect(element, action.value || '');
        return { success: true, action: 'select', elementId, value: action.value };

      default:
        throw new Error(`Unsupported action type: "${type}"`);
    }
  }

  // Export module globally in content script scope
  const SahayakExecutor = {
    execute,
    executeClick,
    executeType,
    executeSelect,
    executeScroll,
    showDryRunToast,
    applyDryRunHighlight
  };

  globalThis.SahayakExecutor = SahayakExecutor;
  if (typeof window !== 'undefined') {
    window.SahayakExecutor = SahayakExecutor;
  }
})();

