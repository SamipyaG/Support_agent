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
  background: transparent; border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-2); padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
<<<<<<< HEAD
.redis-btn:hover, .redis-btn.active {
  border-color: var(--accent); color: var(--tx-1); background: var(--bg-card);
}
=======
.rp-btn:hover, .rp-btn.active { border-color: var(--accent); color: var(--tx-1); background: var(--bg-card); }
>>>>>>> ca6b98a (resolve conflict)

.redis-dot, .cluster-dot, .inst-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.dot-green { background: #3fb950; }
.dot-red   { background: #f85149; }

<<<<<<< HEAD
.redis-unhealthy {
=======
.rp-count {
>>>>>>> ca6b98a (resolve conflict)
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
  width: 320px; background: var(--bg-card); border: 1px solid var(--bd);
  border-radius: 8px; z-index: 1000; overflow: hidden;
  box-shadow: var(--shadow);
}

<<<<<<< HEAD
.panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; border-bottom: 1px solid var(--bd-sub);
}
.panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--tx-3); }
.panel-updated { font-size: 10px; color: var(--tx-4); font-family: monospace; }
.panel-loading { padding: 20px; text-align: center; color: var(--tx-3); font-size: 11px; }

.cluster-list { max-height: 400px; overflow-y: auto; }
=======
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
>>>>>>> ca6b98a (resolve conflict)

.cluster-header {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; background: transparent; border: none;
  border-bottom: 1px solid var(--bd-sub); cursor: pointer;
  transition: background .1s;
}
<<<<<<< HEAD
.cluster-header:hover { background: var(--bg-deep); }
.cluster-header.expanded { background: var(--bg-deep); }

.cluster-name { font-size: 12px; font-weight: 600; color: var(--tx-1); font-family: monospace; flex: 1; text-align: left; }
.cluster-stats { font-size: 10px; }

.instance-list { background: var(--bg-deep); border-bottom: 1px solid var(--bd-sub); }
.instance-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 20px;
}
.instance-row:not(:last-child) { border-bottom: 1px solid var(--bd-faint); }

.inst-name { font-size: 12px; font-weight: 600; width: 32px; }
.inst-meta { font-size: 10px; flex: 1; }
.mono { font-family: monospace; }
.dim { color: var(--tx-3); }
=======
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
>>>>>>> ca6b98a (resolve conflict)
</style>
