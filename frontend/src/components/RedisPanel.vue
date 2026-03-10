<template>
  <div class="redis-wrap" ref="wrapRef">
    <!-- Topbar button -->
    <button class="redis-btn" :class="{ active: open }" @click="toggle">
      <span class="redis-dot" :class="redisStore.totalUnhealthy > 0 ? 'dot-red' : 'dot-green'"></span>
      Redis
      <span class="redis-unhealthy" v-if="redisStore.totalUnhealthy > 0">{{ redisStore.totalUnhealthy }}</span>
      <span class="chevron" :class="{ rotated: open }">▾</span>
    </button>

    <!-- Dropdown panel -->
    <div v-if="open" class="redis-dropdown">
      <div class="panel-header">
        <span class="panel-title">Redis Health</span>
        <span class="panel-updated" v-if="redisStore.lastFetched">
          {{ formatTime(redisStore.lastFetched) }}
        </span>
      </div>

      <div v-if="redisStore.loading && redisStore.clusters.length === 0" class="panel-loading">
        Loading...
      </div>

      <!-- Cluster list -->
      <div v-else class="cluster-list">
        <div
          v-for="cluster in redisStore.clusters"
          :key="cluster.clusterName"
          class="cluster-block"
        >
          <!-- Cluster header -->
          <button
            class="cluster-header"
            :class="{ expanded: expandedCluster === cluster.clusterName }"
            @click="toggleCluster(cluster.clusterName)"
          >
            <span class="cluster-dot"
              :class="(cluster.unhealthyInstances || 0) > 0 ? 'dot-red' : 'dot-green'">
            </span>
            <span class="cluster-name">{{ cluster.clusterName }}</span>
            <span class="cluster-stats dim">
              {{ cluster.healthyInstances }}/{{ cluster.totalInstances }} healthy
            </span>
            <span class="cluster-chevron" :class="{ rotated: expandedCluster === cluster.clusterName }">▾</span>
          </button>

          <!-- Instance list -->
          <div v-if="expandedCluster === cluster.clusterName" class="instance-list">
            <div
              v-for="inst in cluster.instances"
              :key="inst.instanceName"
              class="instance-row"
            >
              <span
                class="inst-dot"
                :class="redisStore.isInstanceHealthy(inst, cluster.thresholds) ? 'dot-green' : 'dot-red'"
              ></span>
              <span class="inst-name mono">{{ inst.instanceName }}</span>
              <span class="inst-meta dim">
                CPU {{ inst.cpuUsagePercent.toFixed(1) }}%
                · MEM {{ inst.usedMemory }}<template v-if="inst.maxMemoryBytes > 0">/{{ inst.maxMemory }}</template>
                · {{ inst.connectedClients }} conn
                · {{ inst.restartCount }}↺
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRedisStore } from '@/store/redis';

const redisStore = useRedisStore();
const open = ref(false);
const expandedCluster = ref<string | null>(null);
const wrapRef = ref<HTMLElement | null>(null);

function toggle(): void {
  open.value = !open.value;
}

function toggleCluster(name: string): void {
  expandedCluster.value = expandedCluster.value === name ? null : name;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function onClickOutside(e: MouseEvent): void {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

let pollTimer: ReturnType<typeof setInterval>;

onMounted(() => {
  redisStore.fetchRedis();
  pollTimer = setInterval(() => redisStore.fetchRedis(), 30_000);
  document.addEventListener('click', onClickOutside);
});

onUnmounted(() => {
  clearInterval(pollTimer);
  document.removeEventListener('click', onClickOutside);
});
</script>

<style scoped>
.redis-wrap { position: relative; }

.redis-btn {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid #252b36; border-radius: 6px;
  color: #8896aa; padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.redis-btn:hover, .redis-btn.active {
  border-color: #4d9de0; color: #edf2f7; background: #111318;
}

.redis-dot, .cluster-dot, .inst-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.dot-green { background: #3fb950; }
.dot-red   { background: #f85149; }

.redis-unhealthy {
  background: rgba(248,81,73,.2); color: #f85149;
  border-radius: 10px; padding: 0 5px; font-size: 10px; font-weight: 700;
}

.chevron, .cluster-chevron {
  font-size: 10px; transition: transform .2s; display: inline-block;
}
.chevron.rotated, .cluster-chevron.rotated { transform: rotate(180deg); }

/* Dropdown */
.redis-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 320px; background: #111318; border: 1px solid #252b36;
  border-radius: 8px; z-index: 1000; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}

.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; border-bottom: 1px solid #1e2330;
}
.panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #4f5b6e; }
.panel-updated { font-size: 10px; color: #2e3545; font-family: monospace; }
.panel-loading { padding: 20px; text-align: center; color: #4f5b6e; font-size: 11px; }

.cluster-list { max-height: 400px; overflow-y: auto; }

.cluster-header {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; background: transparent; border: none;
  border-bottom: 1px solid #1e2330; cursor: pointer;
  transition: background .1s;
}
.cluster-header:hover { background: #0d1017; }
.cluster-header.expanded { background: #0d1017; }

.cluster-name { font-size: 12px; font-weight: 600; color: #edf2f7; font-family: monospace; flex: 1; text-align: left; }
.cluster-stats { font-size: 10px; }

.instance-list { background: #0d1017; border-bottom: 1px solid #1e2330; }
.instance-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 20px;
}
.instance-row:not(:last-child) { border-bottom: 1px solid #1a1f28; }

.inst-name { font-size: 12px; font-weight: 600; width: 32px; }
.inst-meta { font-size: 10px; flex: 1; }
.mono { font-family: monospace; }
.dim { color: #4f5b6e; }
</style>
