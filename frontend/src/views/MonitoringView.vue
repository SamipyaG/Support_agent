<template>
  <div class="mon-layout">
    <main class="mon-main">

      <!-- Header -->
      <div class="mon-header">
        <div class="mon-title-row">
          <h2 class="mon-title">🔍 OpenSearch</h2>
          <span v-if="lastUpdated" class="mon-updated">Updated {{ lastUpdated }}</span>
        </div>
        <button class="btn-refresh" :class="{ spinning: loading }" @click="fetchOS" :disabled="loading">
          ↻ Refresh
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="mon-state">
        <div class="spinner"></div><span>Fetching data…</span>
      </div>

      <!-- Error -->
      <div v-else-if="osError" class="mon-state error">
        <span>⚠ {{ osError }}</span>
        <button class="btn-retry" @click="fetchOS">Retry</button>
      </div>

      <!-- OpenSearch nodes table -->
      <template v-else-if="osData">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Node Name</th>
                <th>Status</th>
                <th>Dashboard</th>
                <th>Available %</th>
                <th>Disk Usage</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="node in osNodes" :key="node.name">
                <td class="mono">{{ node.name }}</td>
                <td><span class="badge" :class="statusBadge(node.status)">{{ node.status }}</span></td>
                <td><span class="badge" :class="node.dashboardStatus === 'NA' ? 'badge-neutral' : statusBadge(node.dashboardStatus)">{{ node.dashboardStatus }}</span></td>
                <td>
                  <div class="bar-wrap">
                    <div class="bar" :class="availCls(node.availablePercentage)" :style="{ width: clamp(node.availablePercentage) + '%' }"></div>
                    <span class="bar-val">{{ pct(node.availablePercentage) }}</span>
                  </div>
                </td>
                <td>
                  <div class="bar-wrap">
                    <div class="bar" :class="diskCls(node.diskUsage)" :style="{ width: clamp(node.diskUsage) + '%' }"></div>
                    <span class="bar-val">{{ pct(node.diskUsage) }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Logstash section -->
        <div class="section-sep">
          <span class="section-label">📊 Logstash</span>
        </div>

        <div v-if="logstashLoading" class="mon-state">
          <div class="spinner"></div><span>Loading Logstash…</span>
        </div>
        <div v-else-if="logstashData" class="cards-grid">
          <div class="stat-card" v-for="(val, key) in logstashStats" :key="key">
            <div class="stat-lbl">{{ fmtKey(String(key)) }}</div>
            <div class="stat-val" :class="lsCls(String(key), val)">{{ fmtVal(String(key), val) }}</div>
          </div>
        </div>
      </template>

    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const API_KEY = import.meta.env.VITE_HUB_MONITOR_API_KEY as string;

const osData          = ref<any>(null);
const loading         = ref(false);
const osError         = ref('');
const lastUpdated     = ref('');
const logstashData    = ref<any>(null);
const logstashLoading = ref(false);

async function fetchOS() {
  loading.value = true;
  osError.value = '';
  osData.value  = null;
  try {
    const res = await fetch('https://hub-monitor.g-mana.live/sendalarms/opensearch', {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    osData.value      = await res.json();
    lastUpdated.value = new Date().toLocaleTimeString();
  } catch (e) {
    osError.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
  fetchLogstash();
}

async function fetchLogstash() {
  logstashLoading.value = true;
  logstashData.value    = null;
  try {
    const res = await fetch('https://hub-monitor.g-mana.live/sendalarms/status/logstash', {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logstashData.value = await res.json();
  } catch { /* silent */ } finally {
    logstashLoading.value = false;
  }
}

onMounted(() => fetchOS());

const osNodes = computed((): any[] => {
  const d = osData.value;
  if (!d) return [];
  if (Array.isArray(d.data)) return d.data;
  if (Array.isArray(d))      return d;
  return [];
});

const logstashStats = computed((): Record<string, unknown> => {
  const d = logstashData.value as any;
  if (!d) return {};
  const out: Record<string, unknown> = {};
  if (d.status != null) out.status = d.status;
  if (d.jvm?.mem?.heap_used_in_bytes != null) out.heap_used = d.jvm.mem.heap_used_in_bytes;
  if (d.jvm?.mem?.heap_max_in_bytes  != null) out.heap_max  = d.jvm.mem.heap_max_in_bytes;
  if (d.process?.cpu?.percent != null) out.cpu_percent = d.process.cpu.percent;
  if (d.host)    out.host    = d.host;
  if (d.version) out.version = d.version;
  return out;
});

function fmtKey(k: string) {
  return k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()).trim();
}
function fmtVal(key: string, val: unknown): string {
  if (val == null) return '—';
  const lk = key.toLowerCase();
  if (lk.includes('heap') || lk.includes('bytes')) {
    const n = parseFloat(String(val));
    if (!isNaN(n)) {
      if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
      if (n >= 1048576)    return (n / 1048576).toFixed(1) + ' MB';
      return n.toFixed(0) + ' B';
    }
  }
  if (lk.includes('cpu') || lk.includes('percent')) {
    const n = parseFloat(String(val));
    return isNaN(n) ? String(val) : n.toFixed(1) + '%';
  }
  return String(val);
}
function lsCls(key: string, val: unknown): string {
  if (key === 'status') {
    const s = String(val).toLowerCase();
    if (['green', 'ok'].includes(s)) return 'val-ok';
    if (s === 'yellow') return 'val-warn';
    return 'val-err';
  }
  return '';
}
function statusBadge(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (['ok', 'green', 'healthy'].includes(s)) return 'badge-ok';
  if (['yellow', 'degraded'].includes(s))     return 'badge-warn';
  return 'badge-err';
}
function clamp(v: unknown): number {
  const n = parseFloat(String(v ?? 0));
  return isNaN(n) ? 0 : Math.min(Math.max(n, 0), 100);
}
function pct(v: unknown): string {
  const n = parseFloat(String(v ?? 0));
  return isNaN(n) ? '—' : n.toFixed(1) + '%';
}
function availCls(v: unknown): string {
  const n = parseFloat(String(v ?? 0));
  return n < 20 ? 'bar-err' : n < 40 ? 'bar-warn' : 'bar-ok';
}
function diskCls(v: unknown): string {
  const n = parseFloat(String(v ?? 0));
  return n >= 80 ? 'bar-err' : n >= 60 ? 'bar-warn' : 'bar-ok';
}
</script>

<style scoped>
.mon-layout { display: flex; height: 100%; background: var(--bg-base); overflow: hidden; }
.mon-main   { flex: 1; overflow: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }

.mon-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.mon-title-row { display: flex; align-items: baseline; gap: 12px; }
.mon-title   { font-size: 16px; font-weight: 600; }
.mon-updated { font-size: 11px; color: var(--tx-3); }

.btn-refresh {
  display: flex; align-items: center; gap: 5px;
  background: var(--bg-card); border: 1px solid var(--bd);
  color: var(--tx-2); padding: 6px 14px; border-radius: 6px;
  font-size: 12px; cursor: pointer; transition: all .12s;
}
.btn-refresh:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn-refresh:disabled { opacity: .5; cursor: default; }
.btn-refresh.spinning { animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-retry {
  background: var(--col-err-bg); border: 1px solid var(--col-err);
  color: var(--col-err); padding: 4px 12px; border-radius: 5px; font-size: 11px; cursor: pointer;
}

.mon-state { display: flex; align-items: center; gap: 12px; padding: 32px; color: var(--tx-3); font-size: 13px; }
.mon-state.error { color: var(--col-err); }
.spinner {
  width: 18px; height: 18px; border: 2px solid var(--bd); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .7s linear infinite;
}

.table-wrap { overflow-x: auto; border: 1px solid var(--bd); border-radius: 8px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table thead th {
  background: var(--bg-deep); color: var(--tx-2); font-weight: 600; font-size: 11px;
  text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--bd); white-space: nowrap;
}
.data-table tbody tr:nth-child(even) td { background: var(--bg-deep); }
.data-table tbody tr:hover td { background: var(--bg-hover) !important; }
.data-table td { padding: 9px 14px; border-bottom: 1px solid var(--bd-faint); color: var(--tx-1); vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.mono { font-family: monospace; font-size: 11px; }

.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.badge-ok      { background: var(--col-ok-bg);   color: var(--col-ok); }
.badge-warn    { background: var(--col-warn-bg); color: var(--col-warn); }
.badge-err     { background: var(--col-err-bg);  color: var(--col-err); }
.badge-neutral { background: var(--bd-sub);       color: var(--tx-3); }

.bar-wrap { display: flex; align-items: center; gap: 8px; min-width: 130px; }
.bar { height: 6px; border-radius: 3px; min-width: 2px; transition: width .3s; }
.bar-ok   { background: var(--col-ok); }
.bar-warn { background: var(--col-warn); }
.bar-err  { background: var(--col-err); }
.bar-val  { font-family: monospace; font-size: 11px; color: var(--tx-2); white-space: nowrap; }

.section-sep { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--bd); padding-top: 6px; margin-top: 2px; }
.section-label { font-size: 11px; font-weight: 700; color: var(--tx-3); text-transform: uppercase; letter-spacing: .06em; }

.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.stat-card { background: var(--bg-card); border: 1px solid var(--bd); border-radius: 8px; padding: 12px 14px; }
.stat-lbl { font-size: 10px; color: var(--tx-3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
.stat-val { font-size: 15px; font-weight: 600; font-family: monospace; }
.val-ok   { color: var(--col-ok); }
.val-warn { color: var(--col-warn); }
.val-err  { color: var(--col-err); }
</style>
