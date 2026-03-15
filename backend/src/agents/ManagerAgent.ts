/**
 * ManagerAgent.ts
 * ============================================================
 * AGENT 3: MANAGER AGENT — Central Orchestrator
 * STATUS: ACTIVE
 * TYPE:   Orchestrator (calls GPT-4o, writes all incident state, executes all actions)
 *
 * ─── ROLE ─────────────────────────────────────────────────
 * Central coordinator. The ONLY agent that calls GPT-4o.
 * The ONLY agent that writes incident state to InMemoryStore.
 * The ONLY agent that calls HubMonitorTool for restarts.
 * All agents communicate ONLY through the ManagerAgent.
 *
 * ─── COMMUNICATION IN ─────────────────────────────────────
 * Source 1: Hub Monitor polling → AlarmData[] { dsUuid, channelName, status, errorType, reason }
 * Source 2: StreamAnalyzerAgent → StreamAnalysisReport (includes ds_uuid, urls, cluster)
 * Source 3: ResourcesAnalyzerAgent → ResourcesAnalysisReport
 * Source 4: PlayerAnalyzerAgent (future) → PlayerAnalyzerReport
 * Source 5: ApprovalService → { decision: approved|rejected|timeout, decidedBy }
 * Source 6: SenderAgent (future) → MessageDraft for review
 *
 * ─── WHAT IT DISTRIBUTES ──────────────────────────────────
 * To StreamAnalyzerAgent:    alarm data + streamUrls
 * To ResourcesAnalyzerAgent: clusterName + dsUuid (from StreamAnalysisReport)
 * To PlayerAnalyzerAgent:    sourceUrl + gManaUrl (future)
 * To GPT-4o:                 getManagerSynthesisPrompt() + buildManagerSynthesisContext()
 * To ApprovalService:        waitForApproval(incidentId, action, context, timeout)
 * To HubMonitorTool:         restartUH(cluster, dsUuid) / restartCI(cluster, dsUuid)
 * To InMemoryStore:          createIncident() / updateIncident() at every state change
 * To SenderAgent (future):   situation + incidentContext for message draft
 *
 * ─── STATE MACHINE ────────────────────────────────────────
 * NEW              → alarm received, threshold not met, watching
 * ANALYZING        → StreamAnalyzer ran, distributing data to other agents
 * WAITING_APPROVAL → GPT-4o decision ready, awaiting human confirmation
 * EXECUTING_ACTION → restart command being sent to Hub Monitor API
 * MONITORING       → restart complete, verifying stream health (3 checks × 30s)
 * RESOLVED         → no action needed (source down or transient alarm) — terminal
 * ESCALATED        → rejected / VIP / max restarts / confidence too low — terminal
 * CLOSED           → stream healthy, pattern saved — terminal
 *
 * ─── ACTION ORDER ─────────────────────────────────────────
 * attempt 0 → RESTART_UH   (restartAttempts=0)
 * attempt 1 → RESTART_CI   (restartAttempts=1)
 * attempt 2 → MOVE_TO_SOURCE + ESCALATED (max restarts reached)
 *
 * ─── EARLY EXITS ──────────────────────────────────────────
 * SOURCE_ISSUE → state=RESOLVED, customer notified, pods NOT touched, STOP
 * NO_ISSUE     → no state change, no action, STOP
 *
 * ─── FALLBACK ─────────────────────────────────────────────
 * If GPT-4o call fails → ruleBasedDecision() applies hard-coded rules from agent reports.
 * ============================================================
 */

import OpenAI from 'openai';
import { HubMonitorTool, AlarmData, StreamUrls } from '../tools/HubMonitorTool';
import { ResourcesAnalyzerAgent, ResourcesAnalysisReport } from './ResourcesAnalyzerAgent';
import { ApprovalService } from '../services/ApprovalService';

import { getManagerSynthesisPrompt, buildManagerSynthesisContext } from './SystemKnowledgeBase';
import { store, Incident } from '../store/InMemoryStore';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

const POST_RESTART_WAIT_MS = 30_000;
const STABLE_CHECK_INTERVAL_MS = 30_000;
const STABLE_CHECK_ATTEMPTS = 3;
const SOURCE_ISSUE_WINDOW_MS = 60_000; // 1 minute

// VIP customers — any alarm on these triggers immediate escalation
const VIP_KEYWORDS = ['keshet', 'reshet'];

export class ManagerAgent {
  private openai: OpenAI;
  private resourcesAnalyzer: ResourcesAnalyzerAgent;

  constructor(
    private hubMonitor: HubMonitorTool,
    private approvalService: ApprovalService,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.resourcesAnalyzer = new ResourcesAnalyzerAgent(hubMonitor);
  }

  // ═══════════════════════════════════════════════════════════
  // ENTRY POINT — called from index.ts polling loop
  // ═══════════════════════════════════════════════════════════

  async processAlarms(alarms: AlarmData[], opts?: { closeStale?: boolean }): Promise<void> {
    logger.info(`[Manager] Processing ${alarms.length} alarms`);

    // ── Stale incident detection ──────────────────────────────────────────────
    // Only run during full Hub Monitor polls (not manual triggers).
    // alarms contains ALL currently-active alarm dsUuids from Hub Monitor
    // (including review=true ones).  Any open incident whose dsUuid is NOT in
    // this set means Hub Monitor has closed/reviewed that alarm — close it here.
    if (opts?.closeStale) {
      const activeUuids = new Set(alarms.map((a) => a.dsUuid));
      const { incidents: openIncidents } = store.getAllIncidents({
        state: ['NEW', 'ANALYZING', 'WAITING_APPROVAL', 'EXECUTING_ACTION', 'MONITORING', 'ESCALATED'],
      });
      for (const incident of openIncidents) {
        if (!activeUuids.has(incident.dsUuid)) {
          logger.info(
            `[Manager] Incident ${incident._id} (${incident.channelName}) has no active alarm in Hub Monitor — closing`,
          );
          await this.closeIncident(incident, 'Alarm cleared or reviewed in Hub Monitor');
        }
      }
    }

    if (alarms.length === 0) {
      logger.info('[Manager] No alarms in this poll cycle');
      return;
    }

    // Skip alarms already under manual review
    const reviewSkipped = alarms.filter((a) => a.review);
    if (reviewSkipped.length > 0) {
      logger.info(
        `[Manager] Skipping ${reviewSkipped.length} alarm(s) with review=true: ` +
          reviewSkipped.map((a) => a.channelName).join(', '),
      );
    }
    const actionableAlarms = alarms.filter((a) => !a.review);
    if (actionableAlarms.length === 0) {
      logger.info('[Manager] All alarms are under manual review — nothing to process');
      return;
    }

    // Detect source issues FIRST — before processing individual alarms
    const sourceDownUuids = this.detectSourceIssues(actionableAlarms);

    await Promise.allSettled(
      actionableAlarms.map((alarm) => {
        if (sourceDownUuids.has(alarm.dsUuid)) {
          return this.handleSourceAlarm(alarm);
        }
        return this.handleAlarm(alarm);
      }),
    );
  }

  // ─── Source issue detection ──────────────────────────────────────────────────
  // If multiple channels share the same source URL (alarmUrl) and all fired
  // alarms within 1 minute of each other, the source is down — not G-Mana.

  private detectSourceIssues(alarms: AlarmData[]): Set<string> {
    const sourceDownUuids = new Set<string>();

    const activeAlarms = alarms.filter((a) => a.status === 'ON' && a.alarmUrl);

    // Group active alarms by their source URL
    const bySourceUrl = new Map<string, AlarmData[]>();
    for (const alarm of activeAlarms) {
      const list = bySourceUrl.get(alarm.alarmUrl) || [];
      list.push(alarm);
      bySourceUrl.set(alarm.alarmUrl, list);
    }

    for (const [sourceUrl, group] of bySourceUrl) {
      if (group.length < 2) continue; // Need 2+ channels on same source

      const startTimes = group.map((a) => new Date(a.startedAt).getTime());
      const timeSpread = Math.max(...startTimes) - Math.min(...startTimes);

      if (timeSpread <= SOURCE_ISSUE_WINDOW_MS) {
        logger.warn(
          `[Manager] SOURCE ISSUE detected: ${group.length} channels share source URL (${sourceUrl}) ` +
            `and all alarmed within ${Math.round(timeSpread / 1000)}s — marking as SOURCE_ISSUE`,
        );
        group.forEach((a) => sourceDownUuids.add(a.dsUuid));
      }
    }

    return sourceDownUuids;
  }

  // ─── Source alarm handler ─────────────────────────────────────────────────

  private async handleSourceAlarm(alarm: AlarmData): Promise<void> {
    if (alarm.status === 'OFF') {
      return this.handleClosedAlarm(alarm);
    }

    logger.warn(
      `[Manager] SOURCE_ISSUE for ${alarm.channelName} — notifying customer, no G-Mana restart`,
    );

    const existingIncident = store.findOneIncident(
      (i) => i.dsUuid === alarm.dsUuid && !['CLOSED', 'RESOLVED', 'FAILED'].includes(i.state),
    );

    const customerMsg =
      `Source stream is down for channel "${alarm.channelName}". ` +
      `Please check your encoder/CDN. G-Mana is healthy — no restart needed.`;

    const [details, streamUrls] = await Promise.all([
      this.hubMonitor.getStreamDetails(alarm.dsUuid).catch(() => ({ clusterName: '', redisKey: '' })),
      this.hubMonitor.getStreamUrls(alarm.dsUuid).catch(() => null),
    ]);

    const fields = {
      state: 'RESOLVED' as const,
      errorCode: 'SOURCE_DOWN',
      explanation: customerMsg,
      statusLabel: 'Source is down — customer notified',
      clusterId: details.clusterName,
      redisInstance: details.redisKey,
      sourcePlayerUrl: streamUrls?.sourcePlayerUrl || '',
      gManaPlayerUrl: streamUrls?.gManaPlayerUrl || '',
      streamAnalysis: { rootCauseAssumption: 'SOURCE_ISSUE' },
      resolvedAt: new Date(),
    };

    let sourceIncidentId: string;
    if (existingIncident) {
      store.updateIncident(existingIncident._id, fields);
      sourceIncidentId = existingIncident._id;
    } else {
      const created = store.createIncident({
        dsUuid: alarm.dsUuid,
        channelName: alarm.channelName,
        analyzerName: alarm.analyzerName || '',
        redisInstance: details.redisKey,
        clusterId: details.clusterName,
        streamType: (streamUrls?.streamType as 'HLS' | 'DASH') || 'HLS',
        channelType: ((streamUrls?.channelType || 'Live').toLowerCase().startsWith('v') ? 'VOD' : 'LIVE') as 'LIVE' | 'VOD',
        isVip: VIP_KEYWORDS.some((k) => alarm.channelName.toLowerCase().includes(k)),
        customerId: '',
        reportedBy: 'HubMonitor',
        confidenceScore: 90,
        recommendedAction: 'NOTIFY_CUSTOMER',
        explanation: customerMsg,
        errorCode: 'SOURCE_DOWN',
        jiraTicketId: '',
        jiraTicketKey: '',
        gManaPlayerUrl: streamUrls?.gManaPlayerUrl || '',
        sourcePlayerUrl: streamUrls?.sourcePlayerUrl || '',
        streamAnalysis: { rootCauseAssumption: 'SOURCE_ISSUE' },
        resourceAnalysis: {},
        playerAnalysis: {},
        actionHistory: [],
        timeline: [],
        restartAttempts: 0,
        maxRestartAttempts: 2,
        statusLabel: 'Source is down — customer notified',
        state: 'RESOLVED',
        resolvedAt: new Date(),
      });
      sourceIncidentId = created._id;
    }
    store.pushTimelineEvent(sourceIncidentId, {
      step: 'Alarm', trigger: 'System', action: 'Source Issue Detected',
      details: `Multiple channels on same source URL — G-Mana healthy, source is down`,
    });
    store.pushTimelineEvent(sourceIncidentId, {
      step: 'Notification', trigger: 'Agent', action: 'Customer Notified',
      details: `Source stream down for ${alarm.channelName} — customer alerted, no restart`,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CLOSED ALARM — status = "OFF"
  // ═══════════════════════════════════════════════════════════

  private async handleClosedAlarm(alarm: AlarmData): Promise<void> {
    const incident = store.findOneIncident(
      (i) => i.dsUuid === alarm.dsUuid && !['CLOSED', 'RESOLVED'].includes(i.state),
    );
    if (!incident) return;

    logger.info(`[Manager] Alarm OFF for ${alarm.channelName} — closing incident`);
    await this.closeIncident(incident, 'Alarm cleared by Hub Monitor');
  }

  // ═══════════════════════════════════════════════════════════
  // ACTIVE ALARM — status = "ON"
  // ═══════════════════════════════════════════════════════════

  private async handleAlarm(alarm: AlarmData): Promise<void> {
    try {
      if (alarm.status === 'OFF') {
        await this.handleClosedAlarm(alarm);
      } else {
        await this.handleActiveAlarm(alarm);
      }
    } catch (err) {
      logger.error(`[Manager] Unhandled error for alarm ${alarm.dsUuid}`, { err: String(err) });
    }
  }

  private async handleActiveAlarm(alarm: AlarmData): Promise<void> {
    const existingIncident = store.findOneIncident(
      (i) => i.dsUuid === alarm.dsUuid && !['CLOSED', 'RESOLVED', 'FAILED'].includes(i.state),
    );

    if (existingIncident && existingIncident.state !== 'NEW') {
      await this.handleExistingChannelAlarm(alarm, existingIncident);
    } else {
      await this.handleNewChannelAlarm(alarm, existingIncident ?? null);
    }
  }

  // ─────────────────────────────────────────────────────────
  // NEW CHANNEL — Scenarios 1, 2, 3
  // ─────────────────────────────────────────────────────────

  private async handleNewChannelAlarm(alarm: AlarmData, existingIncident: Incident | null): Promise<void> {
    this.trackAlarmOccurrence(alarm);

    const repeatWindowMs = parseInt(process.env.ALARM_REPEAT_WINDOW_MS || '3600000', 10);
    const repeatThreshold = parseInt(process.env.ALARM_REPEAT_THRESHOLD || '3', 10);
    const recentCount = this.countRecentAlarms(alarm.dsUuid, repeatWindowMs);

    const waitingTimeSeconds = parseInt(process.env.DEFAULT_WAITING_TIME_SECONDS || '60', 10);
    const alarmAgeSeconds = (Date.now() - new Date(alarm.startedAt).getTime()) / 1000;

    logger.info(
      `[Manager] Channel: ${alarm.channelName} | alarms in 60min: ${recentCount}/${repeatThreshold} | age: ${Math.round(alarmAgeSeconds)}s`,
    );

    // Scenario 1: Below repeat threshold — watch and wait
    if (recentCount < repeatThreshold) {
      const label = `Watching — wait ${waitingTimeSeconds}s before acting (${recentCount}/${repeatThreshold} alarms)`;
      const incidentId = await this.createOrUpdateTrackingIncident(alarm, existingIncident, label);
      // Push stable detail so repeated polls collapse into one row
      if (existingIncident) {
        store.pushTimelineEvent(incidentId, {
          step: 'Alarm', trigger: 'System', action: 'Alarm Watching',
          details: 'Below alarm threshold — waiting for repeat pattern',
        });
      }
      logger.info(`[Manager] ${alarm.channelName}: Below threshold, watching...`);
      return;
    }

    // Scenario 2: Threshold met but wait time not exceeded — hold
    if (alarmAgeSeconds < waitingTimeSeconds) {
      const remaining = Math.round(waitingTimeSeconds - alarmAgeSeconds);
      const label = `Threshold met — waiting ${remaining}s more before action`;
      const incidentId = await this.createOrUpdateTrackingIncident(alarm, existingIncident, label);
      if (existingIncident) {
        store.pushTimelineEvent(incidentId, {
          step: 'Alarm', trigger: 'System', action: 'Alarm Watching',
          details: 'Threshold met — waiting before investigation',
        });
      }
      logger.info(`[Manager] ${alarm.channelName}: Waiting ${remaining}s more`);
      return;
    }

    // Scenario 3: Threshold met + wait exceeded → full investigation
    const label = `Waiting time (${waitingTimeSeconds}s) exceeded — investigating`;
    if (existingIncident) {
      store.updateIncident(existingIncident._id, { statusLabel: label });
    }
    logger.info(`[Manager] ${alarm.channelName}: ${label}`);
    await this.runFullInvestigation(alarm, existingIncident);
  }

  private async createOrUpdateTrackingIncident(
    alarm: AlarmData,
    existingIncident: Incident | null,
    statusLabel: string,
  ): Promise<string> {
    const [details, streamUrls] = await Promise.all([
      this.hubMonitor.getStreamDetails(alarm.dsUuid).catch(() => ({ clusterName: '', redisKey: '' })),
      this.hubMonitor.getStreamUrls(alarm.dsUuid).catch(() => null),
    ]);

    if (existingIncident) {
      store.updateIncident(existingIncident._id, {
        statusLabel,
        clusterId: details.clusterName || existingIncident.clusterId,
        redisInstance: details.redisKey || existingIncident.redisInstance,
        ...(streamUrls && {
          channelName: streamUrls.channelName || existingIncident.channelName,
          sourcePlayerUrl: streamUrls.sourcePlayerUrl,
          gManaPlayerUrl: streamUrls.gManaPlayerUrl,
        }),
      });
      return existingIncident._id;
    }
    const created = store.createIncident({
      dsUuid: alarm.dsUuid,
      channelName: streamUrls?.channelName || alarm.channelName,
      analyzerName: alarm.analyzerName || '',
      clusterId: details.clusterName,
      redisInstance: details.redisKey,
      streamType: (streamUrls?.streamType as 'HLS' | 'DASH') || 'HLS',
      channelType: ((streamUrls?.channelType || 'Live').toLowerCase().startsWith('v') ? 'VOD' : 'LIVE') as 'LIVE' | 'VOD',
      isVip: false,
      customerId: '',
      state: 'NEW',
      reportedBy: 'HubMonitor',
      confidenceScore: 0,
      recommendedAction: '',
      explanation: '',
      errorCode: alarm.errorType,
      jiraTicketId: '',
      jiraTicketKey: '',
      gManaPlayerUrl: streamUrls?.gManaPlayerUrl || '',
      sourcePlayerUrl: streamUrls?.sourcePlayerUrl || '',
      streamAnalysis: {},
      resourceAnalysis: {},
      playerAnalysis: {},
      actionHistory: [],
      timeline: [],
      restartAttempts: 0,
      maxRestartAttempts: 2,
      statusLabel,
    });
    store.pushTimelineEvent(created._id, {
      step: 'Alarm', trigger: 'System', action: 'Alarm Detected',
      details: `${alarm.errorType || 'stream error'} — watching`,
    });
    return created._id;
  }

  // ─────────────────────────────────────────────────────────
  // EXISTING CHANNEL — non-NEW open incident
  // ─────────────────────────────────────────────────────────

  private async handleExistingChannelAlarm(alarm: AlarmData, incident: Incident): Promise<void> {
    if (['EXECUTING_ACTION', 'MONITORING', 'WAITING_APPROVAL'].includes(incident.state)) {
      logger.info(`[Manager] ${alarm.channelName}: Already in state ${incident.state}, skipping`);
      return;
    }

    const waitingTimeSeconds = parseInt(process.env.DEFAULT_WAITING_TIME_SECONDS || '60', 10);
    const alarmAgeSeconds = (Date.now() - new Date(alarm.startedAt).getTime()) / 1000;

    if (alarmAgeSeconds < waitingTimeSeconds) {
      const durationMinutes = Math.round(alarmAgeSeconds / 60);
      store.updateIncident(incident._id, {
        streamAnalysis: { ...incident.streamAnalysis, durationMinutes, lastUpdated: new Date().toISOString() },
        statusLabel: `Existing incident — waiting time not exceeded yet`,
      });
      return;
    }

    store.updateIncident(incident._id, {
      statusLabel: `Existing incident — waiting time exceeded, investigating`,
    });
    await this.runFullInvestigation(alarm, incident);
  }

  // ═══════════════════════════════════════════════════════════
  // FULL INVESTIGATION — multi-agent coordination
  // ═══════════════════════════════════════════════════════════

  private async runFullInvestigation(
    alarm: AlarmData,
    existingIncident: Incident | null,
  ): Promise<void> {
    logger.info(`[Manager] ====== INVESTIGATION START: ${alarm.channelName} ======`);

    // ── STEP 1: Get stream URLs + stream details (cluster + redis) ───────────
    logger.info(`[Manager] STEP 1: Fetching stream URLs and details for ${alarm.dsUuid}`);
    let streamUrls: StreamUrls;
    let clusterName = '';
    let redisKey = '';
    try {
      [streamUrls] = await Promise.all([
        this.hubMonitor.getStreamUrls(alarm.dsUuid),
        this.hubMonitor.getStreamDetails(alarm.dsUuid).then((d) => {
          clusterName = d.clusterName;
          redisKey = d.redisKey;
        }).catch(() => {}),
      ]);
      logger.info(
        `[Manager] Stream URLs: Source=${streamUrls.sourcePlayerUrl} | G-Mana=${streamUrls.gManaPlayerUrl} | Cluster=${clusterName} | Redis=${redisKey}`,
      );
    } catch (err) {
      logger.error(`[Manager] Failed to get stream URLs: ${String(err)}`);
      return;
    }

    // ── STEP 2: Fetch infrastructure resources ────────────────────────────────
    // Source detection already ruled out a source issue — this is a G-Mana problem.
    // Fetch UH logs, CI logs, and Redis health to guide the restart decision.
    logger.info(`[Manager] STEP 2: Fetching infrastructure resources for ${alarm.dsUuid}`);

    const resourcesReport: ResourcesAnalysisReport | null = await this.resourcesAnalyzer
      .analyze(clusterName, alarm.dsUuid)
      .catch((err) => {
        logger.error(`[Manager] ResourcesAnalyzerAgent failed: ${String(err)}`);
        return null;
      });

    logger.info(
      `[Manager] STEP 2 complete: Resources → component=${resourcesReport?.affectedComponent ?? 'N/A'} ` +
        `confidence=${resourcesReport?.confidenceScore ?? 'N/A'}%`,
    );

    const isVip = VIP_KEYWORDS.some(
      (k) =>
        alarm.channelName.toLowerCase().includes(k) ||
        streamUrls.customerName.toLowerCase().includes(k),
    );

    // ── Create/update incident record ──────────────────────────────────────────
    const incident = existingIncident || store.createIncident({
      dsUuid: alarm.dsUuid,
      channelName: alarm.channelName,
      analyzerName: alarm.analyzerName || '',
      clusterId: clusterName,
      redisInstance: redisKey,
      streamType: streamUrls.streamType as 'HLS' | 'DASH',
      channelType: (streamUrls.channelType.toLowerCase().startsWith('v') ? 'VOD' : 'LIVE') as 'LIVE' | 'VOD',
      isVip,
      customerId: streamUrls.customerName,
      state: 'NEW',
      reportedBy: 'HubMonitor',
      confidenceScore: 0,
      recommendedAction: '',
      explanation: '',
      errorCode: alarm.errorType,
      jiraTicketId: '',
      jiraTicketKey: '',
      gManaPlayerUrl: streamUrls.gManaPlayerUrl,
      sourcePlayerUrl: streamUrls.sourcePlayerUrl,
      streamAnalysis: {},
      resourceAnalysis: {},
      playerAnalysis: {},
      actionHistory: [],
      timeline: [],
      restartAttempts: 0,
      maxRestartAttempts: 2,
      statusLabel: 'Investigating — G-Mana issue confirmed',
    });

    if (!existingIncident) {
      // Incident was created fresh here — push the initial alarm event
      store.pushTimelineEvent(incident._id, {
        step: 'Alarm', trigger: 'System', action: 'Alarm Detected',
        details: `${alarm.errorType || 'stream error'} on ${alarm.channelName} — G-Mana issue confirmed`,
      });
    }
    store.pushTimelineEvent(incident._id, {
      step: 'Analysis', trigger: 'Agent', action: 'Investigation Started',
      details: 'Fetching stream URLs and infrastructure details',
    });

    store.updateIncident(incident._id, {
      state: 'ANALYZING',
      clusterId: clusterName,
      redisInstance: redisKey,
      isVip,
      channelName: streamUrls.channelName || incident.channelName,
      customerId: streamUrls.customerName,
      gManaPlayerUrl: streamUrls.gManaPlayerUrl,
      sourcePlayerUrl: streamUrls.sourcePlayerUrl,
      streamType: streamUrls.streamType as 'HLS' | 'DASH',
      channelType: (streamUrls.channelType.toLowerCase().startsWith('v') ? 'VOD' : 'LIVE') as 'LIVE' | 'VOD',
      streamAnalysis: { rootCauseAssumption: 'GMANA_ISSUE' },
      resourceAnalysis: resourcesReport
        ? {
            affectedComponent: resourcesReport.affectedComponent,
            resourceIssueType: resourcesReport.resourceIssueType,
            severity: resourcesReport.severity,
            confidenceScore: resourcesReport.confidenceScore,
            possibleStreamImpact: resourcesReport.possibleStreamImpact,
            details: resourcesReport.details,
            redisResources: resourcesReport.redisResources,
          }
        : {},
    });

    store.pushTimelineEvent(incident._id, {
      step: 'Resource Check', trigger: 'Agent', action: 'Infrastructure Analysis',
      details: resourcesReport
        ? `${resourcesReport.affectedComponent || 'Unknown'}: ${resourcesReport.resourceIssueType || 'no issue'} — confidence ${resourcesReport.confidenceScore || 0}%`
        : 'Resource analysis unavailable',
    });

    // ── STEP 3: Manager synthesizes with GPT-4o ───────────────────────────────
    logger.info(`[Manager] STEP 3: Synthesizing with GPT-4o`);
    const decision = await this.synthesizeReports(alarm, resourcesReport);

    logger.info(
      `[Manager] Decision: action=${decision.recommendedAction} | ` +
        `confidence=${decision.confidenceScore}% | ${decision.explanation}`,
    );

    store.updateIncident(incident._id, {
      recommendedAction: decision.recommendedAction,
      confidenceScore: decision.confidenceScore,
      explanation: decision.explanation,
      errorCode: decision.errorCode || alarm.errorType,
    });

    store.pushTimelineEvent(incident._id, {
      step: 'Analysis', trigger: 'Agent', action: 'AI Decision',
      details: `${decision.recommendedAction} recommended — confidence ${decision.confidenceScore}%`,
    });

    // ── STEP 4: Update alarm age info, then hand off to executeAction ──────────
    const alarmAgeSeconds = (Date.now() - new Date(alarm.startedAt).getTime()) / 1000;
    store.updateIncident(incident._id, {
      streamAnalysis: {
        ...incident.streamAnalysis,
        durationSeconds: Math.round(alarmAgeSeconds),
        durationMinutes: Math.round(alarmAgeSeconds / 60),
      },
    });

    // ── STEP 5: Execute action (each restart asks for its own approval) ────────
    logger.info(`[Manager] STEP 5: Starting action sequence (each step requires approval)`);
    await this.executeAction(incident, alarm, streamUrls);
  }

  // ═══════════════════════════════════════════════════════════
  // GPT-4o SYNTHESIS — Manager decides restart action
  // ═══════════════════════════════════════════════════════════

  private async synthesizeReports(
    alarm: AlarmData,
    resourcesReport: ResourcesAnalysisReport | null,
  ): Promise<{ recommendedAction: string; confidenceScore: number; explanation: string; errorCode?: string }> {
    try {
      const systemPrompt = getManagerSynthesisPrompt();

      // Build a minimal stream context: source detection already confirmed GMANA_ISSUE
      const syntheticStreamReport = {
        rootCauseAssumption: 'GMANA_ISSUE',
        sourceStatus: 'healthy',
        gmanaStatus: 'down',
        severity: 'high',
        confidenceScore: 75,
        flaggedForFurtherAnalysis: false,
        isVip: VIP_KEYWORDS.some((k) => alarm.channelName.toLowerCase().includes(k)),
        alarmType: alarm.errorType,
        details: `Alarm: ${alarm.errorType} — ${alarm.reason}. Source ruled out (no concurrent source alarms detected). G-Mana restart required.`,
        sourceResult: { hasError: false, statusCode: null, errorType: null },
        gmanaResult: { hasError: true, statusCode: null, errorType: 'ALARM_TRIGGERED' },
      };

      const userMessage = buildManagerSynthesisContext({
        alarm: {
          channelName: alarm.channelName,
          errorType: alarm.errorType,
          reason: alarm.reason,
          statusCode: alarm.statusCode,
        },
        streamReport: syntheticStreamReport,
        resourcesReport: resourcesReport
          ? {
              affectedComponent: resourcesReport.affectedComponent,
              resourceIssueType: resourcesReport.resourceIssueType,
              severity: resourcesReport.severity,
              confidenceScore: resourcesReport.confidenceScore,
              flaggedForFurtherAnalysis: resourcesReport.flaggedForFurtherAnalysis,
              possibleStreamImpact: resourcesReport.possibleStreamImpact,
              details: resourcesReport.details,
            }
          : null,
      });

      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 300,
        temperature: 0,
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

      return {
        recommendedAction: parsed.recommendedAction || 'ESCALATE',
        confidenceScore: parsed.confidenceScore || 0,
        explanation: parsed.explanation || 'Unable to determine root cause',
        errorCode: parsed.errorCode,
      };
    } catch (err) {
      logger.warn(`[Manager] GPT-4o synthesis failed, using rule-based fallback: ${String(err)}`);
      return this.ruleBasedDecision(alarm, resourcesReport);
    }
  }

  /**
   * Fallback when GPT-4o is unavailable.
   */
  private ruleBasedDecision(
    alarm: AlarmData,
    resourcesReport: ResourcesAnalysisReport | null,
  ): { recommendedAction: string; confidenceScore: number; explanation: string } {
    if (resourcesReport?.resourceIssueType === 'REDIS_DOWN') {
      return { recommendedAction: 'ESCALATE', confidenceScore: 90, explanation: 'Redis is down — DevOps escalation required' };
    }
    if (resourcesReport?.affectedComponent === 'CI' || alarm.errorType?.includes('AD')) {
      return { recommendedAction: 'RESTART_CI', confidenceScore: 78, explanation: 'CI pod errors detected — restarting CueMana-In' };
    }
    if (resourcesReport?.affectedComponent === 'UH') {
      return { recommendedAction: 'RESTART_UH', confidenceScore: 80, explanation: 'UH pod errors detected — restarting User Handler' };
    }
    return { recommendedAction: 'RESTART_UH', confidenceScore: 65, explanation: 'G-Mana alarm with no clear pod signal — attempting UH restart as first step' };
  }

  // ═══════════════════════════════════════════════════════════
  // ACTION EXECUTION — UH restart → CI restart → Escalate
  // ═══════════════════════════════════════════════════════════

  private async executeAction(
    incident: Incident,
    alarm: AlarmData,
    streamUrls: StreamUrls,
  ): Promise<void> {
    const { dsUuid, channelName } = alarm;
    const latest = store.getIncident(incident._id)!;
    // Cluster comes from getStreamDetails() stored on incident, NOT from streamUrls (G11 never returns cluster)
    const clusterName = latest.clusterId || '';

    if (latest.restartAttempts >= latest.maxRestartAttempts) {
      logger.warn(`[Manager] Max restart attempts reached for ${channelName} — proposing MOVE_TO_SOURCE`);
      await this.proposeTrafficRedirect(latest, alarm);
      return;
    }

    const action = latest.restartAttempts === 0 ? 'RESTART_UH' : 'RESTART_CI';

    // ── Ask for approval before EVERY restart ────────────────────────────────
    const approvalTimeoutSeconds = parseInt(process.env.APPROVAL_TIMEOUT_SECONDS || '300', 10);
    logger.info(`[Manager] Waiting for approval to ${action} on ${channelName} (timeout: ${approvalTimeoutSeconds}s)`);

    store.updateIncident(incident._id, {
      state: 'WAITING_APPROVAL',
      recommendedAction: action,
      statusLabel: `Awaiting approval — ${action.replace(/_/g, ' ')}`,
    });
    store.pushTimelineEvent(incident._id, {
      step: 'Approval', trigger: 'System', action: `Approval Requested`,
      details: `${action.replace(/_/g, ' ')} — waiting for human sign-off (timeout: ${approvalTimeoutSeconds}s)`,
    });

    const approval = await this.approvalService.waitForApproval(
      incident._id,
      action,
      { dsUuid, cluster: clusterName },
      approvalTimeoutSeconds,
    );

    if (approval.decision === 'rejected') {
      logger.info(`[Manager] ${action} rejected by ${approval.decidedBy} — escalating`);
      store.updateIncident(incident._id, {
        state: 'ESCALATED',
        explanation: `${action} rejected by ${approval.decidedBy}`,
        statusLabel: `Escalated — ${action} rejected by ${approval.decidedBy}`,
      });
      store.pushTimelineEvent(incident._id, {
        step: 'Approval', trigger: 'Manual', action: 'Approval Rejected',
        details: `${action.replace(/_/g, ' ')} rejected by ${approval.decidedBy}`,
      });
      return;
    }

    if (approval.decision === 'timeout') {
      logger.warn(`[Manager] ${action} approval timed out after ${approvalTimeoutSeconds}s — escalating (permission required)`);
      store.updateIncident(incident._id, {
        state: 'ESCALATED',
        explanation: `${action} timed out waiting for approval — manual permission required`,
        statusLabel: `Escalated — ${action} approval timed out, manual intervention required`,
      });
      store.pushTimelineEvent(incident._id, {
        step: 'Approval', trigger: 'System', action: 'Approval Timeout',
        details: `${action.replace(/_/g, ' ')} — no response after ${approvalTimeoutSeconds}s`,
      });
      return;
    }

    logger.info(`[Manager] ${action} approved by ${approval.decidedBy}`);

    store.updateIncident(incident._id, { state: 'EXECUTING_ACTION' });

    if (action === 'RESTART_UH') {
      logger.info(`[Manager] Executing RESTART_UH for ${channelName}`);
      try {
        const result = await this.hubMonitor.restartUH(clusterName, dsUuid);
        store.updateIncident(incident._id, {
          restartAttempts: latest.restartAttempts + 1,
          state: 'MONITORING',
          statusLabel: 'Monitoring — waiting after UH restart',
          actionHistory: [
            ...latest.actionHistory,
            { action: 'RESTART_UH', executedAt: new Date(), result: result.message, approvedBy: approval.decidedBy || 'auto' },
          ],
        });
        store.pushTimelineEvent(incident._id, {
          step: 'Recovery', trigger: approval.decidedBy ? 'Manual' : 'System',
          action: 'Restart UH', details: `User Handler restarted on ${clusterName} — ${result.message}`,
        });
        await sleep(POST_RESTART_WAIT_MS);
        await this.recheckAfterAction(incident, alarm, streamUrls, 'RESTART_UH');
      } catch (err) {
        logger.error(`[Manager] RESTART_UH failed: ${String(err)}`);
        store.pushTimelineEvent(incident._id, {
          step: 'Recovery', trigger: 'System', action: 'Restart UH Failed',
          details: String(err),
        });
        await this.executeAction(
          store.updateIncident(incident._id, { restartAttempts: latest.restartAttempts + 1 })!,
          alarm,
          streamUrls,
        );
      }
    } else {
      logger.info(`[Manager] Executing RESTART_CI for ${channelName}`);
      try {
        const result = await this.hubMonitor.restartCI(clusterName, dsUuid);
        store.updateIncident(incident._id, {
          restartAttempts: latest.restartAttempts + 1,
          state: 'MONITORING',
          statusLabel: 'Monitoring — waiting after CI restart',
          actionHistory: [
            ...latest.actionHistory,
            { action: 'RESTART_CI', executedAt: new Date(), result: result.message, approvedBy: approval.decidedBy || 'auto' },
          ],
        });
        store.pushTimelineEvent(incident._id, {
          step: 'Recovery', trigger: approval.decidedBy ? 'Manual' : 'System',
          action: 'Restart CI', details: `CueMana-In restarted on ${clusterName} — ${result.message}`,
        });
        await sleep(POST_RESTART_WAIT_MS);
        await this.recheckAfterAction(incident, alarm, streamUrls, 'RESTART_CI');
      } catch (err) {
        logger.error(`[Manager] RESTART_CI failed: ${String(err)}`);
        store.pushTimelineEvent(incident._id, {
          step: 'Recovery', trigger: 'System', action: 'Restart CI Failed',
          details: String(err),
        });
        await this.escalate(latest, alarm);
      }
    }
  }

  // ─── Recheck by polling Hub Monitor alarm status ───────────────────────────
  // If the alarm for this dsUuid is no longer active → resolved.
  // If still active after all checks → try next action.

  private async recheckAfterAction(
    incident: Incident,
    alarm: AlarmData,
    streamUrls: StreamUrls,
    actionTaken: string,
  ): Promise<void> {
    logger.info(`[Manager] Rechecking alarm status after ${actionTaken}...`);

    for (let attempt = 1; attempt <= STABLE_CHECK_ATTEMPTS; attempt++) {
      try {
        const activeAlarms = await this.hubMonitor.getActiveAlarms();
        const stillActive = activeAlarms.some(
          (a) => a.dsUuid === alarm.dsUuid && a.status === 'ON' && !a.review,
        );

        if (!stillActive) {
          logger.info(
            `[Manager] Alarm cleared after ${actionTaken} (check ${attempt}/${STABLE_CHECK_ATTEMPTS}) — resolved`,
          );
          // Different details → new row (not grouped with "still active" checks)
          store.pushTimelineEvent(incident._id, {
            step: 'Monitoring', trigger: 'System', action: `Stream Check`,
            details: `Alarm cleared — stream healthy after ${actionTaken.replace(/_/g, ' ')}`,
          });
          await this.closeIncident(incident, `Resolved by ${actionTaken}`);
          return;
        }

        logger.info(
          `[Manager] Alarm still active after ${actionTaken} (check ${attempt}/${STABLE_CHECK_ATTEMPTS})`,
        );
        // Same step+action+details on every check → grouped into one expanding row
        store.pushTimelineEvent(incident._id, {
          step: 'Monitoring', trigger: 'System', action: `Stream Check`,
          details: `Alarm still active after ${actionTaken.replace(/_/g, ' ')}`,
        });
      } catch (err) {
        logger.warn(`[Manager] Recheck failed on attempt ${attempt}: ${String(err)}`);
      }

      if (attempt < STABLE_CHECK_ATTEMPTS) await sleep(STABLE_CHECK_INTERVAL_MS);
    }

    logger.warn(`[Manager] Alarm still active after ${actionTaken} — trying next action`);
    const latest = store.getIncident(incident._id)!;
    store.updateIncident(incident._id, { state: 'EXECUTING_ACTION' });
    await this.executeAction(latest, alarm, streamUrls);
  }

  // ═══════════════════════════════════════════════════════════
  // MOVE_TO_SOURCE — final recovery step after all restarts fail
  // Asks for human approval, then frontend executes the redirect
  // with a user-supplied redirect percentage.
  // ═══════════════════════════════════════════════════════════

  private async proposeTrafficRedirect(incident: Incident, alarm: AlarmData): Promise<void> {
    logger.warn(
      `[Manager] All restarts failed for ${alarm.channelName} — proposing MOVE_TO_SOURCE`,
    );

    const approvalTimeoutSeconds = parseInt(process.env.APPROVAL_TIMEOUT_SECONDS || '300', 10);

    store.updateIncident(incident._id, {
      state: 'WAITING_APPROVAL',
      recommendedAction: 'MOVE_TO_SOURCE',
      explanation:
        'G-Mana stream not recovering after restart attempts. ' +
        'Proposing to move traffic to source stream.',
      statusLabel: 'Awaiting approval — Move Traffic to Source',
    });

    store.pushTimelineEvent(incident._id, {
      step: 'Approval', trigger: 'System', action: 'Move to Source Proposed',
      details: `All restart attempts exhausted — proposing traffic redirect to source (timeout: ${approvalTimeoutSeconds}s)`,
    });

    const approval = await this.approvalService.waitForApproval(
      incident._id,
      'MOVE_TO_SOURCE',
      { dsUuid: alarm.dsUuid, channelName: alarm.channelName },
      approvalTimeoutSeconds,
    );

    if (approval.decision === 'rejected') {
      logger.info(`[Manager] MOVE_TO_SOURCE rejected by ${approval.decidedBy} — escalating`);
      await this.escalate(incident, alarm);
      return;
    }

    if (approval.decision === 'timeout') {
      logger.warn(`[Manager] MOVE_TO_SOURCE approval timed out — escalating`);
      await this.escalate(incident, alarm);
      return;
    }

    // Approved — record the decision; frontend handles the actual redirect
    // (because it needs the redirect percentage from the operator).
    logger.info(`[Manager] MOVE_TO_SOURCE approved by ${approval.decidedBy}`);
    store.pushTimelineEvent(incident._id, {
      step: 'Recovery', trigger: 'Manual', action: 'Move to Source Approved',
      details: `Traffic redirect approved by ${approval.decidedBy} — operator will execute redirect`,
    });
    // State will be updated to MONITORING by the /traffic/redirect route
    // when the frontend posts with the percentage.
  }

  private async escalate(incident: Incident, alarm: AlarmData): Promise<void> {
    logger.warn(`[Manager] ESCALATED for ${alarm.channelName} — all restarts failed`);
    store.updateIncident(incident._id, {
      state: 'ESCALATED',
      recommendedAction: 'ESCALATE',
      statusLabel: 'Escalated — all automatic fixes failed, manual intervention required',
      actionHistory: [
        ...incident.actionHistory,
        {
          action: 'ESCALATE',
          executedAt: new Date(),
          result: 'All automatic restarts failed — requires manual intervention',
          approvedBy: 'system',
        },
      ],
    });
    store.pushTimelineEvent(incident._id, {
      step: 'Escalation', trigger: 'System', action: 'Escalated to Manual',
      details: 'All automatic restarts failed — manual intervention required',
    });
    logger.warn(`[Manager] Manual intervention needed for ${alarm.channelName}`);
  }

  private async closeIncident(incident: Incident, resolution: string): Promise<void> {
    store.updateIncident(incident._id, {
      state: 'CLOSED',
      resolvedAt: new Date(),
      closedAt: new Date(),
      statusLabel: `Closed — ${resolution}`,
    });
    store.pushTimelineEvent(incident._id, {
      step: 'Monitoring', trigger: 'System', action: 'Incident Closed',
      details: resolution,
    });
    store.upsertMemoryPattern({
      patternKey: `restart_success:${incident.dsUuid}:${incident.recommendedAction}`,
      dsUuid: incident.dsUuid,
      clusterId: incident.clusterId,
      customerId: incident.customerId,
      patternType: 'restart_success',
      description: resolution,
      successfulAction: incident.recommendedAction,
      metadata: {},
    });
    logger.info(`[Manager] Incident closed: ${incident.channelName} — ${resolution}`);
  }

  // ─── Alarm tracking (in-memory window) ───────────────────────────────────

  private alarmOccurrences: Map<string, number[]> = new Map();

  private trackAlarmOccurrence(alarm: AlarmData): void {
    const now = Date.now();
    const existing = this.alarmOccurrences.get(alarm.dsUuid) || [];
    existing.push(now);
    this.alarmOccurrences.set(alarm.dsUuid, existing);
  }

  private countRecentAlarms(dsUuid: string, windowMs: number): number {
    const now = Date.now();
    const occurrences = this.alarmOccurrences.get(dsUuid) || [];
    const recent = occurrences.filter((t) => now - t < windowMs);
    this.alarmOccurrences.set(dsUuid, recent);
    return recent.length;
  }
}
