<template>
  <div class="lap-wrap">
    <div
      v-for="(a, idx) in analyses"
      :key="a.service"
      class="lap-accordion"
      :class="{ open: openSet.has(idx) }"
    >
      <!-- Accordion header -->
      <button class="lap-acc-hdr" @click="toggle(idx)">
        <span class="lap-chevron" :class="{ rotated: openSet.has(idx) }">▾</span>
        <span class="lap-svc-name">{{ a.service }}</span>
        <span class="lap-pod dim mono">{{ a.podName }}</span>
        <span class="lap-time dim mono">{{ fmtTime(a.analyzedAt) }}</span>
        <div class="lap-pills">
          <span v-if="critCount(a)" class="lap-pill lap-critical">{{ critCount(a) }} CRITICAL</span>
          <span v-if="errCount(a)"  class="lap-pill lap-error">{{ errCount(a) }} ERROR</span>
          <span v-if="warnCount(a)" class="lap-pill lap-warn">{{ warnCount(a) }} WARN</span>
          <span v-if="!a.issues.length" class="lap-pill lap-ok">✓ Clean</span>
        </div>
      </button>

      <!-- Accordion body -->
      <div v-if="openSet.has(idx)" class="lap-acc-body">
        <div v-if="a.issues.length === 0" class="lap-clean">
          No critical errors detected in the logs.
        </div>
        <div v-else class="lap-issues">
          <div
            v-for="(issue, i) in a.issues"
            :key="i"
            class="lap-row"
            :class="`lap-row-${issue.severity.toLowerCase()}`"
          >
            <span class="lap-sev" :class="`lap-sev-${issue.severity.toLowerCase()}`">{{ issue.severity }}</span>
            <span class="lap-lno dim mono">L{{ issue.lineNumber }}</span>
            <span class="lap-msg mono">{{ issue.message }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { LogAnalysis } from '@/api/restart';

const props = defineProps<{ analyses: LogAnalysis[] }>();

// Track which accordions are open; auto-open newly added entries
const openSet = ref<Set<number>>(new Set());

watch(
  () => props.analyses.length,
  (len) => {
    // Open the most recently added entry
    if (len > 0) {
      const s = new Set(openSet.value);
      s.add(len - 1);
      openSet.value = s;
    }
  },
  { immediate: true },
);

function toggle(idx: number): void {
  const s = new Set(openSet.value);
  if (s.has(idx)) s.delete(idx);
  else s.add(idx);
  openSet.value = s;
}

function critCount(a: LogAnalysis): number { return a.issues.filter(i => i.severity === 'CRITICAL').length; }
function errCount(a: LogAnalysis): number  { return a.issues.filter(i => i.severity === 'ERROR').length; }
function warnCount(a: LogAnalysis): number { return a.issues.filter(i => i.severity === 'WARN').length; }

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<style scoped>
/* ── Outer wrap — scrollable ────────────────────── */
.lap-wrap {
  display: flex; flex-direction: column; gap: 0;
  max-height: 420px; overflow-y: auto;
  padding: 8px 14px 14px;
}

/* ── Accordion item ─────────────────────────────── */
.lap-accordion {
  border: 1px solid var(--bd);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 6px;
}
.lap-accordion:last-child { margin-bottom: 0; }
.lap-accordion.open { border-color: var(--accent); }

/* ── Accordion header (button) ──────────────────── */
.lap-acc-hdr {
  width: 100%; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 9px 12px; background: var(--bg-deep);
  border: none; cursor: pointer; text-align: left;
  transition: background .12s;
}
.lap-acc-hdr:hover { background: var(--bg-hover); }
.lap-accordion.open .lap-acc-hdr { background: rgba(77,157,224,.06); }

.lap-chevron {
  font-size: 10px; color: var(--tx-3); flex-shrink: 0;
  transition: transform .18s; display: inline-block;
}
.lap-chevron.rotated { transform: rotate(180deg); }

.lap-svc-name {
  font-size: 12px; font-weight: 700; color: var(--tx-1); white-space: nowrap;
}
.lap-pod {
  font-size: 10px; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lap-time { font-size: 10px; white-space: nowrap; flex-shrink: 0; }

.lap-pills { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; flex-shrink: 0; }
.lap-pill {
  font-size: 9px; font-weight: 700; padding: 1px 6px;
  border-radius: 8px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
}
.lap-critical { background: rgba(248,81,73,.18);  color: #f85149; border: 1px solid rgba(248,81,73,.3); }
.lap-error    { background: rgba(248,81,73,.10);  color: #e07070; border: 1px solid rgba(248,81,73,.2); }
.lap-warn     { background: rgba(227,162,58,.15); color: #e3a23a; border: 1px solid rgba(227,162,58,.3); }
.lap-ok       { background: rgba(63,185,80,.12);  color: #3fb950; border: 1px solid rgba(63,185,80,.25); }

/* ── Accordion body ─────────────────────────────── */
.lap-acc-body {
  border-top: 1px solid var(--bd);
  background: var(--bg-base);
}

.lap-clean {
  padding: 10px 12px;
  font-size: 11px; color: #3fb950; font-weight: 500;
}

.lap-issues {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 8px;
}

.lap-row {
  display: grid;
  grid-template-columns: 68px 44px 1fr;
  gap: 6px; align-items: baseline;
  padding: 5px 8px; border-radius: 5px;
  background: var(--bg-deep);
}
.lap-row-critical { border-left: 3px solid #f85149; }
.lap-row-error    { border-left: 3px solid #e07070; }
.lap-row-warn     { border-left: 3px solid #e3a23a; }

.lap-sev {
  font-size: 8px; font-weight: 800; letter-spacing: .06em;
  text-transform: uppercase; padding: 1px 5px; border-radius: 3px; white-space: nowrap;
}
.lap-sev-critical { background: rgba(248,81,73,.18); color: #f85149; }
.lap-sev-error    { background: rgba(248,81,73,.10); color: #e07070; }
.lap-sev-warn     { background: rgba(227,162,58,.15); color: #e3a23a; }

.lap-lno { font-size: 9px; text-align: right; color: var(--tx-3); }
.lap-msg {
  font-size: 10px; color: var(--tx-1); word-break: break-all;
  line-height: 1.4; white-space: pre-wrap;
}

.dim  { color: var(--tx-3); }
.mono { font-family: monospace; }
</style>
