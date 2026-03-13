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
          <span class="dp-updated" v-if="lastUpdated">Last updated: {{ lastUpdated }}</span>
        </div>
        <button class="dp-refresh-btn" :disabled="loading" @click="fetchAll">
          <span :class="{ spinning: loading }">↻</span> Refresh
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="dp-state">
        <div class="dp-spinner"></div><span>Loading…</span>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="dp-state err">⚠ {{ error }}</div>

      <!-- Content -->
      <div v-else class="dp-content">

        <!-- ── OpenSearch Nodes ───────────────────── -->
        <div class="section-title">OpenSearch Nodes</div>
        <div v-if="osNodes.length === 0" class="dp-state">No data</div>
        <div v-else class="dp-table-wrap">
          <table class="dp-table">
            <thead><tr>
              <th>Node Name</th>
              <th>Status</th>
              <th>Dashboard Status</th>
              <th>Available Disk</th>
              <th>Disk Usage</th>
            </tr></thead>
            <tbody>
              <tr v-for="node in osNodes" :key="node.name">
                <td class="mono-xs fw6">{{ node.name }}</td>
                <td><span class="badge" :class="statusCls(node.status)">{{ node.status ?? '—' }}</span></td>
                <td><span class="badge" :class="dashboardCls(node.dashboardStatus)">{{ node.dashboardStatus ?? 'NA' }}</span></td>
                <td class="mono-xs">{{ fmtPct(node.availablePercentage) }}</td>
                <td>
                  <div class="disk-cell">
                    <div class="disk-bar-wrap">
                      <div class="disk-bar" :class="diskBarCls(node.diskUsage)" :style="{ width: Math.min(parseFloat(node.diskUsage) || 0, 100) + '%' }"></div>
                    </div>
                    <span class="mono-xs" :class="diskUsageCls(node.diskUsage)">{{ fmtPct(node.diskUsage) }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ── Logstash Status ───────────────────── -->
        <div class="section-title section-title-border">Logstash Status</div>
        <div v-if="!lsData" class="dp-state">No data</div>
        <div v-else class="ls-cards">
          <div class="ls-card">
            <div class="ls-card-lbl">Status</div>
            <div class="ls-card-val">
              <span class="ls-status-dot" :class="lsStatusDotCls"></span>
              <span :class="lsStatusTextCls">{{ lsData.status ?? '—' }}</span>
            </div>
          </div>
          <div class="ls-card">
            <div class="ls-card-lbl">Memory</div>
            <div class="ls-card-val">{{ lsMemory }}</div>
          </div>
          <div class="ls-card">
            <div class="ls-card-lbl">CPU Usage</div>
            <div class="ls-card-val">{{ lsCpu }}</div>
          </div>
        </div>

      </div>
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
  const mem = lsData.value?.jvm?.mem;
  if (!mem) return '—';
  const used = mem.heap_used_in_bytes;
  const max  = mem.heap_max_in_bytes;
  if (used == null || max == null) return '—';
  return `${Math.round(used / 1048576)} MB / ${Math.round(max / 1048576)} MB`;
});

const lsCpu = computed(() => {
  const d = lsData.value;
  if (!d) return '—';
  // try both field shapes
  const pct = d.process_cpu_percent ?? d.process?.cpu?.percent;
  return pct != null ? `${Number(pct).toFixed(1)}%` : '—';
});

const lsStatusDotCls = computed(() => {
  const s = String(lsData.value?.status ?? '').toLowerCase();
  if (s === 'green') return 'dot-green';
  if (s === 'yellow') return 'dot-yellow';
  return 'dot-red';
});

const lsStatusTextCls = computed(() => {
  const s = String(lsData.value?.status ?? '').toLowerCase();
  if (s === 'green') return 'val-ok';
  if (s === 'yellow') return 'val-warn';
  return 'val-err';
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
    lastUpdated.value = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  if (v == null || v === '') return '—';
  const n = parseFloat(String(v));
  return isNaN(n) ? String(v) : n.toFixed(2) + '%';
}

function statusCls(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (s === 'ok' || s === 'green' || s === 'healthy') return 'badge-ok';
  if (s === 'yellow' || s === 'warning') return 'badge-warn';
  return 'badge-err';
}

function dashboardCls(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (s === 'ok' || s === 'green') return 'badge-ok';
  if (s === 'na' || s === '') return 'badge-neutral';
  return 'badge-warn';
}

function diskUsageCls(v: unknown): string {
  const n = parseFloat(String(v ?? ''));
  if (isNaN(n)) return '';
  if (n > 80) return 'val-err';
  if (n > 60) return 'val-warn';
  return '';
}

function diskBarCls(v: unknown): string {
  const n = parseFloat(String(v ?? ''));
  if (isNaN(n)) return 'bar-green';
  if (n > 80) return 'bar-red';
  if (n > 60) return 'bar-yellow';
  return 'bar-green';
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
.dot-green  { background: #3fb950; }
.dot-yellow { background: #e3a23a; }
.dot-red    { background: #f85149; }
.dot-gray   { background: #4f5b6e; }

.osp-count {
  background: rgba(248,81,73,.2); color: var(--col-err);
  border-radius: 10px; padding: 0 5px; font-size: 10px; font-weight: 700;
}
.chevron { font-size: 10px; transition: transform .2s; display: inline-block; }
.chevron.rotated { transform: rotate(180deg); }

/* ── Dropdown ────────────────────────────────────── */
.osp-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 640px;
  background: var(--bg-card); border: 1px solid var(--bd);
  border-radius: 10px; z-index: 2000;
  box-shadow: 0 8px 32px rgba(0,0,0,.35);
  display: flex; flex-direction: column; overflow: hidden;
}

/* ── Head ────────────────────────────────────────── */
.dp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--bd);
  background: var(--bg-deep); flex-shrink: 0;
}
.dp-head-left  { display: flex; align-items: center; gap: 10px; }
.dp-title   { font-size: 12px; font-weight: 700; color: var(--tx-1); }
.dp-updated { font-size: 10px; color: var(--tx-3); font-family: monospace; }

.dp-refresh-btn {
  display: flex; align-items: center; gap: 4px;
  background: var(--col-ok); color: #fff;
  border: none; border-radius: 6px; padding: 4px 12px;
  font-size: 11px; font-weight: 600; cursor: pointer; transition: opacity .15s;
}
.dp-refresh-btn:hover { opacity: .85; }
.dp-refresh-btn:disabled { opacity: .5; cursor: default; }
.spinning { display: inline-block; animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

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

/* ── Content scroll area ─────────────────────────── */
.dp-content { overflow-y: auto; max-height: 520px; display: flex; flex-direction: column; }

/* ── Section titles ──────────────────────────────── */
.section-title {
  padding: 8px 16px 6px;
  font-size: 13px; font-weight: 700; color: var(--tx-1);
  background: var(--bg-card); flex-shrink: 0;
}
.section-title-border { border-top: 1px solid var(--bd); }

/* ── Table ───────────────────────────────────────── */
.dp-table-wrap { overflow-x: auto; flex-shrink: 0; }
.dp-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.dp-table thead th {
  background: var(--bg-deep); color: var(--tx-2); font-weight: 600; font-size: 10px;
  text-align: left; padding: 7px 12px; border-bottom: 1px solid var(--bd);
  white-space: nowrap;
}
.dp-table tbody tr:nth-child(even) td { background: var(--bg-deep); }
.dp-table tbody tr:hover td { background: var(--bg-hover) !important; }
.dp-table td { padding: 7px 12px; border-bottom: 1px solid var(--bd-faint); color: var(--tx-1); vertical-align: middle; }
.dp-table tr:last-child td { border-bottom: none; }

/* ── Disk bar ────────────────────────────────────── */
.disk-cell { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.disk-bar-wrap { flex: 1; height: 5px; background: var(--bd); border-radius: 3px; overflow: hidden; min-width: 60px; }
.disk-bar { height: 100%; border-radius: 3px; transition: width .3s; min-width: 2px; }
.bar-green  { background: #3fb950; }
.bar-yellow { background: #e3a23a; }
.bar-red    { background: #f85149; }

/* ── Logstash cards ──────────────────────────────── */
.ls-cards {
  display: grid; grid-template-columns: repeat(3, 1fr);
  padding: 4px 0 12px; gap: 0;
}
.ls-card {
  padding: 10px 16px; border-right: 1px solid var(--bd-sub);
}
.ls-card:last-child { border-right: none; }
.ls-card-lbl {
  font-size: 9px; font-weight: 700; color: var(--tx-3);
  text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px;
}
.ls-card-val {
  display: flex; align-items: center; gap: 6px;
  font-size: 16px; font-weight: 700; font-family: monospace; color: var(--tx-1);
}
.ls-status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

/* ── Badges ──────────────────────────────────────── */
.badge { display: inline-block; padding: 2px 7px; border-radius: 12px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.badge-ok      { background: var(--col-ok-bg);   color: var(--col-ok); }
.badge-warn    { background: var(--col-warn-bg); color: var(--col-warn); }
.badge-err     { background: var(--col-err-bg);  color: var(--col-err); }
.badge-neutral { background: var(--bd-sub);       color: var(--tx-3); }

.mono-xs { font-family: monospace; font-size: 10px; }
.fw6     { font-weight: 600; }
.val-ok   { color: var(--col-ok); }
.val-warn { color: var(--col-warn); }
.val-err  { color: var(--col-err); font-weight: 700; }
</style>
