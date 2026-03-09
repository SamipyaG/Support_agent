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
 * Restart User Handler deployment.
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
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/incidents/:id/restart/ci
 * Restart Cuemana-In deployment.
 */
router.post('/:id/restart/ci', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;
  try {
    const result = await getHubMonitor(req).restartCI(incident.clusterId, incident.dsUuid);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
