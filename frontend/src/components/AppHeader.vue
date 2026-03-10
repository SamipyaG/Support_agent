<template>
  <header class="app-header">
    <div class="brand">
      <span class="brand-pulse" :class="{ 'pulse-red': store.activeIncidents.length > 0 }"></span>
      <div>
        <div class="brand-name">G-MANA</div>
        <div class="brand-tag">Support AI</div>
      </div>
    </div>

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
      <RedisPanel />
      <AlarmNotificationBell />
      <span class="live-pill"><span class="live-dot"></span>LIVE</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useIncidentsStore } from '@/store/incidents';
import { useVipChannelsStore } from '@/store/vipChannels';
import RedisPanel from '@/components/RedisPanel.vue';
import AlarmNotificationBell from '@/components/AlarmNotificationBell.vue';

const store = useIncidentsStore();
const vipStore = useVipChannelsStore();
const waitingApprovals = computed(
  () => store.deduplicatedIncidents.filter((i) => i.state === 'WAITING_APPROVAL').length,
);

const vipIncidentCount = computed(
  () => store.activeIncidents.filter((i) => vipStore.isVipChannel(i.channelName)).length,
);
</script>

<style scoped>
.app-header {
  height: 52px;
  background: #111318;
  border-bottom: 1px solid #252b36;
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
</style>
