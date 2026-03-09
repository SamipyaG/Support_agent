import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/api/axios';

export interface RedisInstance {
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

export interface ClusterThresholds {
  cpuThresholdPercent: number;
  memoryThresholdGB: number;
  connectionsThreshold: number;
  restartThreshold: number;
}

export interface ClusterData {
  clusterName: string;
  totalInstances: number;
  healthyInstances: number;
  unhealthyInstances: number;
  instances: RedisInstance[];
  thresholds: ClusterThresholds;
  error?: string;
}

export const useRedisStore = defineStore('redis', () => {
  const clusters = ref<ClusterData[]>([]);
  const loading = ref(false);
  const lastFetched = ref<Date | null>(null);

  const totalUnhealthy = computed(() =>
    clusters.value.reduce((sum, c) => sum + (c.unhealthyInstances || 0), 0),
  );

  function isInstanceHealthy(inst: RedisInstance, thresholds: ClusterThresholds): boolean {
    const memThresholdBytes = thresholds.memoryThresholdGB * 1024 * 1024 * 1024;
    return (
      inst.isHealthy &&
      inst.cpuUsagePercent < thresholds.cpuThresholdPercent &&
      inst.usedMemoryBytes < memThresholdBytes &&
      inst.connectedClients < thresholds.connectionsThreshold &&
      inst.restartCount < thresholds.restartThreshold
    );
  }

  async function fetchRedis(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<{ clusters: ClusterData[] }>('/redis');
      clusters.value = res.data.clusters;
      lastFetched.value = new Date();
    } catch {
      // silently fail — keep stale data
    } finally {
      loading.value = false;
    }
  }

  return { clusters, loading, lastFetched, totalUnhealthy, isInstanceHealthy, fetchRedis };
});
