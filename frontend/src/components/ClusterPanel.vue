<template>
  <div class="cp-wrap" ref="wrapRef">
    <!-- Header button -->
    <button class="cp-btn" :class="{ active: open }" @click="toggle">
      <span class="cp-dot" :class="dotClass"></span>
      {{ label }}
      <span v-if="alertCount > 0" class="cp-count">{{ alertCount }}</span>
      <span class="chevron" :class="{ rotated: open }">▾</span>
    </button>

    <!-- Dropdown -->
    <div v-if="open" class="cp-dropdown">

      <!-- Dropdown header -->
      <div class="dp-head">
        <div class="dp-head-left">
          <span class="dp-title">{{ label }}</span>
          <span class="dp-updated" v-if="lastUpdated">{{ lastUpdated }}</span>
        </div>
        <div class="dp-head-right">
          <button v-for="c in CLUSTERS" :key="c"
            class="hub-btn" :class="{ active: activeCluster === c }"
            @click="selectCluster(c)">{{ c }}</button>
          <button class="dp-refresh" :disabled="loading" @click="fetchData" title="Refresh">↻</button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="dp-state">
        <div class="dp-spinner"></div><span>Loading…</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="dp-state err">⚠ {{ error }}</div>

      <!-- ── Pending Pods ───────────────────────────── -->
      <template v-else-if="type === 'pending-pods' && data">
        <div class="dp-summary-row">
          <div class="dp-sum-item">
            <span class="dp-sum-val">{{ data.numberPod ?? 0 }}</span>
            <span class="dp-sum-lbl">Total</span>
          </div>
          <div class="dp-sum-item warn">
            <span class="dp-sum-val">{{ podRows.length }}</span>
            <span class="dp-sum-lbl">Unhealthy</span>
          </div>
          <div class="dp-sum-item ok">
            <span class="dp-sum-val">{{ Math.max(0, (data.numberPod ?? 0) - podRows.length) }}</span>
            <span class="dp-sum-lbl">Healthy</span>
          </div>
        </div>

        <div v-if="podRows.length === 0" class="dp-state ok">✓ No pending pods</div>
        <div v-else class="dp-table-wrap">
          <table class="dp-table">
            <thead><tr>
              <th>Pod</th><th>Namespace</th><th>Phase</th><th>Customer</th><th>Restarts</th><th>Condition</th>
            </tr></thead>
            <tbody>
              <tr v-for="pod in podRows" :key="pod.name">
                <td class="mono-xs">{{ shortName(pod.name) }}</td>
                <td class="dim-xs">{{ pod.namespace ?? '—' }}</td>
                <td><span class="badge" :class="phaseCls(pod.phase)">{{ pod.phase }}</span></td>
                <td class="dim-xs">{{ pod.customerName ?? '—' }}</td>
                <td :class="{ 'val-err': (pod.restartCount ?? 0) > 10, 'val-warn': (pod.restartCount ?? 0) > 0 && (pod.restartCount ?? 0) <= 10 }">
                  {{ pod.restartCount ?? 0 }}
                </td>
                <td>
                  <span class="badge badge-sm" :class="condCls(pod.condition?.status)">{{ pod.condition?.status ?? '—' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ── Components ─────────────────────────────── -->
      <template v-else-if="type === 'components' && data">
        <div class="dp-summary-row">
          <div class="dp-sum-item">
            <span class="dp-sum-val">{{ data.deployments?.length ?? 0 }}</span>
            <span class="dp-sum-lbl">Deployments</span>
          </div>
          <div class="dp-sum-item" :class="degraded > 0 ? 'warn' : 'ok'">
            <span class="dp-sum-val">{{ degraded }}</span>
            <span class="dp-sum-lbl">Degraded</span>
          </div>
          <div class="dp-sum-item">
            <span class="dp-sum-val">{{ data.cronJobs?.length ?? 0 }}</span>
            <span class="dp-sum-lbl">CronJobs</span>
          </div>
        </div>

        <!-- Sub-tabs -->
        <div class="dp-sub-tabs">
          <button :class="{ active: compTab === 'deployments' }" @click="compTab = 'deployments'">
            Deployments
          </button>
          <button :class="{ active: compTab === 'cronjobs' }" @click="compTab = 'cronjobs'">
            CronJobs
          </button>
        </div>

        <!-- Deployments -->
        <div v-if="compTab === 'deployments'" class="dp-table-wrap">
          <table class="dp-table">
            <thead><tr>
              <th>Component</th><th>Version</th><th>Mem</th><th>CPU</th><th>Status</th><th>Replicas</th>
            </tr></thead>
            <tbody>
              <tr v-for="dep in data.deployments ?? []" :key="dep.name">
                <td class="mono-xs fw6">{{ dep.name }}</td>
                <td class="dim-xs">{{ dep.db_ver ?? dep.tag ?? '—' }}</td>
                <td>
                  <div class="mini-bar-wrap">
                    <div class="mini-bar bar-blue" :style="{ width: Math.min((dep.memory ?? 0) / 20, 100) + '%' }"></div>
                    <span class="dim-xs">{{ dep.memory ?? '—' }}m</span>
                  </div>
                </td>
                <td class="dim-xs">{{ dep.cpu ?? '—' }}m</td>
                <td><span class="badge" :class="compCls(dep.status)">{{ dep.status ?? '—' }}</span></td>
                <td :class="{ 'val-warn': (dep.readyReplicas ?? 0) < (dep.replicas ?? 0) }">
                  {{ dep.readyReplicas ?? '—' }}/{{ dep.replicas ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- CronJobs -->
        <div v-else class="dp-table-wrap">
          <table class="dp-table">
            <thead><tr>
              <th>Job</th><th>Schedule</th><th>Last Success</th><th>Active</th><th>Status</th>
            </tr></thead>
            <tbody>
              <tr v-for="cj in data.cronJobs ?? []" :key="cj.name">
                <td class="mono-xs fw6">{{ cj.name }}</td>
                <td class="mono-xs">{{ cj.schedule }}</td>
                <td class="dim-xs">{{ fmtDate(cj.lastSuccessfulTime) }}</td>
                <td :class="{ 'val-warn': (cj.activeJobs ?? 0) > 0 }">{{ cj.activeJobs ?? 0 }}</td>
                <td><span class="badge" :class="cj.suspend ? 'badge-warn' : 'badge-ok'">{{ cj.suspend ? 'Suspended' : 'Active' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ── Coherency ──────────────────────────────── -->
      <template v-else-if="type === 'coherency' && data">
        <div class="dp-summary-row">
          <div class="dp-sum-item" :class="totalProblematic > 0 ? 'warn' : 'ok'">
            <span class="dp-sum-val">{{ totalProblematic }}</span>
            <span class="dp-sum-lbl">Problematic</span>
          </div>
          <div class="dp-sum-item" :class="unequalReplicas > 0 ? 'warn' : 'ok'">
            <span class="dp-sum-val">{{ unequalReplicas }}</span>
            <span class="dp-sum-lbl">Unequal Replicas</span>
          </div>
          <div class="dp-sum-item" :class="inconsistentCfg > 0 ? 'warn' : 'ok'">
            <span class="dp-sum-val">{{ inconsistentCfg }}</span>
            <span class="dp-sum-lbl">Inconsistent Cfg</span>
          </div>
        </div>

        <!-- Live vs VOD breakdown -->
        <div class="dp-breakdown">
          <div class="breakdown-row">
            <span class="br-label">K8s Problematic</span>
            <span class="br-live">LIVE {{ data.totalProblematicChannelsInK8s?.live ?? 0 }}</span>
            <span class="br-vod">VOD {{ data.totalProblematicChannelsInK8s?.vod ?? 0 }}</span>
          </div>
          <div class="breakdown-row">
            <span class="br-label">Unequal Replicas</span>
            <span class="br-live">LIVE {{ data.numberOfUnequalReplicas?.live ?? 0 }}</span>
            <span class="br-vod">VOD {{ data.numberOfUnequalReplicas?.vod ?? 0 }}</span>
          </div>
          <div class="breakdown-row">
            <span class="br-label">Inconsistent Config</span>
            <span class="br-live">LIVE {{ data.numberOfInconsistentCfg_verInMongoAndUiAndRedis?.live ?? 0 }}</span>
            <span class="br-vod">VOD {{ data.numberOfInconsistentCfg_verInMongoAndUiAndRedis?.vod ?? 0 }}</span>
          </div>
          <div class="breakdown-row">
            <span class="br-label">Total Problematic</span>
            <span class="br-live">LIVE {{ data.totalOfProblematic_channels?.live ?? 0 }}</span>
            <span class="br-vod">VOD {{ data.totalOfProblematic_channels?.vod ?? 0 }}</span>
          </div>
        </div>

        <div v-if="channelRows.length > 0">
          <div class="dp-sub-header">Problematic Channels ({{ channelRows.length }})</div>
          <div class="dp-table-wrap">
            <table class="dp-table">
              <thead><tr>
                <th>Channel</th><th>Customer</th><th>Type</th><th>UI</th><th>Mongo</th><th>Redis</th><th>Components</th>
              </tr></thead>
              <tbody>
                <tr v-for="ch in channelRows" :key="ch.uuid">
                  <td class="mono-xs">{{ ch.name ?? ch.uuid?.slice(0, 8) + '…' }}</td>
                  <td class="dim-xs">{{ ch.customer ?? '—' }}</td>
                  <td><span class="type-tag">{{ ch.streamType?.toUpperCase() }}</span></td>
                  <td class="mono-xs">{{ ch.configuration_version?.ui ?? '—' }}</td>
                  <td class="mono-xs">{{ ch.configuration_version?.mongo ?? '—' }}</td>
                  <td class="mono-xs" :class="{ 'val-warn': String(ch.configuration_version?.redis ?? '').includes('missing') }">
                    {{ ch.configuration_version?.redis ?? '—' }}
                  </td>
                  <td>
                    <div class="comp-row">
                      <span v-for="(ok, name) in ch.components" :key="name"
                        class="comp-icon" :class="ok ? 'comp-ok' : 'comp-miss'" :title="String(name)">
                        {{ ok ? '✓' : '✗' }}
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="dp-state ok">✓ No problematic channels</div>
      </template>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  label: string;
  type: 'pending-pods' | 'components' | 'coherency';
}>();

const API_KEY  = import.meta.env.VITE_HUB_MONITOR_API_KEY as string;
const CLUSTERS = ['hub1x', 'hub21'] as const;

const URLS: Record<string, Record<string, string>> = {
  'pending-pods': {
    hub1x: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub1x/pending-pods',
    hub21: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub21/pending-pods',
  },
  components: {
    hub1x: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub1x/components',
    hub21: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub21/components',
  },
  coherency: {
    hub1x: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub1x/configuration-coherency',
    hub21: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub21/configuration-coherency',
  },
};

const open          = ref(false);
const wrapRef       = ref<HTMLElement | null>(null);
const activeCluster = ref('hub1x');
const data          = ref<any>(null);
const loading       = ref(false);
const error         = ref('');
const lastUpdated   = ref('');
const compTab       = ref<'deployments' | 'cronjobs'>('deployments');

/* ── Derived counts for header button ───────────────── */
const alertCount = computed(() => {
  if (!data.value) return 0;
  if (props.type === 'pending-pods') return data.value.unhealthyPods?.length ?? 0;
  if (props.type === 'components')   return degraded.value;
  if (props.type === 'coherency')    return totalProblematic.value;
  return 0;
});

const dotClass = computed(() => {
  if (!data.value) return 'dot-gray';
  return alertCount.value > 0 ? 'dot-red' : 'dot-green';
});

/* ── Pending pods ───────────────────────────────────── */
const podRows = computed((): any[] => {
  const d = data.value;
  if (!d) return [];
  if (Array.isArray(d.unhealthyPods)) return d.unhealthyPods;
  if (Array.isArray(d.pods))          return d.pods;
  if (Array.isArray(d))               return d;
  return [];
});

/* ── Components ─────────────────────────────────────── */
const degraded = computed(() =>
  (data.value?.deployments ?? []).filter((d: any) => d.status !== 'ok').length
);

/* ── Coherency ──────────────────────────────────────── */
const totalProblematic = computed(() => {
  const d = data.value;
  if (!d) return 0;
  return (d.totalOfProblematic_channels?.live ?? 0) + (d.totalOfProblematic_channels?.vod ?? 0);
});
const unequalReplicas = computed(() => {
  const d = data.value;
  if (!d) return 0;
  return (d.numberOfUnequalReplicas?.live ?? 0) + (d.numberOfUnequalReplicas?.vod ?? 0);
});
const inconsistentCfg = computed(() => {
  const d = data.value;
  if (!d) return 0;
  return (d.numberOfInconsistentCfg_verInMongoAndUiAndRedis?.live ?? 0) +
         (d.numberOfInconsistentCfg_verInMongoAndUiAndRedis?.vod ?? 0);
});

const channelRows = computed((): any[] => {
  const d = data.value;
  if (!d?.problematic_channels) return [];
  const result: any[] = [];
  for (const [streamType, channels] of Object.entries(d.problematic_channels as Record<string, any>)) {
    for (const [uuid, ch] of Object.entries(channels as Record<string, any>)) {
      result.push({ uuid, streamType, ...(ch as object) });
    }
  }
  return result;
});

/* ── Fetch ──────────────────────────────────────────── */
async function fetchData() {
  const url = URLS[props.type]?.[activeCluster.value];
  if (!url) return;
  loading.value = true;
  error.value   = '';
  try {
    const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data.value    = await res.json();
    lastUpdated.value = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

function selectCluster(c: string) { activeCluster.value = c; fetchData(); }
function toggle() { open.value = !open.value; }

function onOutside(e: MouseEvent) {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node)) open.value = false;
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  fetchData();
  timer = setInterval(() => fetchData(), 60_000);
  document.addEventListener('click', onOutside);
});
onUnmounted(() => {
  clearInterval(timer);
  document.removeEventListener('click', onOutside);
});

/* ── Formatters ─────────────────────────────────────── */
function fmtDate(v: string | undefined): string {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return v; }
}

function shortName(name: string | undefined): string {
  if (!name) return '—';
  return name.length > 22 ? name.slice(0, 20) + '…' : name;
}

function phaseCls(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (s === 'running') return 'badge-ok';
  if (s === 'pending') return 'badge-warn';
  return 'badge-err';
}

function condCls(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (s === 'true')  return 'badge-ok';
  if (s === 'false') return 'badge-err';
  return 'badge-neutral';
}

function compCls(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (s === 'ok')      return 'badge-ok';
  if (s === 'degraded') return 'badge-warn';
  return 'badge-err';
}
</script>

<style scoped>
.cp-wrap { position: relative; }

/* ── Header button ───────────────────────────────────── */
.cp-btn {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-2); padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.cp-btn:hover, .cp-btn.active { border-color: var(--accent); color: var(--tx-1); background: var(--bg-card); }

.cp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #3fb950; }
.dot-red   { background: #f85149; }
.dot-gray  { background: #4f5b6e; }

.cp-count {
  background: rgba(248,81,73,.2); color: var(--col-err);
  border-radius: 10px; padding: 0 5px; font-size: 10px; font-weight: 700;
}
.chevron { font-size: 10px; transition: transform .2s; display: inline-block; }
.chevron.rotated { transform: rotate(180deg); }

/* ── Dropdown ────────────────────────────────────────── */
.cp-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 580px; max-height: 500px;
  background: var(--bg-card); border: 1px solid var(--bd);
  border-radius: 10px; z-index: 2000;
  box-shadow: 0 8px 32px rgba(0,0,0,.35);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ── Dropdown head ───────────────────────────────────── */
.dp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px; border-bottom: 1px solid var(--bd);
  background: var(--bg-deep); flex-shrink: 0; gap: 8px;
}
.dp-head-left  { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dp-head-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.dp-title   { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--tx-2); }
.dp-updated { font-size: 10px; color: var(--tx-4); font-family: monospace; }

.hub-btn {
  background: none; border: 1px solid var(--bd); color: var(--tx-3);
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px;
  cursor: pointer; font-family: monospace; transition: all .12s;
}
.hub-btn:hover { background: var(--bg-hover); color: var(--tx-1); }
.hub-btn.active { background: var(--accent-bg); color: var(--accent); border-color: rgba(77,157,224,.4); }

.dp-refresh {
  background: none; border: none; color: var(--tx-3); font-size: 13px;
  cursor: pointer; padding: 0 4px; line-height: 1; transition: color .12s;
}
.dp-refresh:hover { color: var(--tx-1); }
.dp-refresh:disabled { opacity: .4; cursor: default; }

/* ── States ─────────────────────────────────────────── */
.dp-state {
  padding: 20px; text-align: center; font-size: 12px; color: var(--tx-3);
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.dp-state.ok  { color: var(--col-ok); }
.dp-state.err { color: var(--col-err); }
.dp-spinner {
  width: 13px; height: 13px; border: 2px solid var(--bd); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Summary row ─────────────────────────────────────── */
.dp-summary-row {
  display: flex; gap: 0; border-bottom: 1px solid var(--bd); flex-shrink: 0;
}
.dp-sum-item {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 10px 8px; border-right: 1px solid var(--bd-sub); gap: 2px;
}
.dp-sum-item:last-child { border-right: none; }
.dp-sum-item.ok   { background: rgba(63,185,80,.05); }
.dp-sum-item.warn { background: rgba(227,162,58,.05); }
.dp-sum-val { font-size: 18px; font-weight: 700; font-family: monospace; }
.dp-sum-item.ok   .dp-sum-val { color: var(--col-ok); }
.dp-sum-item.warn .dp-sum-val { color: var(--col-warn); }
.dp-sum-lbl { font-size: 9px; color: var(--tx-3); text-transform: uppercase; letter-spacing: .05em; }

/* ── Sub-tabs ────────────────────────────────────────── */
.dp-sub-tabs {
  display: flex; border-bottom: 1px solid var(--bd); flex-shrink: 0; background: var(--bg-deep);
}
.dp-sub-tabs button {
  flex: 1; background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--tx-3); font-size: 11px; font-weight: 600;
  padding: 8px 12px; cursor: pointer; transition: all .12s;
}
.dp-sub-tabs button:hover { color: var(--tx-1); }
.dp-sub-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); background: var(--bg-card); }

/* ── Coherency breakdown ─────────────────────────────── */
.dp-breakdown { padding: 8px 14px; border-bottom: 1px solid var(--bd); flex-shrink: 0; display: flex; flex-direction: column; gap: 5px; }
.breakdown-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.br-label { flex: 1; color: var(--tx-3); font-size: 10px; }
.br-live  { font-weight: 700; font-size: 10px; color: var(--col-warn); min-width: 52px; }
.br-vod   { font-weight: 700; font-size: 10px; color: var(--accent);   min-width: 52px; }

.dp-sub-header {
  padding: 7px 14px 4px; font-size: 10px; font-weight: 700;
  color: var(--tx-3); text-transform: uppercase; letter-spacing: .05em;
  border-top: 1px solid var(--bd); flex-shrink: 0;
}

/* ── Table ───────────────────────────────────────────── */
.dp-table-wrap { overflow: auto; flex: 1; }
.dp-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.dp-table thead th {
  background: var(--bg-deep); color: var(--tx-2); font-weight: 600; font-size: 10px;
  text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--bd);
  white-space: nowrap; position: sticky; top: 0; z-index: 1;
}
.dp-table tbody tr:nth-child(even) td { background: var(--bg-deep); }
.dp-table tbody tr:hover td { background: var(--bg-hover) !important; }
.dp-table td { padding: 6px 10px; border-bottom: 1px solid var(--bd-faint); color: var(--tx-1); vertical-align: middle; }
.dp-table tr:last-child td { border-bottom: none; }

.mono-xs { font-family: monospace; font-size: 10px; }
.dim-xs  { font-size: 10px; color: var(--tx-3); }
.fw6     { font-weight: 600; }

.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.badge-sm { padding: 1px 4px; font-size: 8px; }
.badge-ok      { background: var(--col-ok-bg);   color: var(--col-ok); }
.badge-warn    { background: var(--col-warn-bg); color: var(--col-warn); }
.badge-err     { background: var(--col-err-bg);  color: var(--col-err); }
.badge-neutral { background: var(--bd-sub);       color: var(--tx-3); }

.val-ok   { color: var(--col-ok); }
.val-warn { color: var(--col-warn); font-weight: 600; }
.val-err  { color: var(--col-err); font-weight: 700; }

.type-tag { font-size: 9px; font-weight: 700; color: var(--accent); background: var(--accent-bg); padding: 1px 5px; border-radius: 3px; }

.mini-bar-wrap { display: flex; align-items: center; gap: 5px; min-width: 80px; }
.mini-bar { height: 4px; border-radius: 2px; min-width: 2px; }
.bar-blue { background: var(--accent); }

.comp-row { display: flex; gap: 2px; }
.comp-icon { font-size: 10px; font-weight: 700; padding: 0 2px; }
.comp-ok   { color: var(--col-ok); }
.comp-miss { color: var(--col-err); }
</style>
