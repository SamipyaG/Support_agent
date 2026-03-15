/**
 * ============================================================
 * routes/incidents.ts  —  Incident API Routes
 * ============================================================
 * All routes read directly from InMemoryStore — no MongoDB calls.
 * ============================================================
 */

import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { store } from '../store/InMemoryStore';
import { HubMonitorTool } from '../tools/HubMonitorTool';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

/**
 * POST /api/incidents/:id/chat
 * AI-powered customer message assistant. Suggests contextual messages based on
 * incident state and the Source/G-Mana workflow logic.
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }
 */
/** Detect issue type using analyzerName from the alarm (e.g. "elpais-live Source" → source, "elpais-live Gmana" → gmana) */
function detectIssueType(incident: { analyzerName?: string; channelName: string; streamAnalysis?: Record<string, unknown> }): 'source' | 'gmana' {
  // Primary: analyzerName from the alarm API
  if (incident.analyzerName) {
    return incident.analyzerName.toLowerCase().includes('source') ? 'source' : 'gmana';
  }
  // Fallback: rootCauseAssumption from stream analysis
  const assumption = incident.streamAnalysis?.rootCauseAssumption as string | undefined;
  if (assumption === 'SOURCE_ISSUE') return 'source';
  if (assumption === 'GMANA_ISSUE') return 'gmana';
  return 'gmana';
}

/** Rule-based fallback when OpenAI is unavailable */
function buildFallbackReply(channelName: string, state: string, issueType: 'source' | 'gmana'): string {
  const ch = channelName;
  if (issueType === 'source') {
    switch (state) {
      case 'NEW': case 'ANALYZING': case 'WAITING_APPROVAL':
        return `Hi,\nThe channel **${ch}** appears down from the source side. Please check the source encoder/feed from your side.`;
      case 'MONITORING': case 'EXECUTING_ACTION':
        return `Hi,\nJust following up regarding **${ch}**. The source still appears down from our monitoring.`;
      case 'RESOLVED':
        return `Hi,\nThe source for **${ch}** is now back and the stream is working normally.`;
      case 'CLOSED':
        return `Hi,\nThe issue has been resolved and the incident is now closed.`;
      default:
        return `Hi,\nThe channel **${ch}** appears down from the source side. Please check the source encoder/feed from your side.`;
    }
  } else {
    switch (state) {
      case 'NEW': case 'ANALYZING':
        return `Hi,\nWe detected an issue affecting **${ch}**. Our team is checking it now.`;
      case 'WAITING_APPROVAL': case 'EXECUTING_ACTION':
        return `Hi,\nWe identified an issue on our side affecting **${ch}** and our team is working to resolve it.`;
      case 'MONITORING':
        return `Hi,\nWe identified an issue on our side affecting **${ch}** and our team is actively working to resolve it. We will update you shortly.`;
      case 'ESCALATED':
        return `Hi,\nThe issue affecting **${ch}** has been escalated to our development team for further investigation. We will update you shortly.`;
      case 'RESOLVED':
        return `Hi,\nThe issue affecting **${ch}** has been resolved and the stream is working normally now.`;
      case 'CLOSED':
        return `Hi,\nThe incident has been resolved and closed. Please let us know if you notice any further issues.`;
      default:
        return `Hi,\nWe detected an issue affecting **${ch}**. Our team is investigating and will update you shortly.`;
    }
  }
}

router.post('/:id/chat', async (req: Request, res: Response) => {
  const incident = getIncidentOrFail(req.params.id, res);
  if (!incident) return;

  const { messages = [] } = req.body as {
    messages: { role: 'user' | 'assistant'; content: string }[];
  };

  const issueType = detectIssueType(incident);
  const issueLabel = issueType === 'source' ? 'SOURCE ISSUE' : 'G-MANA ISSUE';

  const systemPrompt = `You are a customer support AI assistant for G-Mana, a video streaming platform.
Your job is to suggest professional, concise messages to send to customers based on the current incident state.

INCIDENT DETAILS:
- Channel: ${incident.channelName}
- Channel UUID: ${incident.dsUuid}
- Current Status: ${incident.state}
- Error Code: ${incident.errorCode || 'unknown'}
- Recommended Action: ${incident.recommendedAction || 'none'}
- Cluster: ${incident.clusterId || 'unknown'}
- Analyzer Name: ${incident.analyzerName || 'unknown'}
- Issue Type (detected from analyzer name): ${issueLabel}
- Status Label: ${incident.statusLabel || ''}

ISSUE TYPE DETECTION RULE:
The analyzer name contains either "Source" (Source issue) or "Gmana" (G-Mana issue).
This incident is a ${issueLabel} because the analyzer name is "${incident.analyzerName || 'unknown'}".

SOURCE ISSUE WORKFLOW — suggested messages by status:
- NEW/ANALYZING: "Hi, The channel [Channel Name] appears down from the source side. Please check the source encoder/feed from your side."
- MONITORING/EXECUTING_ACTION: "Hi, Just following up regarding [Channel Name]. The source still appears down from our monitoring."
- RESOLVED: "Hi, The source for [Channel Name] is now back and the stream is working normally."
- CLOSED: "Hi, The issue has been resolved and the incident is now closed."

G-MANA ISSUE WORKFLOW — suggested messages by status:
- NEW/ANALYZING: "Hi, We detected an issue affecting [Channel Name]. Our team is checking it now."
- WAITING_APPROVAL/EXECUTING_ACTION: "Hi, We identified an issue on our side affecting [Channel Name] and our team is working to resolve it."
- ESCALATED: "Hi, The issue affecting [Channel Name] has been escalated to our development team for further investigation. We will update you shortly."
- RESOLVED: "Hi, The issue affecting [Channel Name] has been resolved and the stream is working normally now."
- CLOSED: "Hi, The incident has been resolved and closed. Please let us know if you notice any further issues."

INSTRUCTIONS:
1. Always replace [Channel Name] with: "${incident.channelName}".
2. Follow the ${issueLabel} workflow based on the current state: ${incident.state}.
3. Keep messages professional, concise, and customer-friendly.
4. If support asks for a variation or different tone, provide it.
5. Only suggest messages — do not take actions yourself.`;

  const fallback = buildFallbackReply(incident.channelName, incident.state, issueType);

  const timeoutMs = 8_000;
  const timeoutPromise = new Promise<string>(resolve =>
    setTimeout(() => resolve(fallback), timeoutMs),
  );

  const openaiPromise = openai.chat.completions
    .create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 400,
      temperature: 0.4,
    })
    .then(c => c.choices[0]?.message?.content ?? fallback)
    .catch(() => fallback);

  const reply = await Promise.race([openaiPromise, timeoutPromise]);
  res.json({ reply });
});

export default router;
