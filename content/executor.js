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
   * Main execution dispatcher.
   * Resolves target element via SahayakScanner and runs appropriate synthetic events.
   *
   * @param {Object} action - BrowserAction
   * @returns {Object} { success: boolean, ... }
   */
  function execute(action) {
    if (!action || typeof action !== 'object') {
      throw new Error('Invalid action object provided to executor.');
    }

    const type = (action.action || '').toLowerCase();

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
    executeScroll
  };

  globalThis.SahayakExecutor = SahayakExecutor;
  if (typeof window !== 'undefined') {
    window.SahayakExecutor = SahayakExecutor;
  }
})();

