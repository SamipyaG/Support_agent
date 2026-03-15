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

          <!-- Instance cards -->
          <div v-if="expandedCluster === cluster.clusterName" class="instance-list">
            <div
              v-for="inst in cluster.instances"
              :key="inst.instanceName"
              class="instance-card"
            >
              <!-- Instance header row -->
              <div class="ic-head">
                <span class="ic-dot" :class="getInstStatusClass(inst, cluster.thresholds)"></span>
                <span class="ic-name mono">{{ inst.instanceName }}</span>
                <span v-if="inst.role" class="ic-role-badge" :class="`ri-role-${inst.role.toLowerCase()}`">{{ inst.role }}</span>
                <span class="ic-status-badge" :class="getInstStatusClass(inst, cluster.thresholds)">
                  {{ getInstStatusLabel(inst, cluster.thresholds) }}
                </span>
              </div>

              <!-- Memory section -->
              <div class="ic-metrics">
                <div class="ic-row">
                  <span class="ic-key">Memory Used</span>
                  <span class="ic-val mono" :class="getMemPct(inst) >= 90 ? 'val-critical' : getMemPct(inst) >= 70 ? 'val-warn' : 'val-ok'">
                    {{ inst.usedMemory }}
                  </span>
                </div>
                <div class="ic-row">
                  <span class="ic-key">Capacity</span>
                  <span class="ic-val mono">{{ inst.maxMemory || '—' }}</span>
                </div>
                <div class="ic-row">
                  <span class="ic-key">Usage</span>
                  <span class="ic-val mono" :class="getMemPct(inst) >= 90 ? 'val-critical' : getMemPct(inst) >= 70 ? 'val-warn' : 'val-ok'">
                    {{ getMemPct(inst) }}%
                  </span>
                </div>
                <div class="ic-bar-bg">
                  <div class="ic-bar-fill" :class="getInstStatusClass(inst, cluster.thresholds)" :style="{ width: `${Math.min(getMemPct(inst), 100)}%` }"></div>
                </div>
              </div>

              <!-- CPU / Connections / Restarts -->
              <div class="ic-metrics ic-metrics-border">
                <div class="ic-row">
                  <span class="ic-key">CPU</span>
                  <span class="ic-val mono" :class="inst.cpuUsagePercent > cluster.thresholds.cpuThresholdPercent ? 'val-warn' : 'val-ok'">
                    {{ inst.cpuUsagePercent.toFixed(1) }}%
                    <span class="ic-thresh">/ {{ cluster.thresholds.cpuThresholdPercent }}%</span>
                  </span>
                </div>
                <div class="ic-row">
                  <span class="ic-key">Connections</span>
                  <span class="ic-val mono" :class="inst.connectedClients > cluster.thresholds.connectionsThreshold ? 'val-warn' : 'val-ok'">
                    {{ inst.connectedClients }}
                    <span class="ic-thresh">/ {{ cluster.thresholds.connectionsThreshold }}</span>
                  </span>
                </div>
                <div class="ic-row">
                  <span class="ic-key">Restarts</span>
                  <span class="ic-val mono" :class="inst.restartCount >= cluster.thresholds.restartThreshold ? 'val-warn' : 'val-ok'">
                    {{ inst.restartCount }}
                    <span class="ic-thresh">/ {{ cluster.thresholds.restartThreshold }}</span>
                  </span>
                </div>
              </div>
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
import type { RedisInstance, ClusterThresholds } from '@/store/redis';

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

function getMemPct(inst: RedisInstance): number {
  if (!inst.maxMemoryBytes) return 0;
  return Math.round((inst.usedMemoryBytes / inst.maxMemoryBytes) * 100);
}

function getInstStatusClass(inst: RedisInstance, thresholds: ClusterThresholds): string {
  const memPct = getMemPct(inst);
  if (!inst.isHealthy || memPct >= 90 || inst.cpuUsagePercent >= thresholds.cpuThresholdPercent) return 'status-critical';
  if (memPct >= 70 || inst.connectedClients >= thresholds.connectionsThreshold || inst.restartCount >= thresholds.restartThreshold) return 'status-warning';
  return 'status-healthy';
}

function getInstStatusLabel(inst: RedisInstance, thresholds: ClusterThresholds): string {
  const cls = getInstStatusClass(inst, thresholds);
  if (cls === 'status-critical') return inst.isHealthy ? 'Critical' : 'Unhealthy';
  if (cls === 'status-warning') return 'Warning';
  return 'Healthy';
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
  background: transparent; border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-2); padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.redis-btn:hover, .redis-btn.active {
  border-color: var(--accent); color: var(--tx-1); background: var(--bg-card);
}

.redis-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.dot-green { background: #3fb950; }
.dot-red   { background: #f85149; }

.redis-unhealthy {
  background: rgba(248,81,73,.2); color: var(--col-err);
  border-radius: 10px; padding: 0 5px; font-size: 10px; font-weight: 700;
}

.chevron, .cluster-chevron {
  font-size: 10px; transition: transform .2s; display: inline-block;
}
.chevron.rotated, .cluster-chevron.rotated { transform: rotate(180deg); }

/* Dropdown */
.redis-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 340px; background: var(--bg-card); border: 1px solid var(--bd);
  border-radius: 8px; z-index: 1000; overflow: hidden;
  box-shadow: var(--shadow);
}

.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; border-bottom: 1px solid var(--bd-sub);
}
.panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--tx-3); }
.panel-updated { font-size: 10px; color: var(--tx-4); font-family: monospace; }
.panel-loading { padding: 20px; text-align: center; color: var(--tx-3); font-size: 11px; }

.cluster-list { max-height: 480px; overflow-y: auto; }

.cluster-header {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; background: transparent; border: none;
  border-bottom: 1px solid var(--bd-sub); cursor: pointer;
  transition: background .1s;
}
.cluster-header:hover { background: var(--bg-deep); }
.cluster-header.expanded { background: var(--bg-deep); }

.cluster-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.cluster-name { font-size: 12px; font-weight: 600; color: var(--tx-1); font-family: monospace; flex: 1; text-align: left; }
.cluster-stats { font-size: 10px; }
.dim { color: var(--tx-3); }

/* Instance cards */
.instance-list { background: var(--bg-deep); border-bottom: 1px solid var(--bd-sub); }

.instance-card {
  padding: 10px 14px;
  border-bottom: 1px solid var(--bd-faint);
}
.instance-card:last-child { border-bottom: none; }

.ic-head {
  display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
}
.ic-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.ic-name { font-size: 12px; font-weight: 600; color: var(--tx-1); flex: 1; }
.mono { font-family: monospace; }

.ic-role-badge {
  font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: .05em;
  background: var(--bd-sub); color: var(--tx-2);
}
.ri-role-master { background: var(--col-ok-bg); color: var(--col-ok); }

.ic-status-badge {
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: .05em;
}

/* Status classes */
.status-healthy  { background: var(--col-ok-bg);   color: var(--col-ok); }
.status-warning  { background: var(--col-warn-bg);  color: var(--col-warn); }
.status-critical { background: var(--col-err-bg);   color: var(--col-err); }
.ic-dot.status-healthy  { background: var(--col-ok); }
.ic-dot.status-warning  { background: var(--col-warn); }
.ic-dot.status-critical { background: var(--col-err); }

/* Metrics grid */
.ic-metrics { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
.ic-metrics-border { padding-top: 6px; border-top: 1px solid var(--bd-faint); margin-top: 2px; }
.ic-row { display: flex; justify-content: space-between; align-items: center; }
.ic-key { font-size: 10px; color: var(--tx-3); }
.ic-val { font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
.ic-thresh { font-size: 9px; color: var(--tx-4); font-weight: 400; }

.val-ok       { color: var(--col-ok); }
.val-warn     { color: var(--col-warn); }
.val-critical { color: var(--col-err); }

/* Memory bar */
.ic-bar-bg { height: 4px; background: var(--bd-sub); border-radius: 2px; overflow: hidden; margin-top: 4px; }
.ic-bar-fill { height: 100%; border-radius: 2px; transition: width .4s; }
.ic-bar-fill.status-healthy  { background: var(--col-ok); }
.ic-bar-fill.status-warning  { background: var(--col-warn); }
.ic-bar-fill.status-critical { background: var(--col-err); }
</style>
