<template>
  <div class="dashboard">
    <!-- Body: sidebar + content -->
    <div class="body-area">
      <!-- Left Sidebar -->
      <nav class="sidebar">
        <button
          class="nav-item"
          :class="{ active: currentView === 'active' }"
          @click="currentView = 'active'"
        >
          <span class="nav-icon">⚡</span>
          <span class="nav-label">Active Alarms</span>
          <span v-if="store.activeIncidents.length > 0" class="nav-badge red">
            {{ store.activeIncidents.length }}
          </span>
        </button>

        <button
          class="nav-item"
          :class="{ active: currentView === 'history' }"
          @click="currentView = 'history'"
        >
          <span class="nav-icon">🕐</span>
          <span class="nav-label">Alarm History</span>
          <span v-if="store.deduplicatedHistory.length > 0" class="nav-badge gray">
            {{ store.deduplicatedHistory.length }}
          </span>
        </button>
      </nav>

      <!-- Main content -->
      <main class="main-content">
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

        <!-- Active Alarms view -->
        <div v-if="currentView === 'active'" class="incidents-area">
          <div class="list-header">
            <div>
              <h2 class="list-title">Active Alarms</h2>
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

          <div v-if="store.loading" class="loading-msg">Loading...</div>
          <div v-else-if="store.error" class="error-msg">{{ store.error }}</div>
          <div v-else-if="filteredIncidents.length === 0" class="empty-msg">No active alarms.</div>

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
        </div>

        <!-- Alarm History view -->
        <div v-else class="incidents-area">
          <div class="list-header">
            <div>
              <h2 class="list-title">Alarm History</h2>
              <p class="list-sub">Alarms that disappeared from previous polls · most recent first</p>
            </div>
          </div>

          <div v-if="store.deduplicatedHistory.length === 0" class="empty-msg">
            No alarm history yet. History builds as alarms resolve or disappear during polling.
          </div>

          <div v-else class="incidents-list">
            <IncidentCard
              v-for="incident in store.deduplicatedHistory"
              :key="incident._id"
              :incident="incident"
              @click="goToDetail(incident._id)"
            />
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useIncidentsStore } from '@/store/incidents';
import IncidentCard from '@/components/IncidentCard.vue';

const store = useIncidentsStore();
const router = useRouter();

const vipIncidents = computed(() =>
  store.activeIncidents.filter((i) => i.isVip),
);

const manualUuid = ref('');
const triggering = ref(false);
const triggerError = ref('');
const triggerSuccess = ref('');
const activeFilter = ref('all');
const currentView = ref<'active' | 'history'>('active');

const filterTabs = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Awaiting Approval', value: 'WAITING_APPROVAL' },
  { label: 'Prioritized', value: 'vip' },
];

const filteredIncidents = computed(() => {
  if (activeFilter.value === 'all') return store.activeIncidents;
  if (activeFilter.value === 'active') return store.activeIncidents;
  if (activeFilter.value === 'vip') return vipIncidents.value;
  return store.activeIncidents.filter((i) => i.state === activeFilter.value);
});

const totalPages = computed(() => Math.ceil(store.total / 20));

function setFilter(value: string): void {
  activeFilter.value = value;
}

function loadPage(page: number): void {
  store.pollActiveIncidents();
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

onMounted(() => {
  // Refresh active-only data when the view mounts (e.g. user navigates back).
  // Never call fetchIncidents() here — that loads all states (including CLOSED)
  // and causes terminal-state incidents to flash in the active alarm list.
  store.pollActiveIncidents();
});
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; height: 100%; background: var(--bg-base); }

/* ── Body layout ─────────────────────────────────────────── */
.body-area { display: flex; flex: 1; overflow: hidden; height: 100%; }

/* ── Sidebar ─────────────────────────────────────────────── */
.sidebar {
  width: 200px; flex-shrink: 0;
  background: var(--bg-deep); border-right: 1px solid var(--bd-sub);
  display: flex; flex-direction: column;
  padding: 12px 8px; gap: 4px;
}

.nav-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 10px; border-radius: 6px;
  background: transparent; border: none; cursor: pointer;
  color: var(--tx-2); font-size: 12px; font-weight: 500;
  text-align: left; transition: background .15s, color .15s;
}
.nav-item:hover { background: var(--bg-card); color: var(--tx-1); }
.nav-item.active { background: var(--bd-faint); color: var(--tx-1); }

.nav-icon { font-size: 13px; flex-shrink: 0; }
.nav-label { flex: 1; }
.nav-badge {
  font-size: 10px; font-weight: 700; padding: 1px 6px;
  border-radius: 10px; flex-shrink: 0;
}
.nav-badge.red { background: rgba(248,81,73,.2); color: var(--col-err); }
.nav-badge.gray { background: var(--bd-sub); color: var(--tx-3); }

/* ── Main content ────────────────────────────────────────── */
.main-content { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }

.manual-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 20px; background: var(--bg-deep); border-bottom: 1px solid var(--bd-sub);
  flex-shrink: 0;
}
.uuid-input {
  flex: 1; max-width: 400px;
  background: var(--bg-card); border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-1); padding: 7px 12px; font-size: 12px; font-family: monospace;
  outline: none;
}
.uuid-input:focus { border-color: var(--accent); }
.btn-primary {
  background: var(--accent); color: #000; border: none; border-radius: 6px;
  padding: 7px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .15s;
}
.btn-primary:hover { background: #60b0f0; }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.trigger-error { font-size: 11px; color: var(--col-err); }
.trigger-success { font-size: 11px; color: var(--col-ok); font-family: monospace; }

.incidents-area { flex: 1; padding: 16px 20px; }

.list-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.list-title { font-size: 15px; font-weight: 600; }
.list-sub { font-size: 11px; color: var(--tx-3); margin-top: 2px; }
.filter-tabs { display: flex; gap: 6px; }
.filter-tab {
  padding: 5px 12px; border-radius: 20px; border: 1px solid var(--bd);
  background: transparent; color: var(--tx-2); font-size: 11px; font-weight: 500; cursor: pointer;
  transition: all .15s;
}
.filter-tab:hover, .filter-tab.active {
  background: var(--accent); border-color: var(--accent); color: #000;
}

.incidents-list { display: flex; flex-direction: column; gap: 8px; }
.loading-msg, .empty-msg { padding: 40px; text-align: center; color: var(--tx-3); }
.error-msg { padding: 40px; text-align: center; color: var(--col-err); }

.pagination { display: flex; align-items: center; gap: 12px; margin-top: 16px; justify-content: center; }
.page-btn {
  background: var(--bg-card); border: 1px solid var(--bd); color: var(--tx-2);
  padding: 5px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
}
.page-btn:disabled { opacity: .4; cursor: not-allowed; }
.page-info { font-size: 12px; color: var(--tx-3); font-family: monospace; }
</style>
