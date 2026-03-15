<template>
  <div class="mon-layout">
    <!-- Sidebar -->
    <nav class="mon-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <button class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed" :title="sidebarCollapsed ? 'Expand' : 'Collapse'">
        {{ sidebarCollapsed ? '›' : '‹' }}
      </button>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <div v-for="item in panels" :key="item.id"
        class="nav-item"
        :class="{ active: activePanel === item.id }"
        @click="selectPanel(item.id)"
        :title="item.label"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
        <span v-if="!sidebarCollapsed && statusMap[item.id]" class="nav-status" :class="statusMap[item.id]"></span>
      </div>
    </nav>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
    <!-- Main content -->
    <main class="mon-main">
      <div class="mon-header">
        <div class="mon-title-row">
          <h2 class="mon-title">{{ currentPanel.icon }} {{ currentPanel.label }}</h2>
          <span v-if="lastUpdated" class="mon-updated">Updated {{ lastUpdated }}</span>
        </div>
        <button class="btn-refresh" :class="{ spinning: loading }" @click="fetchData" :disabled="loading">
          ↻ Refresh
        </button>
      </div>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- Loading -->
      <div v-if="loading" class="mon-state">
        <div class="spinner"></div>
        <span>Fetching data…</span>
      </div>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- Error -->
      <div v-else-if="error" class="mon-state error">
        <span class="err-icon">⚠</span>
        <span>{{ error }}</span>
        <button class="btn-retry" @click="fetchData">Retry</button>
      </div>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- OpenSearch -->
      <template v-else-if="activePanel === 'opensearch' && data">
        <div class="cards-grid">
          <div class="stat-card" v-for="(val, key) in flattenTop(data)" :key="key">
            <div class="stat-key">{{ formatKey(key) }}</div>
            <div class="stat-val" :class="statusClass(key, val)">{{ formatVal(key, val) }}</div>
          </div>
        </div>
        <template v-if="data.indices && Array.isArray(data.indices)">
          <div class="section-title">Indices</div>
          <MonTable :rows="data.indices" :formatters="indexFormatters" />
        </template>
      </template>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- Logstash -->
      <template v-else-if="activePanel === 'logstash' && data">
        <div class="cards-grid" v-if="data.status || data.jvm || data.process">
          <div class="stat-card" v-for="(val, key) in logstashSummary" :key="key">
            <div class="stat-key">{{ formatKey(key) }}</div>
            <div class="stat-val" :class="statusClass(key, val)">{{ formatVal(key, val) }}</div>
          </div>
        </div>
        <template v-if="pipelines.length">
          <div class="section-title">Pipelines</div>
          <MonTable :rows="pipelines" :formatters="pipelineFormatters" />
        </template>
        <template v-else-if="Array.isArray(data)">
          <MonTable :rows="data" :formatters="logstashFormatters" />
        </template>
        <template v-else-if="!data.status && !data.jvm">
          <pre class="json-dump">{{ JSON.stringify(data, null, 2) }}</pre>
        </template>
      </template>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- Pending Pods -->
      <template v-else-if="activePanel === 'pending-pods' && data">
        <div v-if="podRows.length === 0" class="mon-state ok">
          <span>✓ No pending pods</span>
        </div>
        <template v-else>
          <div class="section-badge red">{{ podRows.length }} pending pod{{ podRows.length !== 1 ? 's' : '' }}</div>
          <MonTable :rows="podRows" :formatters="podFormatters" />
        </template>
      </template>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- Components -->
      <template v-else-if="activePanel === 'components' && data">
        <MonTable :rows="componentRows" :formatters="componentFormatters" />
      </template>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- Coherency -->
      <template v-else-if="activePanel === 'coherency' && data">
        <div v-if="coherencyRows.length === 0" class="mon-state ok">
          <span>✓ All configurations are coherent</span>
        </div>
        <template v-else>
          <MonTable :rows="coherencyRows" :formatters="coherencyFormatters" />
        </template>
      </template>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
      <!-- Fallback generic renderer -->
      <template v-else-if="data">
        <template v-if="Array.isArray(data)">
          <MonTable :rows="data" />
        </template>
        <template v-else>
          <div class="cards-grid">
            <div class="stat-card" v-for="(val, key) in flattenTop(data)" :key="key">
              <div class="stat-key">{{ formatKey(key) }}</div>
              <div class="stat-val" :class="statusClass(key, val)">{{ formatVal(key, val) }}</div>
            </div>
          </div>
        </template>
      </template>
    </main>
  </div>
</template>
<<<<<<< HEAD

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue';

=======
 
<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue';
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Inline MonTable component ─────────────────────────── */
const MonTable = defineComponent({
  props: {
    rows: { type: Array as () => Record<string, unknown>[], required: true },
    formatters: { type: Object as () => Record<string, (v: unknown) => ReturnType<typeof h>>, default: () => ({}) },
  },
  setup(props) {
    const sortKey = ref('');
    const sortDir = ref<1 | -1>(1);
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
    const headers = computed(() => {
      const set = new Set<string>();
      props.rows.forEach((r) => Object.keys(r).forEach((k) => set.add(k)));
      return Array.from(set);
    });
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
    const sorted = computed(() => {
      if (!sortKey.value) return props.rows;
      return [...props.rows].sort((a, b) => {
        const av = a[sortKey.value] ?? '';
        const bv = b[sortKey.value] ?? '';
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sortDir.value;
      });
    });
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
    function toggle(key: string) {
      if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1;
      else { sortKey.value = key; sortDir.value = 1; }
    }
<<<<<<< HEAD

    function fmtHeader(k: string) {
      return k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
    }

=======
 
    function fmtHeader(k: string) {
      return k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
    }
 
>>>>>>> ca6b98a (resolve conflict)
    return () => {
      if (!props.rows.length) return h('div', { class: 'empty-table' }, 'No data');
      return h('div', { class: 'table-wrap' },
        h('table', { class: 'mon-table' }, [
          h('thead', h('tr', headers.value.map(col =>
            h('th', { onClick: () => toggle(col), class: 'sortable' }, [
              fmtHeader(col),
              sortKey.value === col ? h('span', { class: 'sort-arrow' }, sortDir.value === 1 ? ' ↑' : ' ↓') : null,
            ])
          ))),
          h('tbody', sorted.value.map((row, ri) =>
            h('tr', { class: ri % 2 === 0 ? 'row-even' : 'row-odd' },
              headers.value.map(col => {
                const val = row[col];
                const cell = props.formatters[col] ? props.formatters[col](val) : h('span', { class: 'cell-text' }, val == null ? '—' : String(val));
                return h('td', cell);
              })
            )
          )),
        ])
      );
    };
  },
});
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Panel config ──────────────────────────────────────── */
const panels = [
  { id: 'opensearch',    label: 'OpenSearch',    icon: '🔍', url: 'https://hub-monitor.g-mana.live/sendalarms/opensearch' },
  { id: 'logstash',      label: 'Logstash',      icon: '📊', url: 'https://hub-monitor.g-mana.live/sendalarms/status/logstash' },
  { id: 'pending-pods',  label: 'Pending Pods',  icon: '⏳', url: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub1x/pending-pods' },
  { id: 'components',    label: 'Components',    icon: '🧩', url: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub1x/components' },
  { id: 'coherency',     label: 'Coherency',     icon: '🔗', url: 'https://hub-monitor.g-mana.live/sendalarms/clusters/hub1x/configuration-coherency' },
];
<<<<<<< HEAD

/* ── State ─────────────────────────────────────────────── */
const activePanel   = ref('opensearch');
const sidebarCollapsed = ref(false);
// API response shape is fully dynamic — use any for template property access
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = ref<any>(null);
=======
 
/* ── State ─────────────────────────────────────────────── */
const activePanel   = ref('opensearch');
const sidebarCollapsed = ref(false);
const data          = ref<unknown>(null);
>>>>>>> ca6b98a (resolve conflict)
const loading       = ref(false);
const error         = ref('');
const lastUpdated   = ref('');
const statusMap     = ref<Record<string, string>>({});
<<<<<<< HEAD

const currentPanel = computed(() => panels.find(p => p.id === activePanel.value)!);

/* ── Fetch ─────────────────────────────────────────────── */
const API_KEY = import.meta.env.VITE_HUB_MONITOR_API_KEY as string;

=======
 
const currentPanel = computed(() => panels.find(p => p.id === activePanel.value)!);
 
/* ── Fetch ─────────────────────────────────────────────── */
const API_KEY = import.meta.env.VITE_HUB_MONITOR_API_KEY as string;
 
>>>>>>> ca6b98a (resolve conflict)
async function fetchData() {
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const res = await fetch(currentPanel.value.url, {
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    data.value = await res.json();
    lastUpdated.value = new Date().toLocaleTimeString();
    updateStatusMap();
  } catch (e) {
    error.value = (e as Error).message || 'Failed to fetch data';
  } finally {
    loading.value = false;
  }
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
function selectPanel(id: string) {
  activePanel.value = id;
  fetchData();
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
function updateStatusMap() {
  const id = activePanel.value;
  if (id === 'pending-pods') {
    const rows = getPodRows();
    statusMap.value[id] = rows.length === 0 ? 'ok' : 'err';
  } else if (id === 'coherency') {
    const rows = getCoherencyRows();
    statusMap.value[id] = rows.length === 0 ? 'ok' : 'warn';
  } else if (id === 'logstash') {
    const d = data.value as Record<string, unknown>;
    const s = (d?.status as string)?.toLowerCase() || '';
    statusMap.value[id] = s === 'green' ? 'ok' : s === 'yellow' ? 'warn' : 'err';
  } else {
    statusMap.value[id] = 'ok';
  }
}
<<<<<<< HEAD

onMounted(() => fetchData());

=======
 
onMounted(() => fetchData());
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Helpers ───────────────────────────────────────────── */
function formatKey(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()).trim();
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
function formatBytes(bytes: number): string {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024)       return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
function formatCpu(val: unknown): string {
  if (val == null) return '—';
  const n = parseFloat(String(val));
  if (isNaN(n)) return String(val);
  return n.toFixed(1) + '%';
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
function formatVal(key: string, val: unknown): string {
  if (val == null) return '—';
  const lk = key.toLowerCase();
  if (lk.includes('mem') || lk.includes('heap') || lk.includes('bytes') || lk.includes('size')) {
    const n = parseFloat(String(val));
    if (!isNaN(n)) return formatBytes(n);
  }
  if (lk.includes('cpu') || lk.includes('percent') || lk.includes('usage')) {
    return formatCpu(val);
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
function statusClass(key: string, val: unknown): string {
  const lk = key.toLowerCase();
  const sv = String(val).toLowerCase();
  if (lk === 'status' || lk === 'health' || lk === 'state') {
    if (['green', 'ok', 'healthy', 'running', 'active'].includes(sv)) return 'val-ok';
    if (['yellow', 'warning', 'degraded'].includes(sv)) return 'val-warn';
    if (['red', 'error', 'failed', 'down', 'unhealthy'].includes(sv)) return 'val-err';
  }
  return '';
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
function flattenTop(obj: unknown): Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) out[k] = v;
  }
  return out;
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── OpenSearch formatters ─────────────────────────────── */
const indexFormatters = {
  health: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  status: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  'store.size': (v: unknown) => h('span', { class: 'cell-text' }, formatVal('size', v)),
};
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Logstash ──────────────────────────────────────────── */
const logstashSummary = computed(() => {
  const d = data.value as Record<string, unknown> | null;
  if (!d) return {};
  const out: Record<string, unknown> = {};
  if (d.status)  out.status = d.status;
  const jvm = d.jvm as Record<string, unknown> | undefined;
  if (jvm?.mem) {
    const mem = jvm.mem as Record<string, unknown>;
    out.heap_used = mem.heap_used_in_bytes;
    out.heap_max  = mem.heap_max_in_bytes;
  }
  const proc = d.process as Record<string, unknown> | undefined;
  if (proc?.cpu) {
    out.cpu_percent = (proc.cpu as Record<string, unknown>).percent;
  }
  if (d.host) out.host = d.host;
  if (d.version) out.version = d.version;
  return out;
});
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
const pipelines = computed(() => {
  const d = data.value as Record<string, unknown> | null;
  if (!d?.pipelines) return [];
  const p = d.pipelines as Record<string, unknown>;
  return Object.entries(p).map(([name, info]) => {
    const i = info as Record<string, unknown>;
    const events = i.events as Record<string, unknown> | undefined;
    return {
      name,
      workers: i.workers,
      events_in: events?.in,
      events_out: events?.out,
      events_filtered: events?.filtered,
      duration_ms: events?.duration_in_millis,
    };
  });
});
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
const logstashFormatters = {
  status: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  memory: (v: unknown) => h('span', { class: 'cell-text' }, formatBytes(parseFloat(String(v)))),
  cpu: (v: unknown) => h('span', { class: 'cell-text' }, formatCpu(v)),
};
<<<<<<< HEAD

const pipelineFormatters = {
  duration_ms: (v: unknown) => h('span', { class: 'cell-text' }, v != null ? Number(v).toLocaleString() + ' ms' : '—'),
};

=======
 
const pipelineFormatters = {
  duration_ms: (v: unknown) => h('span', { class: 'cell-text' }, v != null ? Number(v).toLocaleString() + ' ms' : '—'),
};
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Pending Pods ──────────────────────────────────────── */
function getPodRows(): Record<string, unknown>[] {
  const d = data.value;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    const obj = d as Record<string, unknown>;
    if (Array.isArray(obj.pods)) return obj.pods as Record<string, unknown>[];
    if (Array.isArray(obj.pendingPods)) return obj.pendingPods as Record<string, unknown>[];
    if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
  }
  return [];
}
<<<<<<< HEAD

const podRows = computed(() => getPodRows());

=======
 
const podRows = computed(() => getPodRows());
 
>>>>>>> ca6b98a (resolve conflict)
const podFormatters = {
  status: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  phase: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  age: (v: unknown) => h('span', { class: 'cell-mono' }, String(v ?? '—')),
};
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Components ────────────────────────────────────────── */
const componentRows = computed(() => {
  const d = data.value;
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  if (d && typeof d === 'object') {
    const obj = d as Record<string, unknown>;
    const arr = obj.components ?? obj.items ?? obj.data;
    if (Array.isArray(arr)) return arr as Record<string, unknown>[];
  }
  return [];
});
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
const componentFormatters = {
  status: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  health: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  state: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  memory: (v: unknown) => h('span', { class: 'cell-text' }, formatBytes(parseFloat(String(v)))),
  memoryUsage: (v: unknown) => h('span', { class: 'cell-text' }, formatBytes(parseFloat(String(v)))),
  cpu: (v: unknown) => h('span', { class: 'cell-text' }, formatCpu(v)),
  cpuUsage: (v: unknown) => h('span', { class: 'cell-text' }, formatCpu(v)),
};
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Coherency ─────────────────────────────────────────── */
function getCoherencyRows(): Record<string, unknown>[] {
  const d = data.value;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    const obj = d as Record<string, unknown>;
    const arr = obj.coherency ?? obj.issues ?? obj.mismatches ?? obj.items ?? obj.results;
    if (Array.isArray(arr)) return arr as Record<string, unknown>[];
    // flatten key-value diffs
    const rows: Record<string, unknown>[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const ov = v as Record<string, unknown>;
        rows.push({ key: k, ...ov });
      }
    }
    return rows;
  }
  return [];
}
<<<<<<< HEAD

const coherencyRows = computed(() => getCoherencyRows());

=======
 
const coherencyRows = computed(() => getCoherencyRows());
 
>>>>>>> ca6b98a (resolve conflict)
const coherencyFormatters = {
  status: (v: unknown) => h('span', { class: `badge-status ${statusClass('status', v)}` }, String(v ?? '—')),
  coherent: (v: unknown) => h('span', { class: `badge-status ${v ? 'val-ok' : 'val-err'}` }, v ? '✓ Yes' : '✗ No'),
  match: (v: unknown) => h('span', { class: `badge-status ${v ? 'val-ok' : 'val-err'}` }, v ? '✓ Match' : '✗ Mismatch'),
};
</script>
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
<style scoped>
/* ── Layout ──────────────────────────────────────────── */
.mon-layout {
  display: flex;
  height: 100%;
  background: var(--bg-base);
  overflow: hidden;
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Sidebar ─────────────────────────────────────────── */
.mon-sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-card);
  border-right: 1px solid var(--bd);
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 4px;
  transition: width .2s;
  overflow: hidden;
}
.mon-sidebar.collapsed { width: 48px; }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
.collapse-btn {
  align-self: flex-end;
  background: none;
  border: 1px solid var(--bd);
  color: var(--tx-2);
  border-radius: 4px;
  width: 24px; height: 24px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.collapse-btn:hover { background: var(--bg-hover); color: var(--tx-1); }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--tx-2);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  transition: background .12s, color .12s;
  flex-shrink: 0;
}
.nav-item:hover { background: var(--bg-hover); color: var(--tx-1); }
.nav-item.active { background: var(--accent-bg); color: var(--accent); }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
.nav-icon { font-size: 15px; flex-shrink: 0; }
.nav-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.nav-status {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.nav-status.ok   { background: var(--col-ok); }
.nav-status.warn { background: var(--col-warn); }
.nav-status.err  { background: var(--col-err); }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Main ────────────────────────────────────────────── */
.mon-main {
  flex: 1;
  overflow: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
.mon-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.mon-title-row { display: flex; align-items: baseline; gap: 12px; }
.mon-title { font-size: 16px; font-weight: 600; }
.mon-updated { font-size: 11px; color: var(--tx-3); }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
.btn-refresh {
  display: flex; align-items: center; gap: 6px;
  background: var(--bg-card); border: 1px solid var(--bd);
  color: var(--tx-2); padding: 6px 14px; border-radius: 6px;
  font-size: 12px; cursor: pointer; transition: all .12s;
}
.btn-refresh:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.btn-refresh:disabled { opacity: .5; cursor: default; }
.btn-refresh.spinning { animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
.btn-retry {
  background: var(--col-err-bg); border: 1px solid var(--col-err);
  color: var(--col-err); padding: 4px 12px; border-radius: 5px;
  font-size: 11px; cursor: pointer;
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── States ──────────────────────────────────────────── */
.mon-state {
  display: flex; align-items: center; gap: 12px;
  padding: 32px; color: var(--tx-3); font-size: 13px;
}
.mon-state.error { color: var(--col-err); }
.mon-state.ok { color: var(--col-ok); }
.err-icon { font-size: 18px; }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
.spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--bd);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Cards grid (summary stats) ──────────────────────── */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 8px;
  padding: 12px 14px;
}
.stat-key { font-size: 10px; color: var(--tx-3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
.stat-val { font-size: 15px; font-weight: 600; font-family: monospace; }
.val-ok   { color: var(--col-ok); }
.val-warn { color: var(--col-warn); }
.val-err  { color: var(--col-err); }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Section ─────────────────────────────────────────── */
.section-title { font-size: 11px; font-weight: 600; color: var(--tx-3); text-transform: uppercase; letter-spacing: .06em; }
.section-badge {
  display: inline-block;
  font-size: 11px; font-weight: 600;
  padding: 3px 10px; border-radius: 20px;
}
.section-badge.red { background: var(--col-err-bg); color: var(--col-err); border: 1px solid rgba(248,81,73,.25); }
<<<<<<< HEAD

=======
 
>>>>>>> ca6b98a (resolve conflict)
/* ── Table (rendered by MonTable) ────────────────────── */
:deep(.table-wrap) {
  overflow-x: auto;
  border: 1px solid var(--bd);
  border-radius: 8px;
}
:deep(.mon-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
:deep(.mon-table thead th) {
  background: var(--bg-deep);
  color: var(--tx-2);
  font-weight: 600;
  font-size: 11px;
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--bd);
  white-space: nowrap;
  user-select: none;
}
:deep(.mon-table thead th.sortable) { cursor: pointer; }
:deep(.mon-table thead th.sortable:hover) { color: var(--tx-1); }
:deep(.sort-arrow) { color: var(--accent); }
:deep(.row-even td) { background: var(--bg-card); }
:deep(.row-odd td)  { background: var(--bg-deep); }
:deep(.mon-table td) {
  padding: 9px 14px;
  border-bottom: 1px solid var(--bd-faint);
  color: var(--tx-1);
  vertical-align: middle;
}
:deep(.mon-table tr:last-child td) { border-bottom: none; }
:deep(.mon-table tr:hover td) { background: var(--bg-hover) !important; }
<<<<<<< HEAD

:deep(.cell-text) { color: var(--tx-1); }
:deep(.cell-mono) { font-family: monospace; font-size: 11px; color: var(--tx-2); }

=======
 
:deep(.cell-text) { color: var(--tx-1); }
:deep(.cell-mono) { font-family: monospace; font-size: 11px; color: var(--tx-2); }
 
>>>>>>> ca6b98a (resolve conflict)
:deep(.badge-status) {
  display: inline-block;
  padding: 2px 8px; border-radius: 4px;
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
}
:deep(.badge-status.val-ok)   { background: var(--col-ok-bg); color: var(--col-ok); }
:deep(.badge-status.val-warn) { background: var(--col-warn-bg); color: var(--col-warn); }
:deep(.badge-status.val-err)  { background: var(--col-err-bg); color: var(--col-err); }
:deep(.badge-status:not(.val-ok):not(.val-warn):not(.val-err)) { background: var(--bd-sub); color: var(--tx-2); }
<<<<<<< HEAD

:deep(.empty-table) { padding: 24px; color: var(--tx-3); text-align: center; font-size: 12px; }

=======
 
:deep(.empty-table) { padding: 24px; color: var(--tx-3); text-align: center; font-size: 12px; }
 
>>>>>>> ca6b98a (resolve conflict)
.json-dump {
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 8px;
  padding: 16px;
  font-size: 11px;
  font-family: monospace;
  color: var(--tx-2);
  overflow: auto;
  max-height: 500px;
}
</style>
<<<<<<< HEAD
=======
 
>>>>>>> ca6b98a (resolve conflict)
