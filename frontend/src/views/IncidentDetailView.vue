<template>
  <div class="detail-view">
    <!-- Back -->
    <header class="detail-header">
      <button class="back-btn" @click="$router.back()">← Back</button>
      <div v-if="store.selectedIncident" class="detail-title-group">
        <span class="detail-channel">{{ store.selectedIncident.channelName }}</span>
        <span v-if="store.selectedIncident.isVip" class="badge vip-badge">VIP</span>
        <span class="badge state-badge" :class="`state-${store.selectedIncident.state.toLowerCase()}`">
          {{ store.selectedIncident.state.replace(/_/g, ' ') }}
        </span>
      </div>
      <button class="btn-refresh" @click="refresh">↻ Refresh</button>
    </header>

    <div v-if="store.loading" class="loading-msg">Loading...</div>
    <div v-else-if="store.error" class="error-msg">{{ store.error }}</div>

    <div v-else-if="store.selectedIncident" class="detail-body">
      <!-- Approval timer (if waiting) -->
      <ApprovalTimer
        v-if="store.selectedIncident.state === 'WAITING_APPROVAL'"
        :incident-id="store.selectedIncident._id"
        :proposed-action="store.selectedIncident.recommendedAction"
        :explanation="store.selectedIncident.explanation"
        :timeout-seconds="approvalTimeout"
        @approve="handleApprove"
        @reject="handleReject"
      />

      <!-- Incident overview -->
      <div class="detail-grid">
        <!-- Left: info + players -->
        <div class="detail-left">
          <!-- Metadata card -->
          <div class="info-card">
            <div class="info-title">Incident Details</div>
            <div class="info-grid">
              <span class="info-key">UUID</span><span class="info-val mono">{{ store.selectedIncident.dsUuid }}</span>
              <span class="info-key">Cluster</span><span class="info-val mono">{{ store.selectedIncident.clusterId }}</span>
              <span class="info-key">Redis</span><span class="info-val mono">{{ store.selectedIncident.redisInstance }}</span>
              <span class="info-key">Stream</span><span class="info-val mono">{{ store.selectedIncident.streamType }}</span>
              <span class="info-key">Reported</span><span class="info-val">{{ store.selectedIncident.reportedBy }}</span>
              <span class="info-key">Error</span><span class="info-val mono error-code">{{ store.selectedIncident.errorCode || '—' }}</span>
              <span class="info-key">Jira</span>
              <span class="info-val">
                <a v-if="store.selectedIncident.jiraTicketKey" :href="jiraUrl" target="_blank" class="jira-link">
                  {{ store.selectedIncident.jiraTicketKey }}
                </a>
                <span v-else class="dim">—</span>
              </span>
              <span class="info-key">Restarts</span>
              <span class="info-val mono" :class="{ 'warn': store.selectedIncident.restartAttempts > 0 }">
                {{ store.selectedIncident.restartAttempts }} / {{ store.selectedIncident.maxRestartAttempts }}
              </span>
            </div>
          </div>

          <!-- Analysis (internal only) -->

          <!-- Stream Players — embedded side by side -->
          <div class="info-card">
            <div class="info-title">Stream Players</div>
            <div class="players-grid">
              <div class="player-embed">
                <div class="player-embed-label source">Source</div>
                <iframe
                  v-if="sourceEmbedUrl"
                  :src="sourceEmbedUrl"
                  class="player-iframe"
                  allowfullscreen
                  allow="autoplay"
                ></iframe>
                <div v-else class="player-no-url">No source URL</div>
                <span class="player-url-small">{{ store.selectedIncident.sourcePlayerUrl || '' }}</span>
              </div>
              <div class="player-embed">
                <div class="player-embed-label gmana">G-Mana</div>
                <iframe
                  v-if="gmanaEmbedUrl"
                  :src="gmanaEmbedUrl"
                  class="player-iframe"
                  allowfullscreen
                  allow="autoplay"
                ></iframe>
                <div v-else class="player-no-url">No G-Mana URL</div>
                <span class="player-url-small">{{ store.selectedIncident.gManaPlayerUrl || '' }}</span>
              </div>
            </div>
          </div>

          <!-- Draft message -->
          <div class="info-card">
            <div class="info-title">Draft Customer Message</div>
            <textarea class="draft-textarea" v-model="draftMessage" rows="4" placeholder="Edit draft message before sending..."></textarea>
            <div class="draft-actions">
              <button class="btn-secondary" @click="sendDraftEmail">📧 Send Email</button>
              <button class="btn-secondary" @click="sendDraftWhatsApp">💬 Send WhatsApp</button>
            </div>
          </div>
        </div>

        <!-- Right: timeline + logs -->
        <div class="detail-right">
          <!-- Timeline -->
          <div class="info-card">
            <div class="info-title">Timeline</div>
            <div class="timeline">
              <TimelineItem
                :label="`Incident Created`"
                :description="`Alarm triggered via ${store.selectedIncident.reportedBy}`"
                :timestamp="store.selectedIncident.createdAt"
                type="state"
                :isLast="timelineItems.length === 0"
              />
              <TimelineItem
                v-for="(item, i) in timelineItems"
                :key="i"
                :label="item.label"
                :description="item.description"
                :timestamp="item.timestamp"
                :type="item.type"
                :extra="item.extra"
                :isLast="i === timelineItems.length - 1"
              />
            </div>
          </div>

          <!-- Approvals -->
          <div v-if="store.selectedIncident.approvals?.length" class="info-card">
            <div class="info-title">Approval History</div>
            <div v-for="appr in store.selectedIncident.approvals" :key="appr._id" class="approval-row">
              <span class="appr-action mono">{{ appr.proposedAction }}</span>
              <span class="appr-decision" :class="`appr-${appr.decision}`">{{ appr.decision.toUpperCase() }}</span>
              <span class="appr-by dim">{{ appr.decidedBy || (appr.autoExecuted ? 'auto' : 'pending') }}</span>
              <span class="appr-time dim mono">{{ formatTime(appr.createdAt) }}</span>
            </div>
          </div>

          <!-- Escalations -->
          <div v-if="store.selectedIncident.escalations?.length" class="info-card">
            <div class="info-title">Escalations</div>
            <div v-for="esc in store.selectedIncident.escalations" :key="esc._id" class="esc-row">
              <span class="esc-reason">{{ esc.reason }}</span>
              <span class="esc-to dim">→ {{ esc.escalatedTo }}</span>
              <span class="esc-time dim mono">{{ formatTime(esc.createdAt) }}</span>
            </div>
          </div>

          <!-- Action logs -->
          <div v-if="store.selectedIncident.actions?.length" class="info-card">
            <div class="info-title">Action Logs</div>
            <div v-for="log in store.selectedIncident.actions" :key="log._id" class="log-row">
              <span class="log-status-dot" :class="log.status === 'success' ? 'dot-green' : 'dot-red'"></span>
              <span class="log-action mono">{{ log.action }}</span>
              <span class="log-dur dim">{{ log.durationMs }}ms</span>
              <span class="log-by dim">{{ log.executedBy }}</span>
              <span class="log-time dim mono">{{ formatTime(log.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useIncidentsStore } from '@/store/incidents';
import ApprovalTimer from '@/components/ApprovalTimer.vue';
import TimelineItem from '@/components/TimelineItem.vue';

const route = useRoute();
const store = useIncidentsStore();

const draftMessage = ref('');
const approvalTimeout = ref(parseInt(import.meta.env.VITE_APPROVAL_TIMEOUT || '10', 10));

const jiraUrl = computed(() =>
  store.selectedIncident?.jiraTicketKey
    ? `${import.meta.env.VITE_JIRA_BASE_URL}/browse/${store.selectedIncident.jiraTicketKey}`
    : '#',
);

const PLAYER_BASE = 'https://automation-8museubsm-samipya-ghimires-projects.vercel.app/';

const sourceEmbedUrl = computed(() => {
  const url = store.selectedIncident?.sourcePlayerUrl;
  if (!url) return '';
  return `${PLAYER_BASE}?url=${encodeURIComponent(url)}`;
});

const gmanaEmbedUrl = computed(() => {
  const url = store.selectedIncident?.gManaPlayerUrl;
  if (!url) return '';
  return `${PLAYER_BASE}?url=${encodeURIComponent(url)}`;
});

const confClass = computed(() => {
  const s = store.selectedIncident?.confidenceScore || 0;
  if (s >= 85) return 'conf-high';
  if (s >= 70) return 'conf-med';
  return 'conf-low';
});

const timelineItems = computed(() => {
  if (!store.selectedIncident) return [];
  const items: Array<{ label: string; description: string; timestamp: string; type: 'action' | 'state' | 'approval' | 'escalation' | 'info'; extra?: string }> = [];

  store.selectedIncident.actionHistory?.forEach((a) => {
    items.push({
      label: a.action.replace(/_/g, ' '),
      description: a.result,
      timestamp: a.executedAt,
      type: 'action',
      extra: a.approvedBy ? `Approved by: ${a.approvedBy}` : undefined,
    });
  });

  store.selectedIncident.escalations?.forEach((e) => {
    items.push({
      label: 'Escalation',
      description: e.reason,
      timestamp: e.createdAt,
      type: 'escalation',
      extra: `Escalated to: ${e.escalatedTo}`,
    });
  });

  if (store.selectedIncident.resolvedAt) {
    items.push({
      label: 'Resolved',
      description: 'Incident resolved — stream healthy',
      timestamp: store.selectedIncident.resolvedAt,
      type: 'state',
    });
  }

  return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
});

async function handleApprove(incidentId: string): Promise<void> {
  await store.submitApproval(incidentId, 'approved');
}

async function handleReject(incidentId: string): Promise<void> {
  await store.submitApproval(incidentId, 'rejected');
}

async function refresh(): Promise<void> {
  await store.fetchIncidentById(route.params.id as string);
  if (store.selectedIncident) {
    if (store.selectedIncident.errorCode === 'SOURCE_DOWN') {
      draftMessage.value = `Hi, The source is down for the channel ${store.selectedIncident.channelName}, can you please check?`;
    } else {
      draftMessage.value = `Hi, we are currently investigating an issue with ${store.selectedIncident.channelName}. Our automated system has detected ${store.selectedIncident.errorCode || 'a stream issue'} and is taking corrective action. We will update you shortly.`;
    }
  }
}

function sendDraftEmail(): void {
  alert(`Email draft sent:\n\n${draftMessage.value}`);
}

function sendDraftWhatsApp(): void {
  alert(`WhatsApp draft sent:\n\n${draftMessage.value}`);
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

onMounted(() => refresh());
</script>

<style scoped>
.detail-view { min-height: 100vh; background: #0a0d11; }

.detail-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 20px; background: #111318; border-bottom: 1px solid #252b36;
}
.back-btn { background: transparent; border: 1px solid #252b36; color: #8896aa; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.back-btn:hover { border-color: #4d9de0; color: #4d9de0; }
.detail-title-group { display: flex; align-items: center; gap: 8px; }
.detail-channel { font-size: 15px; font-weight: 600; }
.btn-refresh { margin-left: auto; background: transparent; border: 1px solid #252b36; color: #8896aa; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.btn-refresh:hover { background: #111318; }

.badge { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: .06em; }
.vip-badge { background: rgba(248,81,73,.15); color: #f85149; border: 1px solid rgba(248,81,73,.3); }
.state-badge { background: #1e2330; color: #8896aa; }
.state-resolved, .state-closed { color: #3fb950; }
.state-escalated, .state-failed { color: #f85149; }
.state-waiting_approval { color: #e3a23a; }

.loading-msg, .error-msg { padding: 40px; text-align: center; color: #4f5b6e; }
.error-msg { color: #f85149; }

.detail-body { padding: 16px 20px; }

.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }

.detail-left, .detail-right { display: flex; flex-direction: column; gap: 12px; }

.info-card {
  background: #111318; border: 1px solid #252b36; border-radius: 8px; padding: 14px;
}
.info-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #4f5b6e; margin-bottom: 12px; }

.info-grid { display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px; align-items: start; }
.info-key { font-size: 11px; color: #4f5b6e; }
.info-val { font-size: 12px; }
.mono { font-family: monospace; }
.error-code { color: #f85149; }
.warn { color: #e3a23a; }
.dim { color: #4f5b6e; }
.jira-link { color: #4d9de0; }

.confidence-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.conf-label { font-size: 11px; color: #4f5b6e; }
.conf-val { font-family: monospace; font-size: 14px; font-weight: 700; width: 50px; text-align: right; }
.conf-high { color: #3fb950; }
.conf-med  { color: #e3a23a; }
.conf-low  { color: #f85149; }
.conf-bar-bg { flex: 1; height: 4px; background: #252b36; border-radius: 2px; overflow: hidden; }
.conf-bar-fill { height: 100%; border-radius: 2px; transition: width .5s; }
.conf-bar-fill.conf-high { background: #3fb950; }
.conf-bar-fill.conf-med  { background: #e3a23a; }
.conf-bar-fill.conf-low  { background: #f85149; }

.action-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.action-key { font-size: 11px; color: #4f5b6e; }
.action-val { font-size: 12px; font-weight: 600; color: #4d9de0; }
.explanation-text { font-size: 11px; color: #8896aa; line-height: 1.55; }

.players-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 700px) { .players-grid { grid-template-columns: 1fr; } }
.player-embed { display: flex; flex-direction: column; gap: 5px; }
.player-embed-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.player-embed-label.gmana { color: #4d9de0; }
.player-embed-label.source { color: #e3a23a; }
.player-iframe { width: 100%; height: 180px; border: 1px solid #252b36; border-radius: 6px; background: #0d1017; }
.player-no-url { height: 180px; display: flex; align-items: center; justify-content: center; border: 1px solid #252b36; border-radius: 6px; color: #4f5b6e; font-size: 11px; }
.player-url-small { font-family: monospace; font-size: 9px; color: #2e3545; word-break: break-all; }

.draft-textarea {
  width: 100%; background: #0d1017; border: 1px solid #252b36; border-radius: 6px;
  color: #edf2f7; padding: 8px; font-size: 12px; font-family: inherit;
  resize: vertical; outline: none; line-height: 1.55;
}
.draft-textarea:focus { border-color: #4d9de0; }
.draft-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn-secondary {
  flex: 1; background: #1e2330; border: 1px solid #252b36; color: #8896aa;
  padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px;
  transition: all .15s;
}
.btn-secondary:hover { background: #252b36; color: #edf2f7; }

.timeline { display: flex; flex-direction: column; }

.approval-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #1e2330; }
.approval-row:last-child { border-bottom: none; }
.appr-action { font-size: 11px; flex: 1; }
.appr-decision { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
.appr-approved { background: rgba(63,185,80,.15); color: #3fb950; }
.appr-rejected { background: rgba(248,81,73,.15); color: #f85149; }
.appr-timeout  { background: rgba(227,162,58,.15); color: #e3a23a; }
.appr-pending  { background: #1e2330; color: #4f5b6e; }
.appr-by, .appr-time { font-size: 10px; }

.esc-row { display: flex; gap: 10px; align-items: center; padding: 5px 0; border-bottom: 1px solid #1e2330; }
.esc-row:last-child { border-bottom: none; }
.esc-reason { font-size: 11px; flex: 1; }
.esc-to, .esc-time { font-size: 10px; }

.log-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #1e2330; }
.log-row:last-child { border-bottom: none; }
.log-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #3fb950; }
.dot-red   { background: #f85149; }
.log-action { font-size: 11px; flex: 1; }
.log-dur, .log-by, .log-time { font-size: 10px; }
</style>
