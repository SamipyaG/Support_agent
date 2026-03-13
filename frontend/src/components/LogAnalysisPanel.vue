<template>
  <div class="info-card lap-card">
    <!-- Header -->
    <div class="lap-header">
      <span class="info-title">Log Analysis</span>
      <div class="lap-pills">
        <span v-if="totalCritical" class="lap-pill lap-critical">{{ totalCritical }} CRITICAL</span>
        <span v-if="totalErrors"   class="lap-pill lap-error">{{ totalErrors }} ERROR</span>
        <span v-if="totalWarnings" class="lap-pill lap-warn">{{ totalWarnings }} WARN</span>
        <span v-if="!totalIssues"  class="lap-pill lap-ok">✓ Clean</span>
      </div>
    </div>

    <!-- Service tabs (shown when >1 service) -->
    <div v-if="analyses.length > 1" class="lap-tabs">
      <button
        v-for="(a, idx) in analyses"
        :key="a.service"
        class="lap-tab"
        :class="{ active: activeIdx === idx }"
        @click="activeIdx = idx"
      >
        <span class="lap-tab-dot" :class="tabDotClass(a)"></span>
        {{ a.service }}
      </button>
    </div>

    <!-- Current service analysis -->
    <template v-if="current">
      <div class="lap-meta">
        <span class="lap-pod mono">pod: {{ current.podName }}</span>
        <span class="lap-at dim">{{ fmtTime(current.analyzedAt) }}</span>
      </div>

      <div v-if="current.issues.length === 0" class="lap-clean">
        No critical errors detected in the logs.
      </div>

      <div v-else class="lap-issues">
        <div
          v-for="(issue, i) in current.issues"
          :key="i"
          class="lap-row"
          :class="`lap-row-${issue.severity.toLowerCase()}`"
        >
          <span class="lap-sev" :class="`lap-sev-${issue.severity.toLowerCase()}`">
            {{ issue.severity }}
          </span>
          <span class="lap-lno dim mono">L{{ issue.lineNumber }}</span>
          <span class="lap-msg mono">{{ issue.message }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { LogAnalysis } from '@/api/restart';

const props = defineProps<{ analyses: LogAnalysis[] }>();

const activeIdx = ref(0);

const current = computed(() => props.analyses[activeIdx.value] ?? null);

const totalCritical = computed(() =>
  props.analyses.reduce((s, a) => s + a.issues.filter(i => i.severity === 'CRITICAL').length, 0),
);
const totalErrors = computed(() =>
  props.analyses.reduce((s, a) => s + a.issues.filter(i => i.severity === 'ERROR').length, 0),
);
const totalWarnings = computed(() =>
  props.analyses.reduce((s, a) => s + a.issues.filter(i => i.severity === 'WARN').length, 0),
);
const totalIssues = computed(() => totalCritical.value + totalErrors.value + totalWarnings.value);

function tabDotClass(a: LogAnalysis): string {
  const hasCrit = a.issues.some(i => i.severity === 'CRITICAL');
  const hasErr  = a.issues.some(i => i.severity === 'ERROR');
  const hasWarn = a.issues.some(i => i.severity === 'WARN');
  if (hasCrit || hasErr) return 'dot-err';
  if (hasWarn) return 'dot-warn';
  return 'dot-ok';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<style scoped>
.lap-card { display: flex; flex-direction: column; gap: 10px; }

/* ── Header ─────────────────────────────── */
.lap-header {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 6px;
}
.info-title { margin-bottom: 0 !important; }
.lap-pills { display: flex; gap: 5px; flex-wrap: wrap; }
.lap-pill {
  font-size: 9px; font-weight: 700; padding: 2px 7px;
  border-radius: 10px; text-transform: uppercase; letter-spacing: .05em;
  white-space: nowrap;
}
.lap-critical { background: rgba(248,81,73,.18);  color: #f85149; border: 1px solid rgba(248,81,73,.3); }
.lap-error    { background: rgba(248,81,73,.10);  color: #e07070; border: 1px solid rgba(248,81,73,.2); }
.lap-warn     { background: rgba(227,162,58,.15); color: #e3a23a; border: 1px solid rgba(227,162,58,.3); }
.lap-ok       { background: rgba(63,185,80,.12);  color: #3fb950; border: 1px solid rgba(63,185,80,.25); }

/* ── Tabs ───────────────────────────────── */
.lap-tabs { display: flex; gap: 4px; }
.lap-tab {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 12px; border-radius: 6px; border: 1px solid var(--bd);
  background: transparent; color: var(--tx-2); font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .12s;
}
.lap-tab:hover { background: var(--bg-hover); color: var(--tx-1); }
.lap-tab.active { background: var(--accent-bg); border-color: var(--accent); color: var(--accent); }
.lap-tab-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot-err  { background: var(--col-err); }
.dot-warn { background: var(--col-warn); }
.dot-ok   { background: var(--col-ok); }

/* ── Meta row ───────────────────────────── */
.lap-meta {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 4px 0; border-top: 1px solid var(--bd-sub);
}
.lap-pod { font-size: 10px; color: var(--tx-2); word-break: break-all; }
.lap-at  { font-size: 10px; white-space: nowrap; }

/* ── Clean state ────────────────────────── */
.lap-clean {
  padding: 10px 12px;
  background: rgba(63,185,80,.07); border: 1px solid rgba(63,185,80,.2);
  border-radius: 6px; font-size: 11px; color: #3fb950; font-weight: 500;
}

/* ── Issue list ─────────────────────────── */
.lap-issues {
  display: flex; flex-direction: column; gap: 3px;
  max-height: 260px; overflow-y: auto;
}
.lap-row {
  display: grid;
  grid-template-columns: 68px 48px 1fr;
  gap: 6px; align-items: baseline;
  padding: 5px 8px; border-radius: 5px;
  background: var(--bg-deep);
}
.lap-row-critical { border-left: 3px solid #f85149; }
.lap-row-error    { border-left: 3px solid #e07070; }
.lap-row-warn     { border-left: 3px solid #e3a23a; }

.lap-sev {
  font-size: 8px; font-weight: 800; letter-spacing: .06em;
  text-transform: uppercase; padding: 1px 5px; border-radius: 3px;
  white-space: nowrap;
}
.lap-sev-critical { background: rgba(248,81,73,.18); color: #f85149; }
.lap-sev-error    { background: rgba(248,81,73,.10); color: #e07070; }
.lap-sev-warn     { background: rgba(227,162,58,.15); color: #e3a23a; }

.lap-lno { font-size: 9px; text-align: right; }
.lap-msg {
  font-size: 10px; color: var(--tx-1); word-break: break-all;
  line-height: 1.4; white-space: pre-wrap;
}

.dim  { color: var(--tx-3); }
.mono { font-family: monospace; }
</style>
