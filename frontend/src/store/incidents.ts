import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/api/axios';

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

export const useIncidentsStore = defineStore('incidents', () => {
  const incidents = ref<Incident[]>([]);
  const alarmHistory = ref<Incident[]>([]);
  const trackedActiveIds = ref<Set<string>>(new Set());
  const selectedIncident = ref<IncidentDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const total = ref(0);
  const currentPage = ref(1);
  const pendingApprovalId = ref<string | null>(null);

  const TERMINAL_STATES = ['RESOLVED', 'CLOSED', 'FAILED'];

  const activeIncidents = computed(() =>
    incidents.value.filter((i) => !TERMINAL_STATES.includes(i.state)),
  );

  const vipIncidents = computed(() => incidents.value.filter((i) => i.isVip));

  /** Detect alarms that vanished from the active list and move them to history. */
  function _syncHistory(newIncidents: Incident[]): void {
    const newIds = new Set(newIncidents.map((i) => i._id));
    const historyIds = new Set(alarmHistory.value.map((i) => i._id));

    trackedActiveIds.value.forEach((id) => {
      if (!newIds.has(id) && !historyIds.has(id)) {
        // Was active last poll, no longer in response — move to history
        const gone = incidents.value.find((i) => i._id === id);
        if (gone) alarmHistory.value.unshift(gone);
      }
    });

    // Update tracked set to current non-terminal incidents
    trackedActiveIds.value = new Set(
      newIncidents.filter((i) => !TERMINAL_STATES.includes(i.state)).map((i) => i._id),
    );
  }

  async function fetchIncidents(page = 1, state?: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, unknown> = { page, limit: 20 };
      if (state) params.state = state;
      const res = await api.get('/incidents', { params });
      const newList: Incident[] = res.data.incidents;
      _syncHistory(newList);
      incidents.value = newList;
      total.value = res.data.total;
      currentPage.value = page;
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

  async function pollActiveIncidents(): Promise<void> {
    const res = await api.get('/incidents/filter/active');
    const active: Incident[] = res.data.incidents;

    // Update existing or add new
    active.forEach((updated) => {
      const idx = incidents.value.findIndex((i) => i._id === updated._id);
      if (idx >= 0) {
        incidents.value[idx] = updated;
      } else {
        incidents.value.unshift(updated);
      }
    });

    // Check for pending approvals
    const waiting = active.find((i) => i.state === 'WAITING_APPROVAL');
    pendingApprovalId.value = waiting?._id || null;
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
    fetchIncidents,
    fetchIncidentById,
    submitApproval,
    triggerManualAlarm,
    pollActiveIncidents,
    clearSelected,
  };
});
