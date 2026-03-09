/**
 * ResourcesAnalyzerAgent.ts
 * ============================================================
 * AGENT 2: RESOURCES ANALYZER
 *
 * Primary Responsibility:
 *   Monitor system infrastructure and resource stability.
 *
 * What this agent does:
 *   1. Fetches UH pod logs, CI pod logs, and Redis health — in parallel
 *   2. Scans logs for ERROR / WARN / CrashLoop patterns
 *   3. Checks Redis instance health (CPU, memory, restart count)
 *   4. Identifies which component is affected (UH, CI, Redis, or none)
 *   5. Calculates a confidence score
 *   6. Returns a ResourcesAnalysisReport to the ManagerAgent
 *
 * If confidence < 80%, the report is flagged for further analysis.
 * ============================================================
 */

import { HubMonitorTool, ClusterResources, PodLogs } from '../tools/HubMonitorTool';
import { logger } from '../utils/logger';

// ─── Report returned to ManagerAgent ─────────────────────────────────────────

export interface ResourcesAnalysisReport {
  clusterName: string;
  dsUuid: string;
  uhLogs: PodLogs;
  ciLogs: PodLogs;
  redisResources: ClusterResources | null;
  affectedComponent: 'UH' | 'CI' | 'REDIS' | 'NONE' | 'UNKNOWN';
  resourceIssueType: 'CPU_HIGH' | 'MEMORY_HIGH' | 'REDIS_DOWN' | 'POD_CRASH' | 'NONE' | 'UNKNOWN';
  severity: 'low' | 'medium' | 'high' | 'critical';
  possibleStreamImpact: string;
  confidenceScore: number;
  flaggedForFurtherAnalysis: boolean;
  details: string;
}

export class ResourcesAnalyzerAgent {
  constructor(private hubMonitor: HubMonitorTool) {}

  /**
   * Main entry point called by ManagerAgent.
   * Fetches all infrastructure data in parallel and returns a structured report.
   */
  async analyze(clusterName: string, dsUuid: string): Promise<ResourcesAnalysisReport> {
    logger.info(
      `[ResourcesAnalyzer] Starting infrastructure analysis for ${dsUuid} on cluster ${clusterName}`,
    );

    // Fetch UH logs, CI logs, and Redis resources all in parallel
    // Use allSettled so one failure doesn't block the others
    const [uhResult, ciResult, redisResult] = await Promise.allSettled([
      this.hubMonitor.getUHLogs(clusterName, dsUuid),
      this.hubMonitor.getCILogs(clusterName, dsUuid),
      this.hubMonitor.getRedisResources(clusterName),
    ]);

    const uhLogs: PodLogs =
      uhResult.status === 'fulfilled' ? uhResult.value : { podName: '', logs: '' };
    const ciLogs: PodLogs =
      ciResult.status === 'fulfilled' ? ciResult.value : { podName: '', logs: '' };
    const redisResources: ClusterResources | null =
      redisResult.status === 'fulfilled' ? redisResult.value : null;

    if (uhResult.status === 'rejected') {
      logger.warn(`[ResourcesAnalyzer] Could not fetch UH logs: ${uhResult.reason}`);
    }
    if (ciResult.status === 'rejected') {
      logger.warn(`[ResourcesAnalyzer] Could not fetch CI logs: ${ciResult.reason}`);
    }
    if (redisResult.status === 'rejected') {
      logger.warn(`[ResourcesAnalyzer] Could not fetch Redis resources: ${redisResult.reason}`);
    }

    // Analyze each data source
    const uhErrors = this.extractErrors(uhLogs.logs);
    const ciErrors = this.extractErrors(ciLogs.logs);
    const redisDown = redisResources?.instances.some((i) => !i.isHealthy) ?? false;
    const highCpu = redisResources?.instances.some((i) => i.cpuUsagePercent > 85) ?? false;
    const highMemory =
      redisResources?.instances.some((i) => {
        if (!i.maxMemoryBytes) return false;
        return i.usedMemoryBytes / i.maxMemoryBytes > 0.9;
      }) ?? false;

    const report = this.buildReport(
      clusterName,
      dsUuid,
      uhLogs,
      ciLogs,
      redisResources,
      uhErrors,
      ciErrors,
      redisDown,
      highCpu,
      highMemory,
    );

    logger.info(
      `[ResourcesAnalyzer] Result for ${dsUuid}: ` +
        `component=${report.affectedComponent} | issue=${report.resourceIssueType} | ` +
        `severity=${report.severity} | confidence=${report.confidenceScore}%`,
    );

    return report;
  }

  // ─── Report builder ───────────────────────────────────────────────────────

  private buildReport(
    clusterName: string,
    dsUuid: string,
    uhLogs: PodLogs,
    ciLogs: PodLogs,
    redisResources: ClusterResources | null,
    uhErrors: string[],
    ciErrors: string[],
    redisDown: boolean,
    highCpu: boolean,
    highMemory: boolean,
  ): ResourcesAnalysisReport {
    // Priority: Redis down > Pod crash > Memory high > CPU high > No issue

    if (redisDown) {
      const unhealthyNames = redisResources!.instances
        .filter((i) => !i.isHealthy)
        .map((i) => i.instanceName)
        .join(', ');
      return this.makeReport(clusterName, dsUuid, uhLogs, ciLogs, redisResources, {
        affectedComponent: 'REDIS',
        resourceIssueType: 'REDIS_DOWN',
        severity: 'critical',
        confidenceScore: 92,
        possibleStreamImpact:
          'Session state loss — all channels on this cluster may lose stream continuity',
        details: `Redis instance(s) down: ${unhealthyNames}. Session data shared between UH and CI pods is unavailable.`,
      });
    }

    if (uhErrors.length > 0 && ciErrors.length > 0) {
      return this.makeReport(clusterName, dsUuid, uhLogs, ciLogs, redisResources, {
        affectedComponent: 'UH',
        resourceIssueType: 'POD_CRASH',
        severity: 'high',
        confidenceScore: 82,
        possibleStreamImpact: 'Both UH and CI pods degraded — manifest delivery and ad insertion broken',
        details:
          `UH errors (${uhErrors.length}): ${uhErrors.slice(0, 2).join(' | ')} ` +
          `| CI errors (${ciErrors.length}): ${ciErrors.slice(0, 2).join(' | ')}`,
      });
    }

    if (uhErrors.length > 0) {
      return this.makeReport(clusterName, dsUuid, uhLogs, ciLogs, redisResources, {
        affectedComponent: 'UH',
        resourceIssueType: 'POD_CRASH',
        severity: 'high',
        confidenceScore: 87,
        possibleStreamImpact: 'Manifest delivery broken — G-Mana stream likely returning 502/404',
        details: `UH pod has ${uhErrors.length} error(s): ${uhErrors.slice(0, 3).join(' | ')}`,
      });
    }

    if (ciErrors.length > 0) {
      return this.makeReport(clusterName, dsUuid, uhLogs, ciLogs, redisResources, {
        affectedComponent: 'CI',
        resourceIssueType: 'POD_CRASH',
        severity: 'medium',
        confidenceScore: 82,
        possibleStreamImpact: 'Ad insertion broken — SCTE-35 markers missing from G-Mana output',
        details: `CI pod has ${ciErrors.length} error(s): ${ciErrors.slice(0, 3).join(' | ')}`,
      });
    }

    if (highMemory) {
      return this.makeReport(clusterName, dsUuid, uhLogs, ciLogs, redisResources, {
        affectedComponent: 'REDIS',
        resourceIssueType: 'MEMORY_HIGH',
        severity: 'medium',
        confidenceScore: 75,
        possibleStreamImpact: 'Risk of key eviction — session state may become inconsistent',
        details: 'Redis memory usage exceeds 90% threshold. Degradation risk is high.',
      });
    }

    if (highCpu) {
      return this.makeReport(clusterName, dsUuid, uhLogs, ciLogs, redisResources, {
        affectedComponent: 'REDIS',
        resourceIssueType: 'CPU_HIGH',
        severity: 'low',
        confidenceScore: 70,
        possibleStreamImpact: 'Possible latency increase — monitor for worsening',
        details: 'Redis CPU usage exceeds 85% threshold. No immediate action required.',
      });
    }

    // No infrastructure issues found
    return this.makeReport(clusterName, dsUuid, uhLogs, ciLogs, redisResources, {
      affectedComponent: 'NONE',
      resourceIssueType: 'NONE',
      severity: 'low',
      confidenceScore: 85,
      possibleStreamImpact: 'None — infrastructure appears healthy',
      details: 'No Redis degradation or pod errors detected. Issue is likely at the stream/application level.',
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private makeReport(
    clusterName: string,
    dsUuid: string,
    uhLogs: PodLogs,
    ciLogs: PodLogs,
    redisResources: ClusterResources | null,
    fields: {
      affectedComponent: ResourcesAnalysisReport['affectedComponent'];
      resourceIssueType: ResourcesAnalysisReport['resourceIssueType'];
      severity: ResourcesAnalysisReport['severity'];
      confidenceScore: number;
      possibleStreamImpact: string;
      details: string;
    },
  ): ResourcesAnalysisReport {
    return {
      clusterName,
      dsUuid,
      uhLogs,
      ciLogs,
      redisResources,
      flaggedForFurtherAnalysis: fields.confidenceScore < 80,
      ...fields,
    };
  }

  private extractErrors(logs: string): string[] {
    return logs
      .split('\n')
      .filter(
        (line) =>
          line.includes('ERROR') ||
          line.includes('WARN') ||
          line.includes('CrashLoop') ||
          line.includes('OOMKilled') ||
          line.includes('panic'),
      )
      .slice(-10);
  }
}
