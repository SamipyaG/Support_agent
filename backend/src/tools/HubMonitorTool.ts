/**
 * HubMonitorTool.ts
 * All external API calls — Hub Monitor + G11 Channel API
 *
 * Every URL is read from .env — nothing hardcoded here.
 *
 * 7 APIs:
 *  1. getActiveAlarms()   GET  HUB_MONITOR_BASE_URL/sendalarms/status/alarms
 *  2. getStreamUrls()     GET  G11_BASE_URL/api_v1/channel/getAll/?uuid={ds_uuid}
 *  3. getRedisResources() GET  HUB_MONITOR_BASE_URL/sendalarms/clusters/{cluster}/redis-instances
 *  4. getUHLogs()         GET  HUB_MONITOR_BASE_URL/sendalarms/clusters/{cluster}/pods/user-handler-{uuid}/logs
 *  5. getCILogs()         GET  HUB_MONITOR_BASE_URL/sendalarms/clusters/{cluster}/pods/cuemana-in-{uuid}/logs
 *  6. restartUH()         POST HUB_MONITOR_BASE_URL/sendalarms/clusters/{cluster}/deployments/userhandler-{uuid}/restart
 *  7. restartCI()         POST HUB_MONITOR_BASE_URL/sendalarms/clusters/{cluster}/deployments/cuemana-in-{uuid}/restart
 */

import axios, { AxiosInstance } from 'axios';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

// ─── Raw shapes (exactly as returned by the APIs) ─────────────────────────────

interface RawAlarm {
  uuid: string;
  ds_uuid: string;
  channelName: string;
  status: string;               // "ON" or "OFF"
  status_code: number;
  alarmTemplateID: string;      // e.g. "PROFILE_MANIFEST_BAD_RESPONSE"
  _redisKey: string;            // e.g. "8c573563-...:EXTERNAL"
  time_on: string;              // ISO — when alarm started
  time_of: string | null;       // ISO — when alarm ended (null if still active)
  reason: string;
  url: string;
  gmana_url: string | null;
  last_update: string;
  analyzerName: string;
  monitorType: string;
  source: string;
  groupId: string;
  osmessage?: string;
  review?: boolean;          // if true, alarm is already under manual review — skip automation
}

interface RawChannelDetail {
  uuid: string;
  name: string;
  url: string;            // sourcePlayerUrl
  stream_output: string;  // gManaPlayerUrl
  dstype: string;         // "hls" or "dash"
  type: string;           // "Live" or "VoD"
}

interface RawChannelGetResponse {
  data: RawChannelDetail;
}


interface RawRedisInstance {
  isHealthy: boolean;
  lastCheck: string;
  error: string | null;
  stats: {
    uptime: string;
    connectedClients: number;
    role: string;
    usedMemory: string;
    maxMemory: string;
    usedMemoryBytes: number;
    maxMemoryBytes: number;
    cpuUsagePercent: string;
    evictedKeys: number;
    dbKeys: string;
    tests: {
      latency: {
        exceedsThreshold: boolean;
        threshold: number;
        averageLatency: string;
        maxLatency: number;
        minLatency: number;
        error: string | null;
      };
    };
  };
  restartCount: number;
}

interface RawRedisResponse {
  name: string;
  displayName: string;
  lastCheck: string;
  totalInstances: number;
  healthyInstances: number;
  unhealthyInstances: number;
  instances: { [instanceName: string]: RawRedisInstance };
  thresholds: {
    cpuThresholdPercent: number;
    memoryThresholdBytes: number;
    memoryThresholdGB: number;
    connectionsThreshold: number;
    restartThreshold: number;
  };
}

interface RawPodsResponse {
  pods: Array<{ name: string; [key: string]: unknown }>;
}

interface RawLogsResponse {
  pod_name: string;
  namespace: string;
  container: string;
  tail_lines: number;
  logs: string;
  timestamp: string;
  response_time_ms: number;
}

interface RawRestartResponse {
  message: string;
  deployment_name: string;
  namespace: string;
  kubectl_output: string;
  timestamp: string;
  response_time_ms: number;
}

interface RawStreamDetails {
  clusterInfo?: { name?: string };
  channel?: { redis?: { redisKey?: string } };
}

// ─── Clean output shapes (used by ManagerAgent) ───────────────────────────────

export interface StreamDetails {
  clusterName: string;
  redisKey: string;
}

export interface AlarmData {
  dsUuid: string;
  channelName: string;
  analyzerName: string;     // e.g. "Skandha TV POC - SBS Gmana" or "elpais-agiletves-live Source"
  status: 'ON' | 'OFF';
  statusCode: number;
  errorType: string;        // alarmTemplateID
  redisKey: string;         // _redisKey
  startedAt: string;        // time_on
  endedAt: string | null;   // time_of
  reason: string;
  alarmUrl: string;         // monitored URL that triggered the alarm (source URL)
  gmanaUrl: string | null;  // G-Mana output URL for this channel
  review: boolean;          // if true, already under manual review — skip automation
}

export interface StreamUrls {
  dsUuid: string;
  channelName: string;
  sourcePlayerUrl: string;        // from url
  gManaPlayerUrl: string;         // from stream_output
  customerName: string;
  streamType: string;             // from dstype: hls / dash
  channelType: string;            // from type: Live / VoD
  clusterName: string;            // from clusterName or env fallback
}

export interface RedisInstanceHealth {
  instanceName: string;
  isHealthy: boolean;
  usedMemory: string;
  maxMemory: string;
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  cpuUsagePercent: number;
  connectedClients: number;
  exceedsThreshold: boolean;
  restartCount: number;
}

export interface ClusterResources {
  clusterName: string;
  totalInstances: number;
  healthyInstances: number;
  unhealthyInstances: number;
  instances: RedisInstanceHealth[];
  thresholds: {
    cpuThresholdPercent: number;
    memoryThresholdGB: number;
    connectionsThreshold: number;
    restartThreshold: number;
  };
}

export interface PodLogs {
  podName: string;
  logs: string;
}

export interface RestartResult {
  success: boolean;
  message: string;
  deploymentName: string;
  timestamp: string;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export class HubMonitorTool {
  private hubClient: AxiosInstance;   // Hub Monitor API — API Key auth
  private g11Client: AxiosInstance;   // G11 Channel API — Bearer auth

  constructor() {
    // Hub Monitor — API Key authentication
    this.hubClient = axios.create({
      baseURL: process.env.HUB_MONITOR_BASE_URL,
      headers: {
        'x-api-key': process.env.HUB_MONITOR_API_KEY || 'support123',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    // G11 Channel API — token authentication
    this.g11Client = axios.create({
      baseURL: process.env.G11_BASE_URL,
      headers: {
        Authorization: process.env.G11_AUTH_TOKEN || '',
        'Login-As': 'null',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    this.hubClient.interceptors.request.use((config) => {
      const fullUrl = (config.baseURL || '') + (config.url || '');
      console.log(`[HubMonitor REQUEST] ${config.method?.toUpperCase()} ${fullUrl}`);
      logger.debug(`[HubMonitor] ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    this.g11Client.interceptors.request.use((config) => {
      logger.debug(`[G11] ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });
  }

  // ═══════════════════════════════════════
  // API 1 — GET ACTIVE ALARMS
  // GET /sendalarms/status/alarms
  // Polled every POLL_INTERVAL_MS from index.ts
  // ═══════════════════════════════════════

  async getActiveAlarms(): Promise<AlarmData[]> {
    return withRetry(async () => {
      logger.info('[HubMonitor] Polling active alarms...');
      const res = await this.hubClient.get<RawAlarm[]>(
        process.env.HUB_ALARMS_PATH || '/sendalarms/status/alarms',
        { params: { reviewed: false } },
      );
      // Return ALL alarms (including review=true ones) so callers can detect
      // which dsUuids are still active in Hub Monitor.  The review filtering
      // is done in processAlarms() which needs the full set for stale-incident
      // detection.
      const alarms = res.data.map((raw) => this.mapAlarm(raw));
      const reviewCount = alarms.filter((a) => a.review).length;
      logger.info(`[HubMonitor] Got ${alarms.length} alarms (${reviewCount} under manual review, ${alarms.length - reviewCount} actionable)`);
      return alarms;
    }, 'getActiveAlarms');
  }

  // ═══════════════════════════════════════
  // API 2 — GET STREAM URLS
  // GET G11_BASE_URL/api_v1/channel/getAll/?uuid={ds_uuid}
  // Returns sourcePlayerUrl + gManaPlayerUrl for the channel
  // ═══════════════════════════════════════

  async getStreamUrls(dsUuid: string): Promise<StreamUrls> {
    return withRetry(async () => {
      logger.info(`[G11] Getting stream URLs for ${dsUuid}`);

      const pathTemplate = process.env.G11_CHANNEL_PATH || '/api_v1/channel/get/{uuid}';
      const res = await this.g11Client.get<RawChannelGetResponse>(
        pathTemplate.replace('{uuid}', dsUuid),
      );

      const channel = res.data?.data;
      if (!channel) {
        throw new Error(`Channel not found in G11 for ds_uuid: ${dsUuid}`);
      }

      return {
        dsUuid,
        channelName: channel.name,
        sourcePlayerUrl: channel.url,
        gManaPlayerUrl: channel.stream_output,
        customerName: '',
        streamType: (channel.dstype || 'hls').toLowerCase(),
        channelType: channel.type || 'Live',
        clusterName: '',
      };
    }, `getStreamUrls(${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // API 8 — GET STREAM DETAILS (cluster + redis key)
  // GET /sendalarms/streams/{uuid}/details
  // ═══════════════════════════════════════

  async getStreamDetails(dsUuid: string): Promise<StreamDetails> {
    return withRetry(async () => {
      logger.info(`[HubMonitor] Getting stream details for ${dsUuid}`);
      const path = (process.env.HUB_STREAM_DETAILS_PATH || '/sendalarms/streams/{uuid}/details')
        .replace('{uuid}', dsUuid);
      const res = await this.hubClient.get<RawStreamDetails>(path);
      return {
        clusterName: res.data?.clusterInfo?.name || '',
        redisKey:    res.data?.channel?.redis?.redisKey || '',
      };
    }, `getStreamDetails(${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // API 3 — ANALYZE RESOURCES (Redis)
  // GET /sendalarms/clusters/{cluster}/redis-instances
  // ═══════════════════════════════════════

  async getRedisResources(cluster: string): Promise<ClusterResources> {
    return withRetry(async () => {
      logger.info(`[HubMonitor] Getting Redis resources for cluster ${cluster}`);
      const path = (process.env.HUB_REDIS_PATH || '/sendalarms/clusters/{cluster}/redis-instances')
        .replace('{cluster}', cluster);
      const res = await this.hubClient.get<RawRedisResponse>(path);
      return this.mapClusterResources(res.data);
    }, `getRedisResources(${cluster})`);
  }

  // ═══════════════════════════════════════
  // API 4 — UH LOGS
  // GET /sendalarms/clusters/{cluster}/pods/user-handler-{uuid}/logs
  // Always call BEFORE restartUH — logs lost on pod restart
  // ═══════════════════════════════════════

  async getUHLogs(cluster: string, dsUuid: string): Promise<PodLogs> {
    return withRetry(async () => {
      logger.info(`[HubMonitor] Downloading UH logs: ${cluster}/${dsUuid}`);
      // Step 1: get pod name
      const podsPath = `/sendalarms/clusters/${cluster}/deployments/user-handler-${dsUuid}/pods`;
      const podsRes = await this.hubClient.get<RawPodsResponse>(podsPath);
      const podName = podsRes.data.pods[0]?.name;
      if (!podName) throw new Error(`No pods found for user-handler-${dsUuid}`);
      // Step 2: download logs using pod name
      const logsPath = `/sendalarms/clusters/${cluster}/pods/${podName}/logs`;
      const res = await this.hubClient.get<RawLogsResponse>(logsPath);
      return { podName, logs: res.data.logs };
    }, `getUHLogs(${cluster}/${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // API 5 — CI LOGS
  // GET /sendalarms/clusters/{cluster}/pods/cuemana-in-{uuid}/logs
  // Always call BEFORE restartCI — logs lost on pod restart
  // ═══════════════════════════════════════

  async getCILogs(cluster: string, dsUuid: string): Promise<PodLogs> {
    return withRetry(async () => {
      logger.info(`[HubMonitor] Downloading CI logs: ${cluster}/${dsUuid}`);
      // Step 1: get pod name
      const podsPath = `/sendalarms/clusters/${cluster}/deployments/cuemana-in-${dsUuid}/pods`;
      const podsRes = await this.hubClient.get<RawPodsResponse>(podsPath);
      const podName = podsRes.data.pods[0]?.name;
      if (!podName) throw new Error(`No pods found for cuemana-in-${dsUuid}`);
      // Step 2: download logs using pod name
      const logsPath = `/sendalarms/clusters/${cluster}/pods/${podName}/logs`;
      const res = await this.hubClient.get<RawLogsResponse>(logsPath);
      return { podName, logs: res.data.logs };
    }, `getCILogs(${cluster}/${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // API 6 — RESTART UH
  // POST /sendalarms/clusters/{cluster}/deployments/user-handler-{uuid}/restart
  // ═══════════════════════════════════════

  async restartUH(cluster: string, dsUuid: string): Promise<RestartResult> {
    return withRetry(async () => {
      logger.info(`[HubMonitor] Restarting UH: ${cluster}/${dsUuid}`);
      const path = (process.env.HUB_UH_RESTART_PATH || '/sendalarms/clusters/{cluster}/deployments/user-handler-{uuid}/restart')
        .replace('{cluster}', cluster).replace('{uuid}', dsUuid);
      console.log(`[HubMonitor restartUH] Full URL → ${process.env.HUB_MONITOR_BASE_URL}${path}`);
      const res = await this.hubClient.post<RawRestartResponse>(path);
      const result: RestartResult = {
        success: res.status === 200 || res.status === 202,
        message: res.data.message,
        deploymentName: res.data.deployment_name,
        timestamp: res.data.timestamp,
      };
      logger.info(`[HubMonitor] UH restart: ${result.message}`);
      return result;
    }, `restartUH(${cluster}/${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // API 7 — RESTART CI
  // POST /sendalarms/clusters/{cluster}/deployments/cuemana-in-{uuid}/restart
  // ═══════════════════════════════════════

  async restartCI(cluster: string, dsUuid: string): Promise<RestartResult> {
    return withRetry(async () => {
      logger.info(`[HubMonitor] Restarting CI: ${cluster}/${dsUuid}`);
      const path = (process.env.HUB_CI_RESTART_PATH || '/sendalarms/clusters/{cluster}/deployments/cuemana-in-{uuid}/restart')
        .replace('{cluster}', cluster).replace('{uuid}', dsUuid);
      const res = await this.hubClient.post<RawRestartResponse>(path);
      const result: RestartResult = {
        success: res.status === 200 || res.status === 202,
        message: res.data.message,
        deploymentName: res.data.deployment_name,
        timestamp: res.data.timestamp,
      };
      logger.info(`[HubMonitor] CI restart: ${result.message}`);
      return result;
    }, `restartCI(${cluster}/${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // API 8 — REDIRECT TRAFFIC TO SOURCE
  // PUT G11_BASE_URL/api_v1/channel/editChannel
  // Moves a percentage of traffic away from G-Mana to the source stream
  // ═══════════════════════════════════════

  async redirectTrafficToSource(
    dsUuid: string,
    channelName: string,
    sourceUrl: string,
    redirectPercentage: number,
  ): Promise<{ success: boolean; message: string }> {
    return withRetry(async () => {
      logger.info(`[G11] Redirecting ${redirectPercentage}% traffic to source for ${dsUuid}`);
      const path = process.env.G11_EDIT_CHANNEL_PATH || '/api_v1/channel/editChannel';
      await this.g11Client.put(path, {
        uuid: dsUuid,
        enable: true,
        name: channelName,
        url: sourceUrl,
        REDIRECT_PRECENTAGE_THRESHOLD: String(redirectPercentage),
        REDIRECT_PRECENTAGE_URL: sourceUrl,
        redirectTo: 'source',
        redirectTraffic: true,
      });
      logger.info(`[G11] Traffic redirected to source (${redirectPercentage}%) for ${dsUuid}`);
      return { success: true, message: `Traffic redirected to source (${redirectPercentage}%)` };
    }, `redirectTrafficToSource(${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // API 9 — REVERT TRAFFIC TO G-MANA
  // PUT G11_BASE_URL/api_v1/channel/editChannel
  // Re-enables G-Mana stream once it has recovered
  // ═══════════════════════════════════════

  async revertTrafficToGMana(
    dsUuid: string,
    channelName: string,
    sourceUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    return withRetry(async () => {
      logger.info(`[G11] Reverting traffic back to G-Mana for ${dsUuid}`);
      const path = process.env.G11_EDIT_CHANNEL_PATH || '/api_v1/channel/editChannel';
      await this.g11Client.put(path, {
        uuid: dsUuid,
        enable: true,
        name: channelName,
        url: sourceUrl,
        redirectTraffic: false,
        redirectTo: 'source',
      });
      logger.info(`[G11] Traffic reverted to G-Mana for ${dsUuid}`);
      return { success: true, message: 'G-Mana stream recovered — traffic restored' };
    }, `revertTrafficToGMana(${dsUuid})`);
  }

  // ═══════════════════════════════════════
  // HEALTH CHECK — Is the G-Mana alarm still active?
  // Proxies through getActiveAlarms() — if no active alarm for
  // this dsUuid, G-Mana has recovered.
  // ═══════════════════════════════════════

  async isGManaAlarmActive(dsUuid: string): Promise<boolean> {
    const alarms = await this.getActiveAlarms();
    return alarms.some((a) => a.dsUuid === dsUuid && a.status === 'ON');
  }

  // ─── Private mappers ─────────────────────────────────────────────────────────

  private mapAlarm(raw: RawAlarm): AlarmData {
    return {
      dsUuid: raw.ds_uuid,
      channelName: raw.channelName,
      analyzerName: raw.analyzerName ?? '',
      status: raw.status === 'ON' ? 'ON' : 'OFF',
      statusCode: raw.status_code,
      errorType: raw.alarmTemplateID,
      redisKey: raw._redisKey,
      startedAt: raw.time_on,
      endedAt: raw.time_of,
      reason: raw.reason,
      alarmUrl: raw.url,
      gmanaUrl: raw.gmana_url,
      review: raw.review ?? false,
    };
  }

  private mapClusterResources(raw: RawRedisResponse): ClusterResources {
    const instances: RedisInstanceHealth[] = Object.entries(raw.instances || {}).map(
      ([name, inst]) => ({
        instanceName: name,
        isHealthy: inst.isHealthy,
        usedMemory: inst.stats?.usedMemory || '0',
        maxMemory: inst.stats?.maxMemory || '0',
        usedMemoryBytes: inst.stats?.usedMemoryBytes || 0,
        maxMemoryBytes: inst.stats?.maxMemoryBytes || 0,
        cpuUsagePercent: parseFloat(inst.stats?.cpuUsagePercent || '0'),
        connectedClients: inst.stats?.connectedClients || 0,
        exceedsThreshold: inst.stats?.tests?.latency?.exceedsThreshold || false,
        restartCount: inst.restartCount || 0,
      }),
    );

    return {
      clusterName: raw.name,
      totalInstances: raw.totalInstances,
      healthyInstances: raw.healthyInstances,
      unhealthyInstances: raw.unhealthyInstances,
      instances,
      thresholds: {
        cpuThresholdPercent: raw.thresholds?.cpuThresholdPercent || 20,
        memoryThresholdGB: raw.thresholds?.memoryThresholdGB || 12,
        connectionsThreshold: raw.thresholds?.connectionsThreshold || 4000,
        restartThreshold: raw.thresholds?.restartThreshold || 1,
      },
    };
  }
}
