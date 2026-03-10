<template>
  <div class="app">
    <AppHeader />
    <div class="app-content">
      <router-view />
    </div>
    <AlarmNotificationToast />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useIncidentsStore } from '@/store/incidents';
import { useVipChannelsStore } from '@/store/vipChannels';
import AppHeader from '@/components/AppHeader.vue';
import AlarmNotificationToast from '@/components/AlarmNotificationToast.vue';

const store = useIncidentsStore();
const vipStore = useVipChannelsStore();
let pollTimer: ReturnType<typeof setInterval>;

onMounted(() => {
  store.fetchIncidents();
  vipStore.fetchVipChannels();
  pollTimer = setInterval(() => store.pollActiveIncidents(), 10000);
});

onUnmounted(() => {
  clearInterval(pollTimer);
});
</script>

<style>
/* ── CSS Variables ───────────────────────────────── */
:root {
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

/* ── Reset ───────────────────────────────────────── */
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  background: var(--bg-base);
  color: var(--tx-1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
}
a { color: inherit; text-decoration: none; }

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
</style>
