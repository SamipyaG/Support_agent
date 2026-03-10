<template>
  <div class="app">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useIncidentsStore } from '@/store/incidents';
import { useTheme } from '@/composables/useTheme';

const store = useIncidentsStore();
useTheme(); // restore saved theme on boot
let pollTimer: ReturnType<typeof setInterval>;

onMounted(() => {
  store.fetchIncidents();
  pollTimer = setInterval(() => store.pollActiveIncidents(), 10000);
});

onUnmounted(() => {
  clearInterval(pollTimer);
});
</script>

<style>
/* ── Theme variables ─────────────────────────────── */
:root, [data-theme="dark"] {
  --bg-base:    #0a0d11;
  --bg-card:    #111318;
  --bg-deep:    #0d1017;
  --bg-hover:   #0d1017;
  --bd:         #252b36;
  --bd-sub:     #1e2330;
  --bd-faint:   #1a1f28;
  --tx-1:       #edf2f7;
  --tx-2:       #8896aa;
  --tx-3:       #4f5b6e;
  --tx-4:       #2e3545;
  --accent:     #4d9de0;
  --accent-bg:  rgba(77,157,224,.1);
  --col-ok:         #3fb950;
  --col-ok-bg:      rgba(63,185,80,.12);
  --col-warn:       #e3a23a;
  --col-warn-bg:    rgba(227,162,58,.12);
  --col-err:        #f85149;
  --col-err-bg:     rgba(248,81,73,.12);
  --shadow:     0 8px 24px rgba(0,0,0,.55);
}

[data-theme="light"] {
  --bg-base:  #2d3748;
  --bg-card:  #3a4a61;
  --bg-deep:  #263040;
  --bg-hover: #263040;
  --bd:       #4a5a72;
  --bd-sub:   #3d4f66;
  --bd-faint: #344258;
  --shadow:   0 8px 24px rgba(0,0,0,.3);
}

/* ── Reset ───────────────────────────────────────── */
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg-base);
  color: var(--tx-1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
  transition: background .2s, color .2s;
}
a { color: inherit; text-decoration: none; }
</style>
