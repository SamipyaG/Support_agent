/**
 * jira.ts — Jira integration routes
 *
 * All calls are proxied through the backend so the API token is never
 * exposed to the frontend.
 *
 * GET  /api/jira/test                — verify credentials
 * GET  /api/jira/tickets/find?dsUuid — find open ticket for a channel
 * POST /api/jira/tickets             — create a new ticket
 * POST /api/jira/tickets/:key/comment — add comment to existing ticket
 */

import { Router, Request, Response } from 'express';
import { JiraTool } from '../tools/JiraTool';
import { logger } from '../utils/logger';

const router = Router();
const jira = new JiraTool();

/** GET /api/jira/test */
router.get('/test', async (_req: Request, res: Response) => {
  try {
    const result = await jira.testConnection();
    res.json(result);
  } catch (err) {
    logger.error('[Jira] testConnection failed', { err: String(err) });
    res.status(502).json({ ok: false, error: String(err) });
  }
});

/** GET /api/jira/tickets/find?dsUuid=xxx */
router.get('/tickets/find', async (req: Request, res: Response) => {
  const { dsUuid } = req.query;
  if (!dsUuid || typeof dsUuid !== 'string') {
    res.status(400).json({ error: 'dsUuid query param required' });
    return;
  }
  try {
    const ticket = await jira.findExistingTicket(dsUuid);
    res.json({ ticket });
  } catch (err) {
    logger.error('[Jira] findExistingTicket failed', { err: String(err) });
    res.status(502).json({ error: String(err) });
  }
});

/** POST /api/jira/tickets */
router.post('/tickets', async (req: Request, res: Response) => {
  const {
    channelName, dsUuid, errorType, reason,
    clusterName, sourceStatus, gmanaStatus,
    uhLogs, ciLogs, redisHealthSummary,
    recommendedAction, isVip,
  } = req.body;

  if (!channelName || !dsUuid) {
    res.status(400).json({ error: 'channelName and dsUuid are required' });
    return;
  }

  try {
    const ticket = await jira.createTicket({
      channelName,
      dsUuid,
      errorType:          errorType          || 'UNKNOWN',
      reason:             reason             || '',
      clusterName:        clusterName        || '',
      sourceStatus:       sourceStatus       || '',
      gmanaStatus:        gmanaStatus        || '',
      uhLogs:             uhLogs             || '',
      ciLogs:             ciLogs             || '',
      redisHealthSummary: redisHealthSummary || '',
      recommendedAction:  recommendedAction  || '',
      isVip:              Boolean(isVip),
    });
    res.status(201).json(ticket);
  } catch (err) {
    logger.error('[Jira] createTicket failed', { err: String(err) });
    res.status(502).json({ error: String(err) });
  }
});

/** POST /api/jira/tickets/:key/comment */
router.post('/tickets/:key/comment', async (req: Request, res: Response) => {
  const { key } = req.params;
  const { comment } = req.body;

  if (!comment) {
    res.status(400).json({ error: 'comment body required' });
    return;
  }

  try {
    await jira.addComment(key, comment);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[Jira] addComment failed', { err: String(err) });
    res.status(502).json({ error: String(err) });
  }
});

export default router;
