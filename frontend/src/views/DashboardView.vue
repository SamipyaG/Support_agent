<template>
  <div class="dashboard">
    <!-- Topbar -->
    <header class="topbar">
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
          <span class="kpi-val green">{{ store.vipIncidents.length }}</span>
          <span class="kpi-lbl">VIP Channels</span>
        </div>
      </div>

      <div class="topbar-right">
        <span class="live-pill"><span class="live-dot"></span>LIVE</span>
      </div>
    </header>

    <!-- Manual alarm input -->
    <div class="manual-bar">
      <input
        v-model="manualUuid"
        class="uuid-input"
        placeholder="Enter ds_uuid to investigate manually..."
        @keydown.enter="triggerManual"
      />
      <button class="btn-primary" :disabled="triggering" @click="triggerManual">
        {{ triggering ? 'Triggering...' : '⚡ Investigate' }}
      </button>
      <span v-if="triggerError" class="trigger-error">{{ triggerError }}</span>
      <span v-if="triggerSuccess" class="trigger-success">✅ Incident {{ triggerSuccess }} created</span>
    </div>

    <!-- Incidents list -->
    <main class="incidents-area">
      <div class="list-header">
        <div>
          <h2 class="list-title">Active Incidents</h2>
          <p class="list-sub">Auto-refreshed every 10s · sorted by newest</p>
        </div>
        <div class="filter-tabs">
          <button
            v-for="tab in filterTabs"
            :key="tab.value"
            class="filter-tab"
            :class="{ active: activeFilter === tab.value }"
            @click="setFilter(tab.value)"
          >{{ tab.label }}</button>
        </div>
      </div>

      <div v-if="store.loading" class="loading-msg">Loading incidents...</div>
      <div v-else-if="store.error" class="error-msg">{{ store.error }}</div>
      <div v-else-if="filteredIncidents.length === 0" class="empty-msg">No incidents found.</div>

      <div v-else class="incidents-list">
        <IncidentCard
          v-for="incident in filteredIncidents"
          :key="incident._id"
          :incident="incident"
          @click="goToDetail(incident._id)"
        />
      </div>

      <!-- Pagination -->
      <div v-if="store.total > 20" class="pagination">
        <button
          class="page-btn"
          :disabled="store.currentPage <= 1"
          @click="loadPage(store.currentPage - 1)"
        >← Prev</button>
        <span class="page-info">Page {{ store.currentPage }} / {{ totalPages }}</span>
        <button
          class="page-btn"
          :disabled="store.currentPage >= totalPages"
          @click="loadPage(store.currentPage + 1)"
        >Next →</button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useIncidentsStore } from '@/store/incidents';
import IncidentCard from '@/components/IncidentCard.vue';

const store = useIncidentsStore();
const router = useRouter();

const manualUuid = ref('');
const triggering = ref(false);
const triggerError = ref('');
const triggerSuccess = ref('');
const activeFilter = ref('all');

const filterTabs = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Awaiting Approval', value: 'WAITING_APPROVAL' },
  { label: 'VIP', value: 'vip' },
];

const filteredIncidents = computed(() => {
  if (activeFilter.value === 'all') return store.incidents;
  if (activeFilter.value === 'active') return store.activeIncidents;
  if (activeFilter.value === 'vip') return store.vipIncidents;
  return store.incidents.filter((i) => i.state === activeFilter.value);
});

const waitingApprovals = computed(
  () => store.incidents.filter((i) => i.state === 'WAITING_APPROVAL').length,
);

const totalPages = computed(() => Math.ceil(store.total / 20));

function setFilter(value: string): void {
  activeFilter.value = value;
  if (!['all', 'active', 'vip'].includes(value)) {
    store.fetchIncidents(1, value);
  } else {
    store.fetchIncidents(1);
  }
}

function loadPage(page: number): void {
  store.fetchIncidents(page);
}

function goToDetail(id: string): void {
  router.push({ name: 'incident-detail', params: { id } });
}

async function triggerManual(): Promise<void> {
  triggerError.value = '';
  triggerSuccess.value = '';
  if (!manualUuid.value.trim()) return;
  triggering.value = true;
  try {
    const id = await store.triggerManualAlarm(manualUuid.value.trim(), 'Support');
    triggerSuccess.value = id;
    manualUuid.value = '';
    setTimeout(() => (triggerSuccess.value = ''), 5000);
  } catch (err) {
    triggerError.value = (err as Error).message;
  } finally {
    triggering.value = false;
  }
}

let pollInterval: ReturnType<typeof setInterval>;

onMounted(() => {
  store.fetchIncidents();
  // Re-fetch full list every 10s so new incidents (any state) appear automatically
  pollInterval = setInterval(() => store.fetchIncidents(store.currentPage), 10_000);
});

onUnmounted(() => clearInterval(pollInterval));
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; min-height: 100vh; background: #0a0d11; }

.topbar {
  height: 52px; background: #111318; border-bottom: 1px solid #252b36;
  display: flex; align-items: center; padding: 0 20px; gap: 16px; flex-shrink: 0;
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

.topbar-right { margin-left: auto; }
.live-pill {
  display: flex; align-items: center; gap: 5px;
  background: rgba(63,185,80,.1); border: 1px solid rgba(63,185,80,.25);
  padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 600; color: #3fb950;
}
.live-dot {
  width: 5px; height: 5px; border-radius: 50%; background: #3fb950;
  animation: pulse 1.5s ease-in-out infinite;
}

.manual-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 20px; background: #0d1017; border-bottom: 1px solid #1e2330;
}
.uuid-input {
  flex: 1; max-width: 400px;
  background: #111318; border: 1px solid #252b36; border-radius: 6px;
  color: #edf2f7; padding: 7px 12px; font-size: 12px; font-family: monospace;
  outline: none;
}
.uuid-input:focus { border-color: #4d9de0; }
.btn-primary {
  background: #4d9de0; color: #000; border: none; border-radius: 6px;
  padding: 7px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .15s;
}
.btn-primary:hover { background: #60b0f0; }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.trigger-error { font-size: 11px; color: #f85149; }
.trigger-success { font-size: 11px; color: #3fb950; font-family: monospace; }

.incidents-area { flex: 1; padding: 16px 20px; }

.list-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.list-title { font-size: 15px; font-weight: 600; }
.list-sub { font-size: 11px; color: #4f5b6e; margin-top: 2px; }
.filter-tabs { display: flex; gap: 6px; }
.filter-tab {
  padding: 5px 12px; border-radius: 20px; border: 1px solid #252b36;
  background: transparent; color: #8896aa; font-size: 11px; font-weight: 500; cursor: pointer;
  transition: all .15s;
}
.filter-tab:hover, .filter-tab.active {
  background: #4d9de0; border-color: #4d9de0; color: #000;
}

.incidents-list { display: flex; flex-direction: column; gap: 8px; }
.loading-msg, .empty-msg { padding: 40px; text-align: center; color: #4f5b6e; }
.error-msg { padding: 40px; text-align: center; color: #f85149; }

.pagination { display: flex; align-items: center; gap: 12px; margin-top: 16px; justify-content: center; }
.page-btn {
  background: #111318; border: 1px solid #252b36; color: #8896aa;
  padding: 5px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
}
.page-btn:disabled { opacity: .4; cursor: not-allowed; }
.page-info { font-size: 12px; color: #4f5b6e; font-family: monospace; }
</style>
