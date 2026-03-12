<template>
  <header class="app-header">
    <div class="brand">
      <span class="brand-pulse" :class="{ 'pulse-red': store.activeIncidents.length > 0 }"></span>
      <div>
        <div class="brand-name">G-MANA</div>
        <div class="brand-tag">Support AI</div>
      </div>
    </div>

    <nav class="header-nav">
      <button class="nav-btn" :class="{ active: route.name === 'dashboard' }" @click="router.push('/')">⚡ Alarms</button>
      <button class="nav-btn" :class="{ active: route.name === 'monitoring' }" @click="router.push('/monitoring')">📡 Monitoring</button>
    </nav>

    <div class="kpi-group">
      <div class="kpi">
        <span class="kpi-val red">{{ store.activeIncidents.length }}</span>
        <span class="kpi-lbl">Active Incidents</span>
      </div>
      <div class="kpi">
        <span class="kpi-val amber">{{ waitingApprovals }}</span>
        <span class="kpi-lbl">Awaiting Approval</span>
      </div>
      <div class="kpi">
        <span class="kpi-val green">{{ vipIncidentCount }}</span>
        <span class="kpi-lbl">Prioritized Channels</span>
      </div>
    </div>

    <div class="header-right">
      <ClusterPanel label="Pending Pods" type="pending-pods" />
      <ClusterPanel label="Components"   type="components" />
      <ClusterPanel label="Coherency"    type="coherency" />
      <RedisPanel />
      <AlarmNotificationBell />
      <span class="live-pill"><span class="live-dot"></span>LIVE</span>
      <button class="theme-toggle" @click="toggleTheme" :title="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
        <span v-if="isDark">☀</span>
        <span v-else>☾</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useIncidentsStore } from '@/store/incidents';
import { useVipChannelsStore } from '@/store/vipChannels';
import RedisPanel from '@/components/RedisPanel.vue';
import AlarmNotificationBell from '@/components/AlarmNotificationBell.vue';
import ClusterPanel from '@/components/ClusterPanel.vue';

const router = useRouter();
const route  = useRoute();

const store = useIncidentsStore();
const vipStore = useVipChannelsStore();
const waitingApprovals = computed(
  () => store.deduplicatedIncidents.filter((i) => i.state === 'WAITING_APPROVAL').length,
);

const vipIncidentCount = computed(
  () => store.activeIncidents.filter((i) => vipStore.isVipChannel(i.channelName)).length,
);

const isDark = ref(!document.documentElement.classList.contains('light'));

function toggleTheme() {
  isDark.value = !isDark.value;
  if (isDark.value) {
    document.documentElement.classList.remove('light');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.add('light');
    localStorage.setItem('theme', 'light');
  }
}

// Apply saved preference on load
const saved = localStorage.getItem('theme');
if (saved === 'light') {
  document.documentElement.classList.add('light');
  isDark.value = false;
}
</script>

<style scoped>
.app-header {
  height: 52px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--bd);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 16px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 100;
}

.brand { display: flex; align-items: center; gap: 10px; margin-right: 20px; }
.brand-pulse {
  width: 7px; height: 7px; border-radius: 50%; background: #3fb950;
  box-shadow: 0 0 0 3px rgba(63,185,80,.2);
  animation: pulse 2.5s ease-in-out infinite;
}
.brand-pulse.pulse-red { background: #f85149; box-shadow: 0 0 0 3px rgba(248,81,73,.2); }
@keyframes pulse { 0%,100%{ opacity:1 } 50%{ opacity:.5 } }
.brand-name { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; letter-spacing: .06em; }
.brand-tag { font-size: 10px; color: #4f5b6e; }

.header-nav { display: flex; gap: 4px; margin-right: 16px; }
.nav-btn {
  background: none; border: 1px solid transparent;
  color: var(--tx-2); padding: 4px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 500; cursor: pointer; transition: all .12s;
}
.nav-btn:hover { background: var(--bg-hover); color: var(--tx-1); border-color: var(--bd); }
.nav-btn.active { background: var(--accent-bg); color: var(--accent); border-color: rgba(77,157,224,.3); }

.kpi-group { display: flex; gap: 20px; flex: 1; }
.kpi { display: flex; flex-direction: column; }
.kpi-val { font-family: monospace; font-size: 20px; font-weight: 700; line-height: 1; }
.kpi-val.red { color: #f85149; }
.kpi-val.amber { color: #e3a23a; }
.kpi-val.green { color: #3fb950; }
.kpi-lbl { font-size: 10px; color: #4f5b6e; margin-top: 1px; }

.header-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.live-pill {
  display: flex; align-items: center; gap: 5px;
  background: rgba(63,185,80,.1); border: 1px solid rgba(63,185,80,.25);
  padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 600; color: #3fb950;
}
.live-dot {
  width: 5px; height: 5px; border-radius: 50%; background: #3fb950;
  animation: pulse 1.5s ease-in-out infinite;
}

.theme-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: transparent; border: 1px solid var(--bd);
  color: var(--tx-2); font-size: 13px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  flex-shrink: 0;
}
.theme-toggle:hover {
  background: var(--bg-hover); border-color: var(--tx-3); color: var(--tx-1);
}
</style>
