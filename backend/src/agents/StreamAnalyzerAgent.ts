/**
 * StreamAnalyzerAgent.ts
 * ============================================================
 * AGENT 1: STREAM ANALYZER
 *
 * Primary Responsibility:
 *   Monitor channel streams and detect streaming-related issues.
 *
 * What this agent does:
 *   1. Receives an alarm and the channel's stream URLs
 *   2. Checks both source and G-Mana stream URLs in parallel
 *   3. Determines whether the issue is in the source or G-Mana
 *   4. Identifies VIP customers
 *   5. Calculates a confidence score
 *   6. Returns a StreamAnalysisReport to the ManagerAgent
 *
 * If confidence < 80%, the report is flagged for further analysis.
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
