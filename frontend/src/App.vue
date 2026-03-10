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
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  background: #0a0d11;
  color: #edf2f7;
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
