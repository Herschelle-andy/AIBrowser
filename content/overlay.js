/**
 * Sahayak — Shadow DOM Numbered Badges & Highlight Overlay
 *
 * Injects numbered badges inside an isolated closed Shadow DOM overlay
 * positioned over interactive elements for visual verification.
 *
 * Architecture references: §10.5
 */

(function () {
  'use strict';

  // Constants
  const OVERLAY_TAG = 'sahayak-overlay';

  // Module-scoped state
  let overlayHost = null;
  let shadowRoot = null;
  let activeBadges = new Map(); // id -> { id, element, badgeEl }
  let activeHighlight = null;   // { id, element, highlightEl }
  let isRepositioning = false;
  let listenersAttached = false;

  /**
   * Scoped CSS injected into the closed Shadow DOM.
   * Completely isolated from host page styles.
   */
  const OVERLAY_STYLES = `
    :host {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      overflow: visible;
      pointer-events: none;
      z-index: 2147483647;
    }

    .sahayak-badge {
      position: absolute;
      z-index: 2147483647;
      pointer-events: none;
      background: #1A237E;
      color: #FFC107;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace, sans-serif;
      font-weight: 700;
      font-size: 11px;
      line-height: 1;
      padding: 2px 5px;
      border-radius: 3px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
      user-select: none;
      white-space: nowrap;
      transform: translate(-3px, -5px);
      box-sizing: border-box;
      border: 1px solid rgba(255, 193, 7, 0.4);
      transition: transform 0.12s ease-out, background 0.15s ease-out;
    }

    .sahayak-badge-highlighted {
      background: #D32F2F !important;
      color: #FFFFFF !important;
      border: 1px solid #FFCDD2 !important;
      transform: translate(-3px, -5px) scale(1.18);
      box-shadow: 0 2px 6px rgba(211, 47, 47, 0.6) !important;
    }

    .sahayak-highlight {
      position: absolute;
      z-index: 2147483646;
      pointer-events: none;
      border: 3px solid #FF9800;
      border-radius: 4px;
      box-sizing: border-box;
      box-shadow: 0 0 10px rgba(255, 152, 0, 0.8), inset 0 0 8px rgba(255, 152, 0, 0.35);
      animation: sahayak-pulse 1.2s infinite ease-in-out;
      transition: top 0.12s ease-out, left 0.12s ease-out, width 0.12s ease-out, height 0.12s ease-out;
    }

    @keyframes sahayak-pulse {
      0% {
        box-shadow: 0 0 6px rgba(255, 152, 0, 0.7);
        border-color: #FF9800;
      }
      50% {
        box-shadow: 0 0 16px rgba(255, 87, 34, 0.95), inset 0 0 10px rgba(255, 87, 34, 0.4);
        border-color: #FF5722;
      }
      100% {
        box-shadow: 0 0 6px rgba(255, 152, 0, 0.7);
        border-color: #FF9800;
      }
    }
  `;

  /**
   * Creates or retrieves the closed Shadow DOM overlay container.
   * @returns {ShadowRoot}
   */
  function ensureOverlay() {
    if (overlayHost && overlayHost.isConnected && shadowRoot) {
      return shadowRoot;
    }

    // Remove any orphaned overlay host if present
    const existing = document.querySelector(OVERLAY_TAG);
    if (existing) {
      existing.remove();
    }

    overlayHost = document.createElement(OVERLAY_TAG);
    overlayHost.style.cssText = 'position: absolute !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; overflow: visible !important; pointer-events: none !important; z-index: 2147483647 !important;';
    // Attach closed shadow DOM root so host scripts cannot inspect or mutate
    shadowRoot = overlayHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    shadowRoot.appendChild(style);

    const rootTarget = document.body || document.documentElement;
    rootTarget.appendChild(overlayHost);

    return shadowRoot;
  }

  /**
   * Repositions all active badges and highlight based on current element geometry.
   * Useful during scroll, zoom, or dynamic reflow.
   */
  function repositionBadges() {
    if (!shadowRoot || (activeBadges.size === 0 && !activeHighlight)) {
      return;
    }

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    // Reposition active badges
    for (const [id, item] of activeBadges.entries()) {
      const el = item.element;
      if (!el || !el.isConnected) {
        item.badgeEl.style.display = 'none';
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        item.badgeEl.style.display = 'none';
        continue;
      }

      item.badgeEl.style.display = 'inline-block';
      item.badgeEl.style.top = `${rect.top + scrollY}px`;
      item.badgeEl.style.left = `${rect.left + scrollX}px`;
    }

    // Reposition active highlight if present
    if (activeHighlight && activeHighlight.element && activeHighlight.element.isConnected) {
      const rect = activeHighlight.element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        activeHighlight.highlightEl.style.display = 'block';
        activeHighlight.highlightEl.style.top = `${rect.top + scrollY - 3}px`;
        activeHighlight.highlightEl.style.left = `${rect.left + scrollX - 3}px`;
        activeHighlight.highlightEl.style.width = `${rect.width + 6}px`;
        activeHighlight.highlightEl.style.height = `${rect.height + 6}px`;
      } else {
        activeHighlight.highlightEl.style.display = 'none';
      }
    }
  }

  /**
   * Throttled scroll & resize event listener handler.
   */
  function onScrollOrResize() {
    if (isRepositioning) return;
    isRepositioning = true;
    window.requestAnimationFrame(() => {
      repositionBadges();
      isRepositioning = false;
    });
  }

  /**
   * Attaches window scroll and resize listeners to maintain correct positions.
   */
  function attachListeners() {
    if (listenersAttached) return;
    window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    listenersAttached = true;
  }

  /**
   * Detaches window scroll and resize listeners.
   */
  function detachListeners() {
    if (!listenersAttached) return;
    window.removeEventListener('scroll', onScrollOrResize, { capture: true });
    window.removeEventListener('resize', onScrollOrResize);
    listenersAttached = false;
  }

  /**
   * Renders numbered badges over interactive elements.
   *
   * @param {Array<Object>} [elements] List of ActionableElement items (with .id).
   *                                   If omitted, pulls from SahayakScanner.
   * @returns {{ success: boolean, count: number }}
   */
  function showBadges(elements) {
    const shadow = ensureOverlay();
    clearBadges(false); // Clear existing badges without destroying the overlay host

    let targetElements = elements;

    // If elements not provided, query the current scanner map or trigger a scan
    if (!Array.isArray(targetElements) || targetElements.length === 0) {
      const scanner = globalThis.SahayakScanner || (typeof SahayakScanner !== 'undefined' ? SahayakScanner : null) || (typeof window !== 'undefined' ? window.SahayakScanner : null);
      if (scanner && typeof scanner.scan === 'function') {
        const actionMap = scanner.scan();
        targetElements = actionMap.elements || [];
      } else {
        targetElements = [];
      }
    }

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    let badgeCount = 0;

    const fragment = document.createDocumentFragment();

    for (const item of targetElements) {
      const id = typeof item === 'number' ? item : item.id;
      if (!id) continue;

      let domEl = null;
      if (item && item.nodeType === 1) {
        domEl = item;
      } else {
        const scanner = globalThis.SahayakScanner || (typeof SahayakScanner !== 'undefined' ? SahayakScanner : null) || (typeof window !== 'undefined' ? window.SahayakScanner : null);
        if (scanner && typeof scanner.getElement === 'function') {
          domEl = scanner.getElement(id);
        }
      }

      if (!domEl || !domEl.isConnected) {
        continue;
      }

      const rect = domEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const badge = document.createElement('span');
      badge.className = 'sahayak-badge';
      badge.textContent = String(id);
      badge.setAttribute('data-element-id', String(id));

      const top = rect.top + scrollY;
      const left = rect.left + scrollX;
      badge.style.top = `${top}px`;
      badge.style.left = `${left}px`;

      fragment.appendChild(badge);
      activeBadges.set(id, { id, element: domEl, badgeEl: badge });
      badgeCount++;
    }

    shadow.appendChild(fragment);
    attachListeners();

    console.log(`[Sahayak Overlay] Rendered ${badgeCount} badges on page.`);
    return { success: true, count: badgeCount };
  }

  /**
   * Highlights a specific element with a pulsing border and scrolls it into view.
   * Used for the "Find It For Me" feature (§11.3 & Slice 3.3).
   *
   * @param {number} elementId ID of the element to highlight.
   * @returns {{ success: boolean, elementId?: number, error?: string }}
   */
  function highlightElement(elementId) {
    const id = Number(elementId);
    if (!id) {
      return { success: false, error: 'Invalid element ID provided.' };
    }

    const scanner = globalThis.SahayakScanner || (typeof SahayakScanner !== 'undefined' ? SahayakScanner : null) || (typeof window !== 'undefined' ? window.SahayakScanner : null);
    let domEl = null;
    if (scanner && typeof scanner.getElement === 'function') {
      domEl = scanner.getElement(id);
    }

    if (!domEl && activeBadges.has(id)) {
      domEl = activeBadges.get(id).element;
    }

    if (!domEl || !domEl.isConnected) {
      return { success: false, error: `Element #${id} not found on the page.` };
    }

    const shadow = ensureOverlay();

    // Scroll element smoothly into the center of the viewport
    try {
      domEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch (e) {
      // Fallback for older engines
      domEl.scrollIntoView();
    }

    // Reset previous badge highlight styling if any
    for (const [bId, badgeItem] of activeBadges.entries()) {
      if (bId === id) {
        badgeItem.badgeEl.classList.add('sahayak-badge-highlighted');
      } else {
        badgeItem.badgeEl.classList.remove('sahayak-badge-highlighted');
      }
    }

    // Remove existing highlight box
    if (activeHighlight && activeHighlight.highlightEl) {
      activeHighlight.highlightEl.remove();
      activeHighlight = null;
    }

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const rect = domEl.getBoundingClientRect();

    const highlightBox = document.createElement('div');
    highlightBox.className = 'sahayak-highlight';
    highlightBox.setAttribute('data-highlight-id', String(id));
    highlightBox.style.top = `${rect.top + scrollY - 3}px`;
    highlightBox.style.left = `${rect.left + scrollX - 3}px`;
    highlightBox.style.width = `${rect.width + 6}px`;
    highlightBox.style.height = `${rect.height + 6}px`;

    shadow.appendChild(highlightBox);
    activeHighlight = { id, element: domEl, highlightEl: highlightBox };

    attachListeners();

    return { success: true, elementId: id };
  }

  /**
   * Clears all badges and highlights, removes listeners, and removes the overlay host.
   * Leaves zero DOM residue when complete.
   *
   * @param {boolean} [removeHost=true] Whether to remove the <sahayak-overlay> host completely.
   * @returns {{ success: boolean }}
   */
  function clearBadges(removeHost = true) {
    detachListeners();

    if (shadowRoot) {
      // Remove all badge and highlight nodes
      const badges = shadowRoot.querySelectorAll('.sahayak-badge, .sahayak-highlight');
      badges.forEach((node) => node.remove());
    }

    activeBadges.clear();
    activeHighlight = null;

    if (removeHost && overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadowRoot = null;
    }

    return { success: true };
  }

  // Export module globally in content script scope
  const SahayakOverlay = {
    showBadges,
    clearBadges,
    highlightElement,
    repositionBadges,
    getBadgeCount: () => activeBadges.size,
    isOverlayActive: () => Boolean(overlayHost && overlayHost.isConnected)
  };

  globalThis.SahayakOverlay = SahayakOverlay;
  if (typeof window !== 'undefined') {
    window.SahayakOverlay = SahayakOverlay;
  }
})();
