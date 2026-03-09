/**
 * routes/alarms.ts
 * Manual alarm trigger for testing without waiting for poll cycle.
 * GET  /api/alarms        — list all tracked alarm occurrences
 * POST /api/alarms/manual — manually trigger investigation for a ds_uuid
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/alarms/manual
 * Manually trigger an investigation for a specific channel.
 * Body: { dsUuid: "..." }
 * Useful for testing without waiting for the 30s poll cycle.
 */
router.post('/manual', async (req: Request, res: Response) => {
  const { dsUuid } = req.body;

  if (!dsUuid) {
    return res.status(400).json({ error: 'dsUuid is required' });
  }

  const managerAgent = req.app.get('managerAgent');
  if (!managerAgent) {
    return res.status(500).json({ error: 'ManagerAgent not initialized' });
  }

  logger.info(`[AlarmRoute] Manual investigation triggered for ${dsUuid}`);

  // Run in background — don't wait for it to complete
  managerAgent.processAlarms([{
    dsUuid,
    channelName: 'Manual trigger',
    status: 'ON' as const,
    statusCode: 0,
    errorType: 'MANUAL_TRIGGER',
    redisKey: '',
    startedAt: new Date(Date.now() - 120_000).toISOString(), // 2 min ago (past waiting time)
    endedAt: null,
    reason: 'Manually triggered investigation',
    alarmUrl: '',
  }]).catch((err: Error) => logger.error('[AlarmRoute] Manual investigation error', { err: err.message }));

  res.json({ message: `Investigation started for ${dsUuid}` });
});

export default router;
