/**
 * Sahayak — Agent State Machine & Checkpoint Manager (Slice 3.4)
 *
 * Implements a formal finite state machine for browser agent tasks with
 * persistent session checkpoints in chrome.storage.session to survive
 * service worker restarts.
 *
 * Architecture references: §11.1
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'sahayak_agent_state';

  /**
   * Finite states of the agent loop.
   */
  const AgentState = {
    IDLE: 'IDLE',
    SCANNING: 'SCANNING',
    THINKING: 'THINKING',
    SAFETY_CHECK: 'SAFETY_CHECK',
    AWAITING_APPROVAL: 'AWAITING_APPROVAL',
    EXECUTING: 'EXECUTING',
    COMPLETED: 'COMPLETED',
    CLEANUP: 'CLEANUP'
  };

  /**
   * Allowed state transitions map.
   */
  const VALID_TRANSITIONS = {
    [AgentState.IDLE]: [AgentState.SCANNING],
    [AgentState.SCANNING]: [AgentState.THINKING, AgentState.CLEANUP, AgentState.IDLE],
    [AgentState.THINKING]: [AgentState.SAFETY_CHECK, AgentState.CLEANUP, AgentState.IDLE],
    [AgentState.SAFETY_CHECK]: [AgentState.AWAITING_APPROVAL, AgentState.CLEANUP, AgentState.IDLE],
    [AgentState.AWAITING_APPROVAL]: [AgentState.EXECUTING, AgentState.THINKING, AgentState.CLEANUP, AgentState.IDLE],
    [AgentState.EXECUTING]: [AgentState.SCANNING, AgentState.COMPLETED, AgentState.CLEANUP, AgentState.IDLE],
    [AgentState.COMPLETED]: [AgentState.CLEANUP, AgentState.IDLE],
    [AgentState.CLEANUP]: [AgentState.IDLE]
  };

  /**
   * Default agent state context.
   */
  function createDefaultContext() {
    return {
      state: AgentState.IDLE,
      goal: '',
      maxSteps: 10,
      stepCount: 0,
      dryRun: false,
      tabId: null,
      currentAction: null,
      history: [],
      statusMessage: 'Ready for a new task.',
      error: null,
      startedAt: null,
      updatedAt: Date.now()
    };
  }

  // Active in-memory context
  let currentContext = createDefaultContext();

  /**
   * Helper to get Checkpoint manager.
   */
  function getCheckpointManager() {
    return (typeof SahayakCheckpoint !== 'undefined' ? SahayakCheckpoint : null)
      || (typeof globalThis !== 'undefined' ? globalThis.SahayakCheckpoint : null)
      || (typeof window !== 'undefined' ? window.SahayakCheckpoint : null);
  }

  /**
   * Load checkpointed state from session storage (e.g. after worker resume).
   * @returns {Promise<Object>}
   */
  async function init() {
    try {
      const cp = getCheckpointManager();
      if (cp && typeof cp.loadCheckpoint === 'function') {
        const stored = await cp.loadCheckpoint();
        if (stored) {
          currentContext = { ...createDefaultContext(), ...stored };
          return currentContext;
        }
      }

      if (chrome.storage && chrome.storage.session) {
        const stored = await chrome.storage.session.get(STORAGE_KEY);
        if (stored && stored[STORAGE_KEY]) {
          currentContext = { ...createDefaultContext(), ...stored[STORAGE_KEY] };
        }
      }
    } catch (err) {
      console.warn('[AgentStateMachine] Could not restore session state:', err);
    }
    return currentContext;
  }

  /**
   * Get current state machine context.
   * @returns {Object}
   */
  function getState() {
    return { ...currentContext };
  }

  /**
   * Transition to next valid state, enforce rules, write checkpoint, and broadcast.
   *
   * @param {string} nextState - Target AgentState
   * @param {Object} [updates={}] - Partial context updates
   * @returns {Promise<Object>} Updated context
   * @throws {Error} if transition is invalid
   */
  async function transitionTo(nextState, updates = {}) {
    const currentState = currentContext.state;

    // Direct transition to CLEANUP or IDLE is always permitted (stop / reset)
    const isStopOrReset = nextState === AgentState.CLEANUP || nextState === AgentState.IDLE;
    const allowed = VALID_TRANSITIONS[currentState] || [];

    if (!isStopOrReset && !allowed.includes(nextState)) {
      throw new Error(`Invalid agent state transition: ${currentState} → ${nextState}`);
    }

    currentContext = {
      ...currentContext,
      ...updates,
      state: nextState,
      updatedAt: Date.now()
    };

    console.log(`[AgentStateMachine] Transition: ${currentState} → ${nextState}`, {
      step: currentContext.stepCount,
      max: currentContext.maxSteps
    });

    // Write checkpoint to session storage (Slice 3.6 & §15.2)
    try {
      const cp = getCheckpointManager();
      if (cp && typeof cp.saveCheckpoint === 'function') {
        await cp.saveCheckpoint(currentContext);
      }
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.set({ [STORAGE_KEY]: currentContext });
      }
    } catch (err) {
      console.warn('[AgentStateMachine] Could not write session checkpoint:', err);
    }

    // Broadcast state change across extension contexts (e.g. side panel)
    try {
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'AGENT_STATE_CHANGED',
          payload: { ...currentContext }
        }).catch(() => {
          // Normal when side panel is closed
        });
      }
    } catch (e) {}

    return { ...currentContext };
  }

  /**
   * Reset agent state to default IDLE.
   * @returns {Promise<Object>}
   */
  async function reset() {
    currentContext = createDefaultContext();
    try {
      const cp = getCheckpointManager();
      if (cp && typeof cp.clearCheckpoint === 'function') {
        await cp.clearCheckpoint();
      }
      if (chrome.storage && chrome.storage.session) {
        await chrome.storage.session.set({ [STORAGE_KEY]: currentContext });
      }
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'AGENT_STATE_CHANGED',
          payload: { ...currentContext }
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('[AgentStateMachine] Reset storage error:', err);
    }
    return { ...currentContext };
  }

  // Export module globally
  const AgentStateMachine = {
    AgentState,
    getState,
    transitionTo,
    reset,
    init,
    isIdle: () => currentContext.state === AgentState.IDLE,
    isActive: () => currentContext.state !== AgentState.IDLE
  };

  globalThis.AgentStateMachine = AgentStateMachine;
  if (typeof window !== 'undefined') {
    window.AgentStateMachine = AgentStateMachine;
  }
})();

