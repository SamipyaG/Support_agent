<template>
  <div class="osp-wrap" ref="wrapRef">
    <!-- Header button -->
    <button class="osp-btn" :class="{ active: open }" @click="toggle">
      <span class="osp-dot" :class="dotClass"></span>
      OpenSearch
      <span v-if="unhealthyCount > 0" class="osp-count">{{ unhealthyCount }}</span>
      <span class="chevron" :class="{ rotated: open }">▾</span>
    </button>

    <!-- Dropdown -->
    <div v-if="open" class="osp-dropdown">

      <!-- Head -->
      <div class="dp-head">
        <div class="dp-head-left">
          <span class="dp-title">OpenSearch &amp; Logstash</span>
          <span class="dp-updated" v-if="lastUpdated">{{ lastUpdated }}</span>
        </div>
        <div class="dp-head-right">
          <button class="tab-btn" :class="{ active: tab === 'opensearch' }" @click="tab = 'opensearch'">OpenSearch</button>
          <button class="tab-btn" :class="{ active: tab === 'logstash' }" @click="tab = 'logstash'">Logstash</button>
          <button class="dp-refresh" :disabled="loading" @click="fetchAll" title="Refresh">↻</button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="dp-state">
        <div class="dp-spinner"></div><span>Loading…</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="dp-state err">⚠ {{ error }}</div>

      <!-- ── OpenSearch ───────────────────────────────── -->
      <template v-else-if="tab === 'opensearch' && osData">
        <div class="dp-summary-row">
          <div class="dp-sum-item">
            <span class="dp-sum-val">{{ osNodes.length }}</span>
            <span class="dp-sum-lbl">Nodes</span>
          </div>
          <div class="dp-sum-item" :class="unhealthyCount > 0 ? 'warn' : 'ok'">
            <span class="dp-sum-val">{{ unhealthyCount }}</span>
            <span class="dp-sum-lbl">Unhealthy</span>
          </div>
          <div class="dp-sum-item ok">
            <span class="dp-sum-val">{{ osNodes.length - unhealthyCount }}</span>
            <span class="dp-sum-lbl">Healthy</span>
          </div>
        </div>
        <div class="dp-table-wrap">
          <table class="dp-table">
            <thead><tr>
              <th>Node Name</th>
              <th>Status</th>
              <th>Dashboard</th>
              <th>Avail Disk</th>
              <th>Disk Usage</th>
            </tr></thead>
            <tbody>
              <tr v-for="node in osNodes" :key="node.nodeName">
                <td class="mono-xs fw6">{{ node.nodeName }}</td>
                <td><span class="badge" :class="statusCls(node.status)">{{ node.status ?? '—' }}</span></td>
                <td><span class="badge" :class="statusCls(node.dashboardStatus)">{{ node.dashboardStatus ?? 'NA' }}</span></td>
                <td class="mono-xs" :class="diskCls(node.availableDisk)">{{ fmtPct(node.availableDisk) }}</td>
                <td class="mono-xs" :class="diskUsageCls(node.diskUsage)">{{ fmtPct(node.diskUsage) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ── Logstash ────────────────────────────────── -->
      <template v-else-if="tab === 'logstash' && lsData">
        <div class="ls-cards">
          <div class="ls-card">
            <div class="ls-card-lbl">Status</div>
            <div class="ls-card-val" :class="statusCls(lsData.status)">{{ lsData.status ?? '—' }}</div>
          </div>
          <div class="ls-card">
            <div class="ls-card-lbl">Memory</div>
            <div class="ls-card-val">{{ lsMemory }}</div>
          </div>
          <div class="ls-card">
            <div class="ls-card-lbl">CPU Usage</div>
            <div class="ls-card-val">{{ lsCpu }}</div>
          </div>
          <div class="ls-card" v-if="lsData.version">
            <div class="ls-card-lbl">Version</div>
            <div class="ls-card-val mono-xs">{{ lsData.version }}</div>
          </div>
        </div>
        <template v-if="lsPipelines.length">
          <div class="dp-sub-header">Pipelines ({{ lsPipelines.length }})</div>
          <div class="dp-table-wrap">
            <table class="dp-table">
              <thead><tr>
                <th>Name</th><th>Workers</th><th>Events In</th><th>Events Out</th><th>Duration</th>
              </tr></thead>
              <tbody>
                <tr v-for="p in lsPipelines" :key="p.name">
                  <td class="mono-xs fw6">{{ p.name }}</td>
                  <td class="dim-xs">{{ p.workers ?? '—' }}</td>
                  <td class="mono-xs">{{ fmtNum(p.events_in) }}</td>
                  <td class="mono-xs">{{ fmtNum(p.events_out) }}</td>
                  <td class="dim-xs">{{ p.duration_ms != null ? Number(p.duration_ms).toLocaleString() + ' ms' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const API_KEY = import.meta.env.VITE_HUB_MONITOR_API_KEY as string;
const OS_URL  = 'https://hub-monitor.g-mana.live/sendalarms/opensearch';
const LS_URL  = 'https://hub-monitor.g-mana.live/sendalarms/status/logstash';

const open        = ref(false);
const wrapRef     = ref<HTMLElement | null>(null);
const tab         = ref<'opensearch' | 'logstash'>('opensearch');
const osData      = ref<any>(null);
const lsData      = ref<any>(null);
const loading     = ref(false);
const error       = ref('');
const lastUpdated = ref('');

/* ── Derived ──────────────────────────────────────── */
const osNodes = computed((): any[] => {
  const d = osData.value;
  if (!d) return [];
  if (Array.isArray(d.nodes)) return d.nodes;
  if (Array.isArray(d))       return d;
  return [];
});

const unhealthyCount = computed(() =>
  osNodes.value.filter((n: any) => {
    const s = String(n.status ?? '').toLowerCase();
    return s !== 'ok' && s !== 'green' && s !== 'healthy';
  }).length
);

const dotClass = computed(() => {
  if (!osData.value) return 'dot-gray';
  return unhealthyCount.value > 0 ? 'dot-red' : 'dot-green';
});

const lsMemory = computed(() => {
  const jvm = lsData.value?.jvm?.mem as Record<string, any> | undefined;
  if (!jvm) return '—';
  const used = jvm.heap_used_in_bytes;
  const max  = jvm.heap_max_in_bytes;
  if (used == null || max == null) return '—';
  return `${fmtMB(used)} / ${fmtMB(max)}`;
});

const lsCpu = computed(() => {
  const pct = (lsData.value?.process?.cpu as any)?.percent;
  return pct != null ? `${Number(pct).toFixed(1)}%` : '—';
});

const lsPipelines = computed((): any[] => {
  const p = lsData.value?.pipelines as Record<string, any> | undefined;
  if (!p) return [];
  return Object.entries(p).map(([name, info]: [string, any]) => ({
    name,
    workers: info.workers,
    events_in:  info.events?.in,
    events_out: info.events?.out,
    duration_ms: info.events?.duration_in_millis,
  }));
});

/* ── Fetch ────────────────────────────────────────── */
async function fetchAll() {
  loading.value = true;
  error.value   = '';
  try {
    const [osRes, lsRes] = await Promise.all([
      fetch(OS_URL, { headers: { 'x-api-key': API_KEY } }),
      fetch(LS_URL, { headers: { 'x-api-key': API_KEY } }),
    ]);
    if (!osRes.ok) throw new Error(`OpenSearch HTTP ${osRes.status}`);
    if (!lsRes.ok) throw new Error(`Logstash HTTP ${lsRes.status}`);
    osData.value = await osRes.json();
    lsData.value = await lsRes.json();
    lastUpdated.value = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

function toggle() { open.value = !open.value; }

function onOutside(e: MouseEvent) {
  if (wrapRef.value && !wrapRef.value.contains(e.target as Node)) open.value = false;
}

let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  fetchAll();
  timer = setInterval(() => fetchAll(), 60_000);
  document.addEventListener('click', onOutside);
});
onUnmounted(() => {
  clearInterval(timer);
  document.removeEventListener('click', onOutside);
});

/* ── Formatters ───────────────────────────────────── */
function fmtPct(v: unknown): string {
  if (v == null) return '—';
  const n = parseFloat(String(v));
  return isNaN(n) ? String(v) : n.toFixed(2) + '%';
}

function fmtMB(bytes: number): string {
  return (bytes / 1048576).toFixed(0) + ' MB';
}

function fmtNum(v: unknown): string {
  if (v == null) return '—';
  return Number(v).toLocaleString();
}

function statusCls(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (['ok', 'green', 'healthy', 'running'].includes(s)) return 'badge-ok';
  if (['yellow', 'warning', 'degraded', 'na'].includes(s)) return 'badge-warn';
  if (['red', 'error', 'down', 'failed'].includes(s)) return 'badge-err';
  return 'badge-neutral';
}

function diskCls(v: unknown): string {
  const n = parseFloat(String(v ?? ''));
  if (isNaN(n)) return '';
  if (n < 30) return 'val-err';
  if (n < 50) return 'val-warn';
  return 'val-ok';
}

function diskUsageCls(v: unknown): string {
  const n = parseFloat(String(v ?? ''));
  if (isNaN(n)) return '';
  if (n > 80) return 'val-err';
  if (n > 60) return 'val-warn';
  return '';
}
</script>

<style scoped>
.osp-wrap { position: relative; }

/* ── Header button ───────────────────────────────── */
.osp-btn {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-2); padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.osp-btn:hover, .osp-btn.active { border-color: var(--accent); color: var(--tx-1); background: var(--bg-card); }

.osp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #3fb950; }
.dot-red   { background: #f85149; }
.dot-gray  { background: #4f5b6e; }

.osp-count {
  background: rgba(248,81,73,.2); color: var(--col-err);
  border-radius: 10px; padding: 0 5px; font-size: 10px; font-weight: 700;
}
.chevron { font-size: 10px; transition: transform .2s; display: inline-block; }
.chevron.rotated { transform: rotate(180deg); }

/* ── Dropdown ────────────────────────────────────── */
.osp-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 580px; max-height: 500px;
  background: var(--bg-card); border: 1px solid var(--bd);
  border-radius: 10px; z-index: 2000;
  box-shadow: 0 8px 32px rgba(0,0,0,.35);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ── Head ────────────────────────────────────────── */
.dp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px; border-bottom: 1px solid var(--bd);
  background: var(--bg-deep); flex-shrink: 0; gap: 8px;
}
.dp-head-left  { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dp-head-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.dp-title   { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--tx-2); }
.dp-updated { font-size: 10px; color: var(--tx-4); font-family: monospace; }

.tab-btn {
  background: none; border: 1px solid var(--bd); color: var(--tx-3);
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px;
  cursor: pointer; transition: all .12s;
}
.tab-btn:hover { background: var(--bg-hover); color: var(--tx-1); }
.tab-btn.active { background: var(--accent-bg); color: var(--accent); border-color: rgba(77,157,224,.4); }

.dp-refresh {
  background: none; border: none; color: var(--tx-3); font-size: 13px;
  cursor: pointer; padding: 0 4px; line-height: 1; transition: color .12s;
}
.dp-refresh:hover { color: var(--tx-1); }
.dp-refresh:disabled { opacity: .4; cursor: default; }

/* ── States ──────────────────────────────────────── */
.dp-state {
  padding: 20px; text-align: center; font-size: 12px; color: var(--tx-3);
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.dp-state.err { color: var(--col-err); }
.dp-spinner {
  width: 13px; height: 13px; border: 2px solid var(--bd); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Summary row ─────────────────────────────────── */
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

/* ── Logstash cards ──────────────────────────────── */
.ls-cards {
  display: grid; grid-template-columns: repeat(4, 1fr);
  border-bottom: 1px solid var(--bd); flex-shrink: 0;
}
.ls-card {
  padding: 12px 14px; border-right: 1px solid var(--bd-sub);
}
.ls-card:last-child { border-right: none; }
.ls-card-lbl { font-size: 9px; color: var(--tx-3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
.ls-card-val { font-size: 14px; font-weight: 700; font-family: monospace; }

/* ── Sub header ──────────────────────────────────── */
.dp-sub-header {
  padding: 7px 14px 4px; font-size: 10px; font-weight: 700;
  color: var(--tx-3); text-transform: uppercase; letter-spacing: .05em;
  border-top: 1px solid var(--bd); flex-shrink: 0;
}

/* ── Table ───────────────────────────────────────── */
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
.badge-ok      { background: var(--col-ok-bg);   color: var(--col-ok); }
.badge-warn    { background: var(--col-warn-bg); color: var(--col-warn); }
.badge-err     { background: var(--col-err-bg);  color: var(--col-err); }
.badge-neutral { background: var(--bd-sub);       color: var(--tx-3); }

.val-ok   { color: var(--col-ok); }
.val-warn { color: var(--col-warn); font-weight: 600; }
.val-err  { color: var(--col-err); font-weight: 700; }
</style>
