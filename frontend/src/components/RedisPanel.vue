<template>
  <div class="rp-wrap" ref="wrapRef">
    <!-- Header button -->
    <button class="rp-btn" :class="{ active: open }" @click="toggle">
      <span class="rp-dot" :class="redisStore.totalUnhealthy > 0 ? 'dot-red' : 'dot-green'"></span>
      Redis
      <span v-if="redisStore.totalUnhealthy > 0" class="rp-count">{{ redisStore.totalUnhealthy }}</span>
      <span class="chevron" :class="{ rotated: open }">▾</span>
    </button>

    <!-- Dropdown -->
    <div v-if="open" class="rp-dropdown">
      <!-- Dropdown header -->
      <div class="dp-head">
        <div class="dp-head-left">
          <span class="dp-title">Redis Health</span>
          <span class="dp-updated" v-if="redisStore.lastFetched">{{ fmtTime(redisStore.lastFetched) }}</span>
        </div>
        <div class="dp-head-right">
          <span class="dp-summary ok">{{ totalHealthy }} healthy</span>
          <span v-if="redisStore.totalUnhealthy > 0" class="dp-summary err">{{ redisStore.totalUnhealthy }} unhealthy</span>
        </div>
      </div>

      <div v-if="redisStore.loading && redisStore.clusters.length === 0" class="dp-loading">
        <div class="dp-spinner"></div> Loading…
      </div>

      <div v-else class="dp-clusters">
        <div v-for="cluster in redisStore.clusters" :key="cluster.clusterName" class="dp-cluster">

          <!-- Cluster header -->
          <button class="cluster-hdr" :class="{ expanded: expanded === cluster.clusterName }" @click="toggleCluster(cluster.clusterName)">
            <span class="c-dot" :class="(cluster.unhealthyInstances || 0) > 0 ? 'dot-red' : 'dot-green'"></span>
            <span class="c-name">{{ cluster.clusterName }}</span>
            <span class="c-pill ok">{{ cluster.healthyInstances }}/{{ cluster.totalInstances }}</span>
            <span v-if="cluster.unhealthyInstances > 0" class="c-pill err">{{ cluster.unhealthyInstances }} !</span>
            <span class="c-chevron" :class="{ rotated: expanded === cluster.clusterName }">▾</span>
          </button>

          <!-- Instance list -->
          <div v-if="expanded === cluster.clusterName" class="inst-list">
            <div v-for="inst in cluster.instances" :key="inst.instanceName"
              class="inst-row"
              :class="{ 'inst-unhealthy': !redisStore.isInstanceHealthy(inst, cluster.thresholds) }"
            >
              <!-- Row top: name + role + health dot -->
              <div class="inst-top">
                <span class="inst-dot" :class="redisStore.isInstanceHealthy(inst, cluster.thresholds) ? 'dot-green' : 'dot-red'"></span>
                <span class="inst-name">{{ inst.instanceName }}</span>
                <span v-if="inst.role" class="inst-role">{{ inst.role }}</span>
                <span v-if="inst.restartCount > 0" class="inst-restarts" :class="{ 'restart-high': inst.restartCount >= cluster.thresholds.restartThreshold }">
                  ↺{{ inst.restartCount }}
                </span>
              </div>

              <!-- Metrics row -->
              <div class="inst-metrics">
                <!-- Memory bar -->
                <div class="metric">
                  <span class="metric-lbl">MEM</span>
                  <div class="metric-bar-wrap">
                    <div class="metric-bar" :class="memBarCls(inst, cluster.thresholds)" :style="{ width: memPct(inst) + '%' }"></div>
                  </div>
                  <span class="metric-val">{{ inst.usedMemory }}<template v-if="inst.maxMemoryBytes > 0">/{{ inst.maxMemory }}</template></span>
                </div>

                <!-- CPU bar -->
                <div class="metric">
                  <span class="metric-lbl">CPU</span>
                  <div class="metric-bar-wrap">
                    <div class="metric-bar" :class="cpuBarCls(inst, cluster.thresholds)" :style="{ width: Math.min(inst.cpuUsagePercent, 100) + '%' }"></div>
                  </div>
                  <span class="metric-val">{{ inst.cpuUsagePercent.toFixed(1) }}%</span>
                </div>

                <!-- Connections -->
                <div class="metric-inline">
                  <span class="metric-lbl">CONN</span>
                  <span class="metric-val" :class="{ 'val-warn': inst.connectedClients >= cluster.thresholds.connectionsThreshold }">
                    {{ inst.connectedClients }}
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRedisStore } from '@/store/redis';
import type { RedisInstance, ClusterThresholds } from '@/store/redis';

const redisStore = useRedisStore();
const open       = ref(false);
const expanded   = ref<string | null>(null);
const wrapRef    = ref<HTMLElement | null>(null);

const totalHealthy = computed(() =>
  redisStore.clusters.reduce((s, c) => s + c.healthyInstances, 0)
);

function toggle() { open.value = !open.value; }
function toggleCluster(name: string) { expanded.value = expanded.value === name ? null : name; }
function fmtTime(d: Date) { return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function memPct(inst: RedisInstance): number {
  if (!inst.maxMemoryBytes || inst.maxMemoryBytes === 0) return 0;
  return Math.min((inst.usedMemoryBytes / inst.maxMemoryBytes) * 100, 100);
}

function memBarCls(inst: RedisInstance, t: ClusterThresholds): string {
  const threshBytes = t.memoryThresholdGB * 1024 * 1024 * 1024;
  if (inst.usedMemoryBytes >= threshBytes) return 'bar-red';
  if (memPct(inst) >= 70) return 'bar-yellow';
  return 'bar-green';
}

function cpuBarCls(inst: RedisInstance, t: ClusterThresholds): string {
  if (inst.cpuUsagePercent >= t.cpuThresholdPercent) return 'bar-red';
  if (inst.cpuUsagePercent >= t.cpuThresholdPercent * 0.7) return 'bar-yellow';
  return 'bar-green';
}

function onOutside(e: MouseEvent) {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node)) open.value = false;
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  redisStore.fetchRedis();
  timer = setInterval(() => redisStore.fetchRedis(), 30_000);
  document.addEventListener('click', onOutside);
});
onUnmounted(() => { clearInterval(timer); document.removeEventListener('click', onOutside); });
</script>

<style scoped>
.rp-wrap { position: relative; }

/* ── Header button ───────────────────────────────────── */
.rp-btn {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-2); padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.rp-btn:hover, .rp-btn.active { border-color: var(--accent); color: var(--tx-1); background: var(--bg-card); }

.rp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #3fb950; }
.dot-red   { background: #f85149; }

.rp-count {
  background: rgba(248,81,73,.2); color: var(--col-err);
  border-radius: 10px; padding: 0 5px; font-size: 10px; font-weight: 700;
}

.chevron { font-size: 10px; transition: transform .2s; display: inline-block; }
.chevron.rotated { transform: rotate(180deg); }

/* ── Dropdown ────────────────────────────────────────── */
.rp-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 340px;
  background: var(--bg-card); border: 1px solid var(--bd);
  border-radius: 10px; z-index: 1000;
  box-shadow: 0 8px 32px rgba(0,0,0,.35);
  overflow: hidden;
}

/* ── Dropdown head ───────────────────────────────────── */
.dp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--bd);
  background: var(--bg-deep);
}
.dp-head-left  { display: flex; align-items: center; gap: 8px; }
.dp-head-right { display: flex; align-items: center; gap: 6px; }
.dp-title   { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--tx-2); }
.dp-updated { font-size: 10px; color: var(--tx-4); font-family: monospace; }
.dp-summary { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 10px; }
.dp-summary.ok  { background: rgba(63,185,80,.12);  color: #3fb950; }
.dp-summary.err { background: rgba(248,81,73,.12); color: #f85149; }

.dp-loading { display: flex; align-items: center; gap: 8px; padding: 20px; color: var(--tx-3); font-size: 11px; }
.dp-spinner {
  width: 12px; height: 12px; border: 2px solid var(--bd); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Cluster list ────────────────────────────────────── */
.dp-clusters { max-height: 420px; overflow-y: auto; }

.dp-cluster { border-bottom: 1px solid var(--bd-sub); }
.dp-cluster:last-child { border-bottom: none; }

.cluster-hdr {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; background: transparent; border: none; cursor: pointer;
  transition: background .1s; text-align: left;
}
.cluster-hdr:hover, .cluster-hdr.expanded { background: var(--bg-hover); }

.c-dot   { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.c-name  { font-size: 12px; font-weight: 600; color: var(--tx-1); font-family: monospace; flex: 1; }
.c-pill  { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 8px; }
.c-pill.ok  { background: rgba(63,185,80,.12);  color: #3fb950; }
.c-pill.err { background: rgba(248,81,73,.12);  color: #f85149; }
.c-chevron  { font-size: 10px; transition: transform .2s; color: var(--tx-3); }
.c-chevron.rotated { transform: rotate(180deg); }

/* ── Instance list ───────────────────────────────────── */
.inst-list { background: var(--bg-base); }

.inst-row {
  padding: 8px 14px 8px 24px;
  border-bottom: 1px solid var(--bd-faint);
  transition: background .1s;
}
.inst-row:last-child { border-bottom: none; }
.inst-row:hover { background: var(--bg-hover); }
.inst-row.inst-unhealthy { border-left: 2px solid #f85149; padding-left: 22px; }

.inst-top {
  display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
}
.inst-dot   { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.inst-name  { font-size: 11px; font-weight: 600; font-family: monospace; color: var(--tx-1); flex: 1; }
.inst-role  { font-size: 9px; font-weight: 700; color: var(--accent); background: var(--accent-bg); padding: 1px 5px; border-radius: 3px; text-transform: uppercase; }
.inst-restarts { font-size: 9px; font-family: monospace; color: var(--tx-3); }
.restart-high { color: var(--col-err) !important; font-weight: 700; }

/* ── Metrics ─────────────────────────────────────────── */
.inst-metrics { display: flex; flex-direction: column; gap: 4px; }

.metric {
  display: flex; align-items: center; gap: 6px;
}
.metric-lbl {
  font-size: 9px; font-weight: 700; color: var(--tx-4); text-transform: uppercase;
  width: 28px; flex-shrink: 0;
}
.metric-bar-wrap {
  flex: 1; height: 4px; background: var(--bd); border-radius: 2px; overflow: hidden;
}
.metric-bar { height: 100%; border-radius: 2px; transition: width .3s; min-width: 2px; }
.bar-green  { background: #3fb950; }
.bar-yellow { background: #e3a23a; }
.bar-red    { background: #f85149; }
.metric-val { font-size: 9px; font-family: monospace; color: var(--tx-2); min-width: 60px; text-align: right; flex-shrink: 0; }

.metric-inline { display: flex; align-items: center; gap: 6px; }
.val-warn { color: var(--col-warn); font-weight: 700; }
</style>
