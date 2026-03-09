/**
 * ApprovalService.ts
 * Human-in-the-loop approval using Promise.race + InMemoryStore.
 * No MongoDB — all approval records go to InMemoryStore.
 */

import { EventEmitter } from 'events';
import { store, ApprovalDecision } from '../store/InMemoryStore';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

interface ApprovalResult {
  decision: ApprovalDecision;
  decidedBy?: string;
  autoExecuted: boolean;
}

export class ApprovalService extends EventEmitter {
  /**
   * Map from incidentId → resolver function.
   * When receiveApproval() is called, it resolves the waiting Promise.
   */
  private pendingApprovals: Map<string, (decision: ApprovalResult) => void> = new Map();

  /**
   * Wait for human approval or auto-execute on timeout.
   * Saves a pending approval record to InMemoryStore.
   */
  async waitForApproval(
    incidentId: string,
    proposedAction: string,
    actionDetails: Record<string, unknown>,
    timeoutSeconds = 10,
  ): Promise<ApprovalResult> {

    // Save pending approval to InMemoryStore (visible in UI)
    store.createApproval({
      incidentId,
      proposedAction,
      actionDetails,
      decision: 'pending',
      autoExecuted: false,
      timeoutSeconds,
    });

    logger.info(`[Approval] Waiting ${timeoutSeconds}s for decision on incident ${incidentId}: "${proposedAction}"`);

    // Racer 1: human clicks Approve/Reject button
    const approvalPromise = new Promise<ApprovalResult>((resolve) => {
      this.pendingApprovals.set(incidentId, resolve);
    });

    // Racer 2: auto-execute after timeout
    const timeoutPromise = sleep(timeoutSeconds * 1000).then(
      (): ApprovalResult => ({ decision: 'timeout', autoExecuted: true }),
    );

    // Whichever resolves first wins
    const result = await Promise.race([approvalPromise, timeoutPromise]);

    this.pendingApprovals.delete(incidentId);

    // Update the record in InMemoryStore with final decision
    store.resolveApproval(incidentId, result.decision, result.decidedBy, result.autoExecuted);

    logger.info(
      `[Approval] Incident ${incidentId}: ${result.decision} | by: ${result.decidedBy || 'system'} | auto: ${result.autoExecuted}`,
    );

    return result;
  }

  /**
   * Called from POST /api/approve/:incidentId when support clicks a button.
   * Resolves the waiting Promise in waitForApproval().
   */
  async receiveApproval(
    incidentId: string,
    decision: 'approved' | 'rejected',
    decidedBy: string,
  ): Promise<void> {
    const resolver = this.pendingApprovals.get(incidentId);
    if (!resolver) {
      logger.warn(`[Approval] No pending approval for ${incidentId} (may have timed out)`);
      return;
    }
    resolver({ decision, decidedBy, autoExecuted: false });
    this.emit('approval:received', { incidentId, decision, decidedBy });
  }

  /** Check if an incident currently has a pending approval */
  hasPendingApproval(incidentId: string): boolean {
    return this.pendingApprovals.has(incidentId);
  }
}

export const approvalService = new ApprovalService();
