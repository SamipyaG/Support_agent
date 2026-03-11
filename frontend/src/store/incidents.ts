import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/api/axios';
import { useNotificationsStore } from '@/store/notifications';

export interface Incident {
  _id: string;
  dsUuid: string;
  channelName: string;
  clusterId: string;
  redisInstance: string;
  streamType: 'HLS' | 'DASH';
  isVip: boolean;
  customerId: string;
  state: string;
  confidenceScore: number;
  recommendedAction: string;
  explanation: string;
  errorCode: string;
  jiraTicketKey: string;
  reportedBy: string;
  restartAttempts: number;
  maxRestartAttempts: number;
  statusLabel?: string;
  gManaPlayerUrl: string;
  sourcePlayerUrl: string;
  streamAnalysis: Record<string, unknown>;
  resourceAnalysis: Record<string, unknown>;
  playerAnalysis: Record<string, unknown>;
  actionHistory: Array<{
    action: string;
    executedAt: string;
    result: string;
    approvedBy?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface IncidentDetail extends Incident {
  actions: ActionLog[];
  approvals: Approval[];
  escalations: EscalationLog[];
}

export interface ActionLog {
  _id: string;
  action: string;
  status: string;
  durationMs: number;
  executedBy: string;
  createdAt: string;
}

export interface Approval {
  _id: string;
  proposedAction: string;
  decision: string;
  decidedBy?: string;
  timeoutSeconds: number;
  autoExecuted: boolean;
  createdAt: string;
}

export interface EscalationLog {
  _id: string;
  reason: string;
  escalatedTo: string;
  channels: string[];
  createdAt: string;
}

// Higher number = shown when duplicates exist for the same dsUuid
const STATE_PRIORITY: Record<string, number> = {
  WAITING_APPROVAL: 6,
  EXECUTING_ACTION: 5,
  MONITORING:       4,
  ANALYZING:        3,
  ESCALATED:        2,
  NEW:              1,
  RESOLVED:         0,
  CLOSED:           0,
  FAILED:           0,
};

function deduplicateByUuid(list: Incident[]): Incident[] {
  const map = new Map<string, Incident>();
  for (const inc of list) {
    const existing = map.get(inc.dsUuid);
    if (!existing) {
      map.set(inc.dsUuid, inc);
    } else {
      const ep = STATE_PRIORITY[existing.state] ?? 0;
      const np = STATE_PRIORITY[inc.state]    ?? 0;
      if (np > ep || (np === ep && inc.updatedAt > existing.updatedAt)) {
        map.set(inc.dsUuid, inc);
      }
    }
  }
  return Array.from(map.values());
}

export const useIncidentsStore = defineStore('incidents', () => {
  const incidents = ref<Incident[]>([]);
  const alarmHistory = ref<Incident[]>([]);
  const selectedIncident = ref<IncidentDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const total = ref(0);
  const currentPage = ref(1);
  const pendingApprovalId = ref<string | null>(null);

  const TERMINAL_STATES = ['RESOLVED', 'CLOSED', 'FAILED'];
  const hasInitialized = ref(false);

  // One card per dsUuid — highest-priority state wins
  const deduplicatedIncidents = computed(() => deduplicateByUuid(incidents.value));
  const deduplicatedHistory   = computed(() => deduplicateByUuid(alarmHistory.value));

  const activeIncidents = computed(() =>
    deduplicatedIncidents.value.filter((i) => !TERMINAL_STATES.includes(i.state)),
  );

  const vipIncidents = computed(() => deduplicatedIncidents.value.filter((i) => i.isVip));

  async function fetchIncidents(page = 1, state?: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, unknown> = { page, limit: 20 };
      if (state) params.state = state;
      const res = await api.get('/incidents', { params });
      incidents.value = res.data.incidents;
      total.value = res.data.total;
      currentPage.value = page;
      hasInitialized.value = true;
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function fetchIncidentById(id: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get(`/incidents/${id}`);
      selectedIncident.value = {
        ...res.data.incident,
        actions: res.data.actions,
        approvals: res.data.approvals,
        escalations: res.data.escalations,
      };
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function submitApproval(incidentId: string, decision: 'approved' | 'rejected', decidedBy = 'support-team'): Promise<void> {
    await api.post(`/approve/${incidentId}`, { decision, decidedBy });
    pendingApprovalId.value = null;
    await fetchIncidentById(incidentId);
  }

  async function triggerManualAlarm(dsUuid: string, reportedBy: 'Support' | 'WhatsApp' | 'Email'): Promise<string> {
    const res = await api.post('/alarms/manual', { dsUuid, reportedBy });
    await fetchIncidents();
    return res.data.incidentId;
  }

  /**
   * Called every 20 seconds.
   * - Existing alarm  → keep (update in-place)
   * - New alarm       → add to activeAlarms + notify
   * - Missing alarm   → move to alarmHistory
   */
  async function pollActiveIncidents(): Promise<void> {
    try {
      const res = await api.get('/incidents/filter/active');
      const fetched: Incident[] = res.data.incidents;
      const fetchedIds = new Set(fetched.map((i) => i._id));
      const historyIds = new Set(alarmHistory.value.map((i) => i._id));

      // 1. Move disappeared alarms to history
      incidents.value.forEach((existing) => {
        if (!fetchedIds.has(existing._id) && !historyIds.has(existing._id)) {
          alarmHistory.value.unshift(existing);
        }
      });

      // 2. Notify on new alarms (only after first successful poll)
      if (hasInitialized.value) {
        const notifications = useNotificationsStore();
        const knownIds = new Set(incidents.value.map((i) => i._id));
        fetched.forEach((inc) => {
          if (!knownIds.has(inc._id)) {
            notifications.push({
              id: inc._id,
              channelName: inc.channelName,
              state: inc.state,
              createdAt: inc.createdAt,
              isVip: inc.isVip,
            });
          }
        });
      }

      // 3. Replace activeAlarms with the latest API response
      incidents.value = fetched;
      hasInitialized.value = true;

      // 4. Track pending approvals
      const waiting = fetched.find((i) => i.state === 'WAITING_APPROVAL');
      pendingApprovalId.value = waiting?._id ?? null;
    } catch {
      // Silent — keep stale data on network error
    }
  }

  function clearSelected(): void {
    selectedIncident.value = null;
  }

  return {
    incidents,
    alarmHistory,
    selectedIncident,
    loading,
    error,
    total,
    currentPage,
    pendingApprovalId,
    activeIncidents,
    vipIncidents,
    deduplicatedIncidents,
    deduplicatedHistory,
    fetchIncidents,
    fetchIncidentById,
    submitApproval,
    triggerManualAlarm,
    pollActiveIncidents,
    clearSelected,
  };
});
