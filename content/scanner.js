/**
 * Sahayak — Interactive Element Scanner
 *
 * Scans the live DOM for interactive elements (links, buttons, inputs, etc.),
 * applies visibility and occlusion filters, assigns sequential IDs, and
 * builds a PageActionMap schema for agent execution.
 *
 * Architecture references: §10.1–10.4
 */

(function () {
  'use strict';

  // Interactive element selectors as defined in §10.2
  const INTERACTIVE_SELECTORS = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="tab"]',
    '[role="switch"]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ];

  const SELECTOR_STRING = INTERACTIVE_SELECTORS.join(', ');

  // Module-scope Map storing element references: id (number) -> HTMLElement
  // Survives until the next scan
  const elementMap = new Map();

  /**
   * Cleans and truncates a string for action map representation.
   * @param {string} str
   * @param {number} maxLen
   * @returns {string}
   */
  function cleanText(str, maxLen = 80) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/\s+/g, ' ').trim().substring(0, maxLen);
  }

  /**
   * Derives human-meaningful text for an interactive element.
   * Checks aria attributes, associated labels, values, inner text, titles, and alt text.
   * @param {HTMLElement} el
   * @returns {string}
   */
  function getElementText(el) {
    // 1. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      return cleanText(ariaLabel);
    }

    // 2. aria-labelledby
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const ids = ariaLabelledBy.split(/\s+/);
      const texts = ids
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(node => node.textContent || '')
        .join(' ');
      if (texts.trim()) {
        return cleanText(texts);
      }
    }

    // 3. Associated <label> for form inputs
    if (el.labels && el.labels.length > 0) {
      for (let i = 0; i < el.labels.length; i++) {
        const lbl = el.labels[i];
        if (lbl && lbl.textContent && lbl.textContent.trim()) {
          return cleanText(lbl.textContent);
        }
      }
    }

    if (el.id) {
      try {
        const labelFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelFor && labelFor.textContent && labelFor.textContent.trim()) {
          return cleanText(labelFor.textContent);
        }
      } catch (e) {
        // Fallback for unexpected selector characters
      }
    }

    const tag = (el.tagName || '').toUpperCase();

    // 4. Special input button values
    if (tag === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type) && el.value) {
        return cleanText(el.value);
      }
      if (el.placeholder) {
        return cleanText(el.placeholder);
      }
    }

    // 5. Select element selected option
    if (tag === 'SELECT') {
      if (el.options && el.selectedIndex >= 0 && el.options[el.selectedIndex]) {
        const optText = el.options[el.selectedIndex].text;
        if (optText && optText.trim()) {
          return cleanText(optText);
        }
      }
    }

    // 6. Direct innerText / textContent
    const raw = el.innerText || el.textContent || '';
    if (raw.trim()) {
      return cleanText(raw);
    }

    // 7. title attribute
    const title = el.getAttribute('title');
    if (title && title.trim()) {
      return cleanText(title);
    }

    // 8. Image alt attribute within the element
    const img = el.querySelector('img[alt]');
    if (img) {
      const alt = img.getAttribute('alt');
      if (alt && alt.trim()) {
        return cleanText(alt);
      }
    }

    return '';
  }

  /**
   * Visibility filter: ensures element is not hidden via display:none or unrendered parent.
   * Handles fixed/sticky elements whose offsetParent is null in standard DOM.
   * @param {HTMLElement} el
   * @param {CSSStyleDeclaration} style
   * @returns {boolean}
   */
  function isNotHidden(el, style) {
    if (style.display === 'none') return false;

    // Standard offsetParent check
    if (el.offsetParent !== null) return true;

    // In modern browsers, elements with position: fixed/sticky or inside fixed/sticky parents
    // can have offsetParent === null even though they are visible.
    if (style.position === 'fixed' || style.position === 'sticky') return true;

    let parent = el.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const pStyle = window.getComputedStyle(parent);
      if (pStyle.display === 'none') return false;
      if (pStyle.position === 'fixed' || pStyle.position === 'sticky') return true;
      parent = parent.parentElement;
    }

    return false;
  }

  /**
   * Visibility filter: checks visibility, opacity, disabled state, and bounding box size.
   * @param {HTMLElement} el
   * @returns {{ pass: boolean, rect?: DOMRect, style?: CSSStyleDeclaration }}
   */
  function checkElementVisibility(el) {
    if (!el || !el.isConnected) return { pass: false };

    // Not disabled
    if (el.disabled) return { pass: false };
    if (el.getAttribute('aria-disabled') === 'true') return { pass: false };
    if (el.closest('fieldset:disabled')) return { pass: false };

    // Inert or hidden from accessibility tree
    if (el.closest('[inert]')) return { pass: false };
    if (el.closest('[aria-hidden="true"]')) return { pass: false };

    let style;
    try {
      style = window.getComputedStyle(el);
    } catch (e) {
      return { pass: false };
    }

    if (!style) return { pass: false };

    // 1. Display none & offsetParent check
    if (!isNotHidden(el, style)) return { pass: false };

    // 2. Visibility
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return { pass: false };

    // 3. Opacity > 0.05
    const opacity = parseFloat(style.opacity || '1');
    if (isNaN(opacity) || opacity <= 0.05) return { pass: false };

    // 4. Pointer events
    if (style.pointerEvents === 'none') return { pass: false };

    // 5. Size check: rect.width > 4 && rect.height > 4
    const rect = el.getBoundingClientRect();
    if (rect.width <= 4 || rect.height <= 4) return { pass: false };

    return { pass: true, rect, style };
  }

  /**
   * Occlusion check: ensures element is not completely occluded by overlays, modals,
   * or floating backdrops using document.elementFromPoint.
   * @param {HTMLElement} el
   * @param {DOMRect} rect
   * @returns {boolean}
   */
  function isNotOccluded(el, rect) {
    const vpWidth = window.innerWidth || document.documentElement.clientWidth;
    const vpHeight = window.innerHeight || document.documentElement.clientHeight;

    // Check if element intersects current visible viewport
    const inViewport = (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < vpHeight &&
      rect.left < vpWidth
    );

    // If completely outside the viewport, elementFromPoint will return null.
    // Return true for offscreen elements unless there is an active modal/dialog blocking the page.
    if (!inViewport) {
      const activeModal = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], .modal.show');
      if (activeModal && !activeModal.contains(el)) {
        return false;
      }
      return true;
    }

    // Sample center point
    const cx = Math.max(0, Math.min(vpWidth - 1, rect.left + rect.width / 2));
    const cy = Math.max(0, Math.min(vpHeight - 1, rect.top + rect.height / 2));

    const topEl = document.elementFromPoint(cx, cy);
    if (!topEl) return true;

    // Ignore Sahayak overlay container if present
    if (topEl.tagName && topEl.tagName.toLowerCase() === 'sahayak-overlay') {
      return true;
    }

    // Passed if top element is the element itself, a descendant of it, or an ancestor
    if (topEl === el || el.contains(topEl) || topEl.contains(el)) {
      return true;
    }

    // Associated label check
    if (topEl.tagName === 'LABEL' && (topEl.htmlFor === el.id || topEl.contains(el))) {
      return true;
    }

    // Check corner sample points in case the center point was hit by an internal icon/decoration
    const samplePoints = [
      [Math.max(0, Math.min(vpWidth - 1, rect.left + Math.min(8, rect.width / 3))),
       Math.max(0, Math.min(vpHeight - 1, rect.top + Math.min(8, rect.height / 3)))],
      [Math.max(0, Math.min(vpWidth - 1, rect.right - Math.min(8, rect.width / 3))),
       Math.max(0, Math.min(vpHeight - 1, rect.bottom - Math.min(8, rect.height / 3)))]
    ];

    for (const [sx, sy] of samplePoints) {
      const ptEl = document.elementFromPoint(sx, sy);
      if (!ptEl) continue;
      if (ptEl === el || el.contains(ptEl) || ptEl.contains(el)) {
        return true;
      }
      if (ptEl.tagName === 'LABEL' && (ptEl.htmlFor === el.id || ptEl.contains(el))) {
        return true;
      }
    }

    // Occluded by an overlay or modal
    return false;
  }

  /**
   * Determines if an element is a redundant child of another interactive element.
   * E.g. a <span role="button"> inside a <button>, or [tabindex] inside an <a>.
   * Inputs, textareas, and selects are never considered redundant.
   * @param {HTMLElement} el
   * @param {Set<HTMLElement>} qualifyingSet
   * @returns {boolean}
   */
  function isRedundantChild(el, qualifyingSet) {
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return false;
    }

    let parent = el.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (qualifyingSet.has(parent)) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  /**
   * Scans the document for all visible and interactive elements.
   * Updates the internal element map and returns a PageActionMap.
   *
   * @returns {Object} PageActionMap
   */
  function scan() {
    elementMap.clear();

    const rawCandidates = Array.from(document.querySelectorAll(SELECTOR_STRING));
    const qualifyingElements = [];
    const qualifyingSet = new Set();

    // First pass: filter by visibility and occlusion
    for (const el of rawCandidates) {
      const vis = checkElementVisibility(el);
      if (!vis.pass) continue;

      if (!isNotOccluded(el, vis.rect)) continue;

      qualifyingElements.push(el);
      qualifyingSet.add(el);
    }

    // Prioritize form controls, buttons, and summary elements ahead of generic links (§10.2)
    qualifyingElements.sort((a, b) => {
      const isControlA = ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(a.tagName);
      const isControlB = ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(b.tagName);
      if (isControlA && !isControlB) return -1;
      if (!isControlA && isControlB) return 1;
      return 0;
    });

    // Second pass: remove redundant child elements and build schema items
    const elements = [];
    let badgeId = 1;
    const MAX_SCANNED_ELEMENTS = 250;

    for (const el of qualifyingElements) {
      if (elements.length >= MAX_SCANNED_ELEMENTS) {
        break;
      }

      if (isRedundantChild(el, qualifyingSet)) {
        continue;
      }

      const id = badgeId++;
      elementMap.set(id, el);

      const tag = (el.tagName || '').toUpperCase();
      const type = (el.type ? el.type.toLowerCase() : (tag === 'INPUT' ? 'text' : undefined));
      const role = el.getAttribute('role') || undefined;
      const text = getElementText(el);
      const placeholder = el.placeholder || el.getAttribute('placeholder') || undefined;
      const name = el.name || el.id || el.getAttribute('name') || undefined;

      let value;
      if (type === 'password') {
        value = undefined; // Never expose password contents
      } else if (el.value !== undefined && el.value !== '') {
        value = cleanText(String(el.value), 80);
      } else if (tag === 'SELECT' && el.options && el.selectedIndex >= 0) {
        value = cleanText(el.options[el.selectedIndex]?.text || String(el.value), 80);
      }

      let checked;
      if (type === 'checkbox' || type === 'radio') {
        checked = Boolean(el.checked);
      }

      let href;
      if (tag === 'A' && el.href) {
        href = cleanText(el.getAttribute('href') || el.href, 120);
      }

      const item = {
        id,
        tag,
        disabled: false
      };

      if (type !== undefined) item.type = type;
      if (role !== undefined) item.role = role;
      item.text = text;
      if (placeholder !== undefined) item.placeholder = placeholder;
      if (name !== undefined) item.name = name;
      if (value !== undefined) item.value = value;
      if (checked !== undefined) item.checked = checked;
      if (href !== undefined) item.href = href;

      elements.push(item);
    }

    const actionMap = {
      url: window.location.href || '',
      title: document.title || '',
      totalElements: elements.length,
      elements,
      scannedAt: Date.now()
    };

    console.log(`[Sahayak Scanner] Scanned ${elements.length} interactive elements on "${actionMap.title}"`);
    return actionMap;
  }

  /**
   * Retrieves an HTMLElement reference by its sequential ID.
   * @param {number} id
   * @returns {HTMLElement|null}
   */
  function getElement(id) {
    return elementMap.get(Number(id)) || null;
  }

  /**
   * Returns a copy of the current element map.
   * @returns {Map<number, HTMLElement>}
   */
  function getElementMap() {
    return new Map(elementMap);
  }

  /**
   * Clears the cached element map.
   */
  function clear() {
    elementMap.clear();
  }

  // Export globally in content script scope
  const SahayakScanner = {
    scan,
    getElement,
    getElementMap,
    clear,
    checkElementVisibility,
    isNotOccluded
  };

  globalThis.SahayakScanner = SahayakScanner;
  if (typeof window !== 'undefined') {
    window.SahayakScanner = SahayakScanner;
  }
})();

