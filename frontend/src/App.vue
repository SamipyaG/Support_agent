<template>
  <div class="app">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useIncidentsStore } from '@/store/incidents';

const store = useIncidentsStore();
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
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0a0d11;
  color: #edf2f7;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
}
a { color: inherit; text-decoration: none; }
</style>
