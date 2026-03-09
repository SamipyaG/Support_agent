/**
 * ============================================================
 * IncidentStateMachine.ts
 * ============================================================
 *
 * ROLE: Validates and enforces all incident state transitions.
 * Acts as a safety guardrail so incidents can only move to
 * valid next states — preventing bugs like resolving an incident
 * that's already closed, or executing actions on resolved incidents.
 *
 * STATE DIAGRAM:
 * ┌─────────────────────────────────────────────────────────┐
 * │                                                         │
 * │  NEW ──► ANALYZING ──► WAITING_APPROVAL                 │
 * │               │               │                         │
 * │               │        EXECUTING_ACTION                 │
 * │               │               │                         │
 * │               ├──────► MONITORING ──► RESOLVED ──► CLOSED│
 * │               │               │                         │
 * │               └──► ESCALATED ─┘                         │
 * │                                                         │
 * │  Any state ──► FAILED (on critical errors)              │
 * │  FAILED ──► NEW (retry)                                 │
 * └─────────────────────────────────────────────────────────┘
 *
 * STATES EXPLAINED:
 * NEW              - Just created, not yet processed
 * ANALYZING        - All 4 agents running, GPT-4o synthesizing
 * WAITING_APPROVAL - Recommendation ready, awaiting human decision
 * EXECUTING_ACTION - Approved, restart/redirect in progress
 * MONITORING       - Action taken, watching stream health for 5min
 * ESCALATED        - AI couldn't fix it, Yoni has been notified
 * RESOLVED         - Both streams healthy, Jira closed, customer notified
 * CLOSED           - Final state, archived
 * FAILED           - Unrecoverable error, needs manual attention
 * ============================================================
 */

import { logger } from '../utils/logger';

/** All possible states an incident can be in */
export type IncidentState =
  | 'NEW'
  | 'ANALYZING'
  | 'WAITING_APPROVAL'
  | 'EXECUTING_ACTION'
  | 'MONITORING'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'FAILED';

/**
 * Valid transitions map.
 * Key = current state, Value = list of states it can transition TO.
 * Any transition NOT in this map will throw an error.
 */
type TransitionMap = Partial<Record<IncidentState, IncidentState[]>>;

const VALID_TRANSITIONS: TransitionMap = {
  NEW:               ['ANALYZING', 'FAILED'],
  ANALYZING:         ['WAITING_APPROVAL', 'MONITORING', 'ESCALATED', 'FAILED'],
  WAITING_APPROVAL:  ['EXECUTING_ACTION', 'ESCALATED', 'FAILED'],
  EXECUTING_ACTION:  ['MONITORING', 'ESCALATED', 'FAILED'],
  MONITORING:        ['RESOLVED', 'ANALYZING', 'ESCALATED', 'FAILED'],
  ESCALATED:         ['RESOLVED', 'CLOSED', 'FAILED'],
  RESOLVED:          ['CLOSED'],
  CLOSED:            [], // Terminal state — no transitions allowed
  FAILED:            ['NEW'], // Can retry from FAILED
};

export class IncidentStateMachine {
  /**
   * Check if a transition is valid WITHOUT executing it.
   * Used for pre-flight checks before attempting a transition.
   *
   * @param from  Current state
   * @param to    Target state
   * @returns     True if transition is allowed
   */
  static canTransition(from: IncidentState, to: IncidentState): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Execute a state transition.
   * Throws an error if the transition is invalid (prevents illegal state changes).
   *
   * @param incidentId  For logging only (human-readable context)
   * @param from        Current state (must match what's in the database)
   * @param to          Target state
   * @returns           The new state (same as `to` param — for assignment)
   * @throws            Error if transition is not allowed by VALID_TRANSITIONS
   */
  static transition(
    incidentId: string,
    from: IncidentState,
    to: IncidentState,
  ): IncidentState {
    if (!this.canTransition(from, to)) {
      const msg = `[StateMachine] INVALID transition: ${from} → ${to} for incident ${incidentId}`;
      logger.error(msg);
      throw new Error(msg);
    }
    logger.info(`[StateMachine] Incident ${incidentId}: ${from} → ${to}`);
    return to;
  }

  /**
   * Check if an incident is in a terminal state (no more processing).
   * Used to prevent double-processing of completed incidents.
   *
   * @param state  The state to check
   * @returns      True if CLOSED or FAILED (no further transitions possible)
   */
  static isFinal(state: IncidentState): boolean {
    return state === 'CLOSED' || state === 'FAILED';
  }

  /**
   * Check if an incident can still have actions taken on it.
   * Used to prevent executing actions on already-resolved incidents.
   * Guardrail against race conditions.
   *
   * @param state  The current incident state
   * @returns      False if RESOLVED, CLOSED, or FAILED
   */
  static isActionable(state: IncidentState): boolean {
    return !['RESOLVED', 'CLOSED', 'FAILED'].includes(state);
  }
}
