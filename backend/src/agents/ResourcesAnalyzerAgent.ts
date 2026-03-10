/**
 * ResourcesAnalyzerAgent.ts
 * ============================================================
 * AGENT 2: RESOURCES ANALYZER AGENT
 * STATUS: ACTIVE
 * TYPE:   Rule-based specialist (no GPT-4o, no state writes)
 *
 * ─── ROLE ─────────────────────────────────────────────────
 * Second analysis agent. Checks all infrastructure health for
 * the affected channel. Runs after ManagerAgent distributes
 * data from the StreamAnalysisReport.
 *
 * ─── COMMUNICATION IN ─────────────────────────────────────
 * Caller: ManagerAgent
 * Method: resourcesAnalyzer.analyze(clusterName, dsUuid)
 *   clusterName — Kubernetes cluster name (e.g. "hub1x")
 *   dsUuid      — unique session ID for the affected channel
 *
 * ─── INTERNAL LOGIC ───────────────────────────────────────
 * All three checks run simultaneously via Promise.allSettled (partial failure OK):
 *
 * CHECK 1 → UH Pod
 *   GET /sendalarms/clusters/{cluster}/pods/user-handler-{dsUuid}/logs
 *   Pod state check: Running | Pending | Failed
 *   Restart count: if > 10 → POD_UNSTABLE
 *   Log scan: ERROR, WARN, CrashLoop, OOMKilled, panic
 *
 * CHECK 2 → CI Pod
 *   GET /sendalarms/clusters/{cluster}/pods/cuemana-in-{dsUuid}/logs
 *   Pod state check: Running | Pending | Failed
 *   Restart count: if > 10 → POD_UNSTABLE
 *   Log scan: ERROR, WARN, CrashLoop
 *
 * CHECK 3 → Redis Clusters
 *   GET /sendalarms/clusters/{cluster}/redis-instances
 *   Monitors: Reshet cluster | Keshet cluster | General customers cluster
 *   Per instance: isHealthy, cpuUsagePercent, usedMemoryBytes/maxMemoryBytes
 *
 * Detection priority (first match wins):
 *   Redis isHealthy=false          → REDIS_DOWN   REDIS   critical  92%
 *   UH errors AND CI errors        → POD_CRASH    UH      high      82%
 *   UH errors only                 → POD_CRASH    UH      high      87%
 *   CI errors only                 → POD_CRASH    CI      medium    82%
 *   Redis memory > 90%             → MEMORY_HIGH  REDIS   medium    75%
 *   Redis CPU > 85%                → CPU_HIGH     REDIS   low       70%
 *   Restart count > 10             → POD_UNSTABLE UH/CI   high      82%
 *   None of the above              → NONE         NONE    low       85%
 *
 * ─── COMMUNICATION OUT ────────────────────────────────────
 * Returns to: ManagerAgent (direct TypeScript return value)
 * Report: ResourcesAnalysisReport {
 *   clusterName, dsUuid,
 *   uhLogs, ciLogs, redisResources,
 *   affectedComponent, resourceIssueType, severity,
 *   confidenceScore, possibleStreamImpact, details,
 *   flaggedForFurtherAnalysis
 * }
 *
 * ─── STATE CHANGES ────────────────────────────────────────
 * None. ManagerAgent writes all incident state.
 *
 * IMPORTANT: Logs are fetched BEFORE any restart is triggered.
 * UH and CI logs are lost when a pod restarts — fetching here preserves evidence.
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
