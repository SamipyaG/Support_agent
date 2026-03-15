/**
 * ============================================================
 * routes/incidents.ts  —  Incident API Routes
 * ============================================================
 * All routes read directly from InMemoryStore — no MongoDB calls.
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import { store } from '../store/InMemoryStore';
import { HubMonitorTool } from '../tools/HubMonitorTool';

const router = Router();

/**
 * GET /api/incidents
 * List all incidents with optional state filter and pagination.
 * Query params: state, page, limit
 */
router.get('/', (req: Request, res: Response) => {
  const { state, page = '1', limit = '20' } = req.query;
  const result = store.getAllIncidents({
    state: state as any,
    page: parseInt(page as string, 10),
    limit: parseInt(limit as string, 10),
  });
  res.json(result);
});

/**
 * GET /api/incidents/filter/active
 * Shortcut: get all non-closed/non-resolved incidents.
 */
router.get('/filter/active', (_req: Request, res: Response) => {
  const { incidents } = store.getAllIncidents({
    state: ['NEW', 'ANALYZING', 'WAITING_APPROVAL', 'EXECUTING_ACTION', 'MONITORING', 'ESCALATED'],
  });
  res.json({ incidents, total: incidents.length });
});

/**
 * GET /api/incidents/:id
 * Full incident detail with approvals, action logs, escalations, memory patterns.
 */
router.get('/:id', (req: Request, res: Response) => {
  const full = store.getFullIncident(req.params.id);
  if (!full.incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }
  res.json(full);
});

/**
 * GET /api/incidents/debug/stats
 * Store statistics — useful for debugging.
 */
router.get('/debug/stats', (_req: Request, res: Response) => {
  res.json(store.getStats());
});

// ── Restart Workflow Routes ────────────────────────────────────────────────────

function getHubMonitor(req: Request): HubMonitorTool {
  return req.app.get('hubMonitor') as HubMonitorTool;
}

function getIncidentOrFail(id: string, res: Response): ReturnType<typeof store.getFullIncident>['incident'] | null {
  const { incident } = store.getFullIncident(id);
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return null;
  }
  if (!incident.clusterId) {
    res.status(400).json({ error: 'Cluster not yet determined for this incident. Wait for analysis to complete.' });
    return null;
  }
  return incident;
}

/**
 * GET /api/incidents/:id/logs/uh
 * Fetch User Handler pod logs — proxied through backend (auth handled server-side).
 */
router.get('/:id/logs/uh', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;
  try {
    const result = await getHubMonitor(req).getUHLogs(incident.clusterId, incident.dsUuid);
    res.json({ dsUuid: incident.dsUuid, podName: result.podName, logs: result.logs });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/incidents/:id/logs/ci
 * Fetch Cuemana-In pod logs.
 */
router.get('/:id/logs/ci', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;
  try {
    const result = await getHubMonitor(req).getCILogs(incident.clusterId, incident.dsUuid);
    res.json({ dsUuid: incident.dsUuid, podName: result.podName, logs: result.logs });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/incidents/:id/restart/uh
 * Restart User Handler deployment — records in actionHistory as Manual trigger.
 */
router.post('/:id/restart/uh', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;
  const uhPath = (process.env.HUB_UH_RESTART_PATH || '/sendalarms/clusters/{cluster}/deployments/user-handler-{uuid}/restart')
    .replace('{cluster}', incident.clusterId)
    .replace('{uuid}', incident.dsUuid);
  console.log(`[RESTART UH] clusterId="${incident.clusterId}" dsUuid="${incident.dsUuid}"`);
  console.log(`[RESTART UH] Full URL → ${process.env.HUB_MONITOR_BASE_URL}${uhPath}`);
  try {
    const result = await getHubMonitor(req).restartUH(incident.clusterId, incident.dsUuid);
    store.updateIncident(incident._id, {
      actionHistory: [
        ...incident.actionHistory,
        { action: 'RESTART_UH', executedAt: new Date(), result: result.message || 'Manual restart triggered', approvedBy: 'Manual' },
      ],
    });
    res.json(result);
  } catch (err) {
    store.updateIncident(incident._id, {
      actionHistory: [
        ...incident.actionHistory,
        { action: 'RESTART_UH', executedAt: new Date(), result: `Manual restart failed: ${(err as Error).message}`, approvedBy: 'Manual' },
      ],
    });
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/incidents/:id/restart/ci
 * Restart Cuemana-In deployment — records in actionHistory as Manual trigger.
 */
router.post('/:id/restart/ci', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;
  try {
    const result = await getHubMonitor(req).restartCI(incident.clusterId, incident.dsUuid);
    store.updateIncident(incident._id, {
      actionHistory: [
        ...incident.actionHistory,
        { action: 'RESTART_CI', executedAt: new Date(), result: result.message || 'Manual restart triggered', approvedBy: 'Manual' },
      ],
    });
    res.json(result);
  } catch (err) {
    store.updateIncident(incident._id, {
      actionHistory: [
        ...incident.actionHistory,
        { action: 'RESTART_CI', executedAt: new Date(), result: `Manual restart failed: ${(err as Error).message}`, approvedBy: 'Manual' },
      ],
    });
    res.status(502).json({ error: (err as Error).message });
  }
});

// ── Traffic Redirect Routes ────────────────────────────────────────────────────

/**
 * POST /api/incidents/:id/traffic/redirect
 * Redirect a percentage of traffic from G-Mana to the source stream.
 * Body: { percentage: number (1-100) }
 */
router.post('/:id/traffic/redirect', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;

  const { percentage } = req.body as { percentage: unknown };
  const pct = Number(percentage);
  if (!pct || pct < 1 || pct > 100) {
    return res.status(400).json({ error: 'percentage must be a number between 1 and 100' });
  }

  try {
    const result = await getHubMonitor(req).redirectTrafficToSource(
      incident.dsUuid,
      incident.channelName,
      incident.sourcePlayerUrl,
      pct,
    );

    store.updateIncident(incident._id, {
      state: 'MONITORING',
      statusLabel: `Traffic redirected to source (${pct}%) — monitoring G-Mana recovery`,
      streamAnalysis: {
        ...incident.streamAnalysis,
        redirectActive: true,
        redirectPercentage: pct,
        redirectedAt: new Date().toISOString(),
      },
      actionHistory: [
        ...incident.actionHistory,
        {
          action: 'REDIRECT_TRAFFIC',
          executedAt: new Date(),
          result: `${pct}% traffic redirected to source — ${result.message}`,
          approvedBy: 'Manual',
        },
      ],
    });

    store.pushTimelineEvent(incident._id, {
      step: 'Recovery', trigger: 'Manual', action: 'Traffic Redirected',
      details: `${pct}% of traffic redirected to source stream — monitoring G-Mana health`,
    });

    res.json({ success: true, percentage: pct, message: result.message });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/incidents/:id/traffic/revert
 * Restore traffic back to G-Mana once the stream has recovered.
 */
router.post('/:id/traffic/revert', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;

  try {
    const result = await getHubMonitor(req).revertTrafficToGMana(
      incident.dsUuid,
      incident.channelName,
      incident.sourcePlayerUrl,
    );

    store.updateIncident(incident._id, {
      state: 'RESOLVED',
      statusLabel: 'G-Mana stream recovered — traffic restored to G-Mana',
      resolvedAt: new Date(),
      streamAnalysis: {
        ...incident.streamAnalysis,
        redirectActive: false,
        revertedAt: new Date().toISOString(),
      },
      actionHistory: [
        ...incident.actionHistory,
        {
          action: 'REVERT_TRAFFIC',
          executedAt: new Date(),
          result: result.message,
          approvedBy: 'system',
        },
      ],
    });

    store.pushTimelineEvent(incident._id, {
      step: 'Recovery', trigger: 'System', action: 'Traffic Reverted',
      details: 'G-Mana stream recovered — traffic restored from source back to G-Mana',
    });

    res.json({ success: true, message: result.message });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/incidents/:id/traffic/health
 * Check whether the G-Mana alarm for this incident is still active.
 * Returns { gmanaHealthy: boolean, alarmActive: boolean }
 */
router.get('/:id/traffic/health', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;

  try {
    const alarmActive = await getHubMonitor(req).isGManaAlarmActive(incident.dsUuid);
    res.json({ gmanaHealthy: !alarmActive, alarmActive });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
