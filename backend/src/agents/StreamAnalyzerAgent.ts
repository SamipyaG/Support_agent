/**
 * StreamAnalyzerAgent.ts
 * ============================================================
 * AGENT 1: STREAM ANALYZER AGENT
 * STATUS: ACTIVE
 * TYPE:   Rule-based specialist (no GPT-4o, no state writes)
 *
 * ─── ROLE ─────────────────────────────────────────────────
 * First agent to run in every alarm cycle. Collects stream
 * metadata, checks both stream URLs, evaluates alarm type,
 * detects VIP, calculates confidence score.
 * Sends full report (including ds_uuid, urls, cluster) to ManagerAgent.
 *
 * ─── COMMUNICATION IN ─────────────────────────────────────
 * Caller: ManagerAgent
 * Method: streamAnalyzer.analyze(alarm, streamUrls)
 *   alarm.dsUuid           — unique session ID
 *   alarm.channelName      — channel that triggered the alarm
 *   alarm.errorType        — alarm code (e.g. MAIN_MANIFEST_BAD_RESPONSE)
 *   alarm.reason           — reason text from Hub Monitor
 *   alarm.statusCode       — HTTP status code in the alarm
 *   streamUrls.sourcePlayerUrl — raw broadcaster stream URL
 *   streamUrls.gManaPlayerUrl  — G-Mana output stream URL
 *   streamUrls.clusterName     — Kubernetes cluster (e.g. hub1x)
 *   streamUrls.customerName    — customer name (used for VIP detection)
 *
 * ─── INTERNAL LOGIC ───────────────────────────────────────
 * 1. Identify channel using ds_uuid
 * 2. Validate stream metadata (sourceUrl, gManaUrl, cluster)
 * 3. ErrorDetectionPlayerTool.checkBoth(sourceUrl, gManaUrl) — both in parallel
 * 4. Analyze alarm type: MAIN_MANIFEST_BAD_RESPONSE | SOURCE_TIMEOUT | STREAM_UNAVAILABLE
 * 5. Root cause decision:
 *      source=DOWN + gmana=DOWN  → BOTH_DOWN      confidence=90  severity=low
 *      source=DOWN + gmana=OK   → SOURCE_ISSUE    confidence=95
 *      source=OK   + gmana=DOWN → GMANA_ISSUE     confidence=70-88 severity=high/critical
 *      source=OK   + gmana=OK  → NO_ISSUE         confidence=85  severity=low
 * 6. VIP detection: channelName or customerName contains "keshet" or "reshet"
 * 7. Confidence scoring by alarm-to-error pattern alignment
 * 8. flaggedForFurtherAnalysis = confidence < 80%
 *
 * ─── COMMUNICATION OUT ────────────────────────────────────
 * Returns to: ManagerAgent (direct TypeScript return value)
 * Report: StreamAnalysisReport {
 *   channelName, dsUuid, isVip,
 *   alarmType, alarmReason,
 *   sourceStatus, gmanaStatus,
 *   rootCauseAssumption, severity, confidenceScore,
 *   sourceResult, gmanaResult,
 *   flaggedForFurtherAnalysis, details
 * }
 *
 * ─── STATE CHANGES ────────────────────────────────────────
 * None. ManagerAgent writes all incident state based on this report.
 *
 * ─── ENABLES EARLY EXITS ──────────────────────────────────
 * SOURCE_ISSUE → ManagerAgent notifies customer only, no pod restarts, STOP
 * NO_ISSUE     → Alarm was transient, no action needed, STOP
 * ============================================================
 */

import { AlarmData, StreamUrls } from '../tools/HubMonitorTool';
import { ErrorDetectionPlayerTool, PlayerCheckResult } from '../tools/ErrorDetectionPlayerTool';
import { logger } from '../utils/logger';

// ─── Report returned to ManagerAgent ─────────────────────────────────────────

export interface StreamAnalysisReport {
  channelName: string;
  dsUuid: string;
  isVip: boolean;
  alarmType: string;
  alarmReason: string;
  sourceStatus: 'healthy' | 'down';
  gmanaStatus: 'healthy' | 'down';
  rootCauseAssumption: 'SOURCE_ISSUE' | 'GMANA_ISSUE' | 'BOTH_DOWN' | 'NO_ISSUE' | 'UNKNOWN';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidenceScore: number;
  sourceResult: PlayerCheckResult;
  gmanaResult: PlayerCheckResult;
  flaggedForFurtherAnalysis: boolean;
  details: string;
}

// VIP customers — any alarm on these triggers immediate escalation
const VIP_KEYWORDS = ['keshet', 'reshet'];

export class StreamAnalyzerAgent {
  constructor(private errorPlayer: ErrorDetectionPlayerTool) {}

  /**
   * Main entry point called by ManagerAgent.
   * Analyzes the stream health for a given alarm and returns a structured report.
   */
  async analyze(alarm: AlarmData, streamUrls: StreamUrls): Promise<StreamAnalysisReport> {
    logger.info(`[StreamAnalyzer] Starting stream analysis for channel: ${alarm.channelName}`);

    // Check both stream URLs in parallel
    const { source, gmana } = await this.errorPlayer.checkBoth(
      streamUrls.sourcePlayerUrl,
      streamUrls.gManaPlayerUrl,
    );

    const isVip = VIP_KEYWORDS.some(
      (keyword) =>
        alarm.channelName.toLowerCase().includes(keyword) ||
        streamUrls.customerName.toLowerCase().includes(keyword),
    );

    const sourceStatus: StreamAnalysisReport['sourceStatus'] = source.hasError ? 'down' : 'healthy';
    const gmanaStatus: StreamAnalysisReport['gmanaStatus'] = gmana.hasError ? 'down' : 'healthy';

    const { rootCauseAssumption, severity, confidenceScore, details } =
      this.determineRootCause(alarm, source, gmana, isVip);

    const flaggedForFurtherAnalysis = confidenceScore < 80;

    logger.info(
      `[StreamAnalyzer] Result for ${alarm.channelName}: ` +
        `root=${rootCauseAssumption} | severity=${severity} | ` +
        `confidence=${confidenceScore}% | vip=${isVip} | flagged=${flaggedForFurtherAnalysis}`,
    );

    return {
      channelName: alarm.channelName,
      dsUuid: alarm.dsUuid,
      isVip,
      alarmType: alarm.errorType,
      alarmReason: alarm.reason,
      sourceStatus,
      gmanaStatus,
      rootCauseAssumption,
      severity,
      confidenceScore,
      sourceResult: source,
      gmanaResult: gmana,
      flaggedForFurtherAnalysis,
      details,
    };
  }

  // ─── Root cause logic ─────────────────────────────────────────────────────

  private determineRootCause(
    alarm: AlarmData,
    source: PlayerCheckResult,
    gmana: PlayerCheckResult,
    isVip: boolean,
  ): {
    rootCauseAssumption: StreamAnalysisReport['rootCauseAssumption'];
    severity: StreamAnalysisReport['severity'];
    confidenceScore: number;
    details: string;
  } {
    // Both streams down — likely network/CDN level issue
    if (source.hasError && gmana.hasError) {
      return {
        rootCauseAssumption: 'BOTH_DOWN',
        severity: isVip ? 'critical' : 'high',
        confidenceScore: 90,
        details:
          `Both source and G-Mana streams are unreachable. ` +
          `Source error: ${source.errorType} | G-Mana error: ${gmana.errorType}. ` +
          `Likely a CDN or network-level failure. Escalate immediately.`,
      };
    }

    // Source is down — G-Mana cannot function, not our fault
    if (source.hasError) {
      return {
        rootCauseAssumption: 'SOURCE_ISSUE',
        severity: isVip ? 'high' : 'medium',
        confidenceScore: 95,
        details:
          `Source stream is down (${source.errorType}: ${source.errorDetail}). ` +
          `G-Mana cannot stitch ads without a healthy source. ` +
          `Do NOT restart G-Mana pods. Notify the customer.`,
      };
    }

    // Source is healthy but G-Mana is down — our problem
    if (gmana.hasError) {
      const confidence = this.calculateGmanaConfidence(alarm, gmana);
      return {
        rootCauseAssumption: 'GMANA_ISSUE',
        severity: isVip ? 'critical' : 'high',
        confidenceScore: confidence,
        details:
          `Source stream is healthy. G-Mana stream has errors: ` +
          `${gmana.errorType} (HTTP ${gmana.statusCode}) — ${gmana.errorDetail}. ` +
          `Alarm type: ${alarm.errorType}. Pod restart likely needed.`,
      };
    }

    // Both healthy — alarm may have been transient
    return {
      rootCauseAssumption: 'NO_ISSUE',
      severity: 'low',
      confidenceScore: 85,
      details:
        'Both source and G-Mana streams are healthy. ' +
        'The alarm may have been transient or self-resolved. Monitor for recurrence.',
    };
  }

  /**
   * Higher confidence when the alarm type matches the observed error pattern.
   */
  private calculateGmanaConfidence(alarm: AlarmData, gmana: PlayerCheckResult): number {
    if ((alarm.errorType?.includes('MANIFEST') || alarm.errorType?.includes('MPD')) &&
        (gmana.statusCode === 404 || gmana.statusCode === 502)) {
      return 88;
    }
    if (alarm.errorType?.includes('AD') || alarm.errorType?.includes('SCTE')) {
      return 82;
    }
    if (gmana.statusCode === 502 || gmana.statusCode === 503) {
      return 85;
    }
    // Pattern unclear — lower confidence, flag for further analysis
    return 70;
  }
}
