/**
 * ============================================================
 * routes/approvals.ts  —  Approval Decision Routes
 * ============================================================
 * Handles the "Approve / Reject" button clicks from the UI.
 * Reads/writes to InMemoryStore — no MongoDB.
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { store } from '../store/InMemoryStore';
import { approvalService } from '../services/ApprovalService';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/approve/:incidentId
 * Support agent clicks Approve or Reject in the UI.
 * Body: { decision: 'approved' | 'rejected', decidedBy: 'John' }
 *
 * This resolves the Promise.race in ApprovalService.waitForApproval()
 * which unblocks the ManagerAgent from executing the action.
 */
router.post('/:incidentId', async (req: Request, res: Response) => {
  const { incidentId } = req.params;
  const { decision, decidedBy } = req.body;

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
  }

  // Check the incident exists
  const incident = store.getIncident(incidentId);
  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  // Check there is a pending approval for this incident
  if (!approvalService.hasPendingApproval(incidentId)) {
    return res.status(409).json({ error: 'No pending approval for this incident (may have already timed out)' });
  }

  logger.info(`[Approvals] ${decision} by ${decidedBy} for incident ${incidentId}`);

  // This resolves the Promise.race in ManagerAgent
  await approvalService.receiveApproval(incidentId, decision, decidedBy || 'unknown');

  res.json({ success: true, incidentId, decision, decidedBy });
});

/**
 * GET /api/approve/:incidentId/status
 * Check if an approval is currently pending (used by UI timer).
 */
router.get('/:incidentId/status', (req: Request, res: Response) => {
  const hasPending = approvalService.hasPendingApproval(req.params.incidentId);
  const pendingRecord = store.getPendingApproval(req.params.incidentId);
  res.json({ pending: hasPending, approval: pendingRecord });
});

export default router;
