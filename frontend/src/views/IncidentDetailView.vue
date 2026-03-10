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
      <!-- Redis health button (top-right, near refresh) -->
      <div v-if="store.selectedIncident" class="hdr-redis-wrap" ref="redisWrapRef">
        <button
          class="hdr-redis-btn"
          :class="[{ active: showRedisPanel }, redisInstance ? redisStatusClass : (redisStore.loading ? '' : 'status-unknown')]"
          @click="toggleRedisPanel"
        >
          <span class="hdr-redis-dot" :class="redisInstance ? redisStatusClass : 'status-unknown'"></span>
          Redis
          <span class="hdr-redis-name mono">{{ store.selectedIncident.redisInstance || '—' }}</span>
          <span class="hdr-redis-chevron" :class="{ rotated: showRedisPanel }">▾</span>
        </button>

        <!-- Dropdown panel anchored to the button -->
        <div v-if="showRedisPanel" class="hdr-ri-dropdown">
          <div class="hdr-ri-header">
            <span class="hdr-ri-title">Redis · {{ store.selectedIncident.redisInstance || '—' }}</span>
            <span class="hdr-ri-cluster dim mono">{{ store.selectedIncident.clusterId }}</span>
          </div>
          <div v-if="redisStore.loading" class="ri-loading">
            <span class="ri-loading-dot"></span> Loading Redis data...
          </div>
          <div v-else-if="!redisInstance" class="ri-empty">
            <span>No data for <code class="ri-code">{{ store.selectedIncident.redisInstance || '?' }}</code></span>
            <button class="ri-reload" @click="redisStore.fetchRedis()">↻ Reload</button>
          </div>
          <template v-else>
            <div class="ri-head">
              <span class="ri-inst-name mono">{{ redisInstance.instanceName }}</span>
              <span class="ri-role-badge" :class="`ri-role-${(redisInstance.role || 'unknown').toLowerCase()}`">
                {{ redisInstance.role || 'unknown' }}
              </span>
              <span class="ri-status-badge" :class="redisStatusClass">{{ redisStatusLabel }}</span>
            </div>
            <div class="ri-metrics">
              <div class="ri-metric-row">
                <span class="ri-mkey">Memory Used</span>
                <span class="ri-mval mono" :class="memUsagePct >= 90 ? 'val-critical' : memUsagePct >= 70 ? 'val-warn' : 'val-ok'">
                  {{ redisInstance.usedMemory }}
                </span>
              </div>
              <div class="ri-metric-row">
                <span class="ri-mkey">Max Capacity</span>
                <span class="ri-mval mono">{{ redisInstance.maxMemory || '—' }}</span>
              </div>
              <div class="ri-metric-row">
                <span class="ri-mkey">Usage %</span>
                <span class="ri-mval mono" :class="memUsagePct >= 90 ? 'val-critical' : memUsagePct >= 70 ? 'val-warn' : 'val-ok'">
                  {{ memUsagePct }}%
                </span>
              </div>
              <div class="ri-bar-bg">
                <div class="ri-bar-fill" :class="redisStatusClass" :style="{ width: `${Math.min(memUsagePct, 100)}%` }"></div>
              </div>
            </div>
            <div class="ri-metrics ri-metrics-border">
              <div class="ri-metric-row">
                <span class="ri-mkey">CPU</span>
                <span class="ri-mval mono" :class="redisInstance.cpuUsagePercent > cpuThreshold ? 'val-warn' : 'val-ok'">
                  {{ redisInstance.cpuUsagePercent.toFixed(1) }}%
                  <span class="ri-thresh">/ {{ cpuThreshold }}%</span>
                </span>
              </div>
              <div class="ri-metric-row">
                <span class="ri-mkey">Connections</span>
                <span class="ri-mval mono" :class="redisInstance.connectedClients > connThreshold ? 'val-warn' : 'val-ok'">
                  {{ redisInstance.connectedClients }}
                  <span class="ri-thresh">/ {{ connThreshold }}</span>
                </span>
              </div>
              <div class="ri-metric-row">
                <span class="ri-mkey">Restarts</span>
                <span class="ri-mval mono" :class="redisInstance.restartCount >= restartThreshold ? 'val-warn' : 'val-ok'">
                  {{ redisInstance.restartCount }}
                  <span class="ri-thresh">/ {{ restartThreshold }}</span>
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <button class="btn-theme" @click="toggleTheme" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'">
        {{ isDark ? '☀' : '🌙' }}
      </button>
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
              <span class="info-key">Stream</span><span class="info-val mono">{{ store.selectedIncident.streamType }}</span>
              <span class="info-key">Reported</span><span class="info-val">{{ store.selectedIncident.reportedBy }}</span>
              <span class="info-key">Error</span><span class="info-val mono error-code">{{ store.selectedIncident.errorCode || '—' }}</span>
              <span class="info-key">Restarts</span>
              <span class="info-val mono" :class="{ 'warn': store.selectedIncident.restartAttempts > 0 }">
                {{ store.selectedIncident.restartAttempts }} / {{ store.selectedIncident.maxRestartAttempts }}
              </span>
            </div>
          </div>

          <!-- Stream Players — embedded side by side -->
          <div class="info-card">
            <div class="info-title">Stream Players</div>
            <div class="players-grid">
              <div class="player-embed">
                <div class="player-embed-label source">Source</div>
                <HlsPlayer v-if="store.selectedIncident.sourcePlayerUrl" :src="store.selectedIncident.sourcePlayerUrl" />
                <div v-else class="player-no-url">No source URL</div>
                <span class="player-url-small">{{ store.selectedIncident.sourcePlayerUrl || '' }}</span>
              </div>
              <div class="player-embed">
                <div class="player-embed-label gmana">G-Mana</div>
                <HlsPlayer v-if="store.selectedIncident.gManaPlayerUrl" :src="store.selectedIncident.gManaPlayerUrl" />
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

        <!-- Right: restart workflow + timeline + logs -->
        <div class="detail-right">
          <!-- Restart Workflow -->
          <RestartWorkflow
            v-if="!['RESOLVED', 'CLOSED', 'FAILED'].includes(store.selectedIncident.state)"
            :incident-id="store.selectedIncident._id"
            :ds-uuid="store.selectedIncident.dsUuid"
            :cluster-id="store.selectedIncident.clusterId"
          />

          <!-- Timeline Audit Table -->
          <div class="info-card">
            <div class="info-title">Incident Timeline</div>
            <div class="audit-wrap">
              <table class="audit-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Step</th>
                    <th>Trigger</th>
                    <th>Action</th>
                    <th>Details</th>
                    <th>Elapsed</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in auditRows" :key="i">
                    <td class="mono">{{ row.time }}</td>
                    <td><span class="step-badge" :class="`step-${row.step.toLowerCase()}`">{{ row.step }}</span></td>
                    <td><span class="trigger-badge" :class="`trig-${row.trigger.toLowerCase()}`">{{ row.trigger }}</span></td>
                    <td class="action-cell">{{ row.action }}</td>
                    <td class="details-cell">{{ row.details }}</td>
                    <td class="mono elapsed-cell">{{ row.elapsed }}</td>
                  </tr>
                  <!-- Duration summary row -->
                  <tr v-if="incidentDuration" class="summary-row">
                    <td colspan="4"><strong>Incident Duration</strong></td>
                    <td>From {{ formatTime(store.selectedIncident.createdAt) }} to {{ formatTime(store.selectedIncident.closedAt || store.selectedIncident.resolvedAt || new Date().toISOString()) }}</td>
                    <td class="mono"><strong>{{ incidentDuration }}</strong></td>
                  </tr>
                </tbody>
              </table>
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useIncidentsStore } from '@/store/incidents';
import { useRedisStore } from '@/store/redis';
import { useTheme } from '@/composables/useTheme';
import ApprovalTimer from '@/components/ApprovalTimer.vue';
import HlsPlayer from '@/components/HlsPlayer.vue';
import RestartWorkflow from '@/components/RestartWorkflow.vue';

const route = useRoute();
const store = useIncidentsStore();
const redisStore = useRedisStore();
const { isDark, toggle: toggleTheme } = useTheme();

const draftMessage = ref('');
const approvalTimeout = ref(parseInt(import.meta.env.VITE_APPROVAL_TIMEOUT || '10', 10));
const showRedisPanel = ref(false);
const redisWrapRef = ref<HTMLElement | null>(null);

function toggleRedisPanel(): void {
  showRedisPanel.value = !showRedisPanel.value;
  if (showRedisPanel.value && !redisStore.loading && redisStore.clusters.length === 0) {
    redisStore.fetchRedis();
  }
}

function onClickOutsideRedis(e: MouseEvent): void {
  if (redisWrapRef.value && !redisWrapRef.value.contains(e.target as Node)) {
    showRedisPanel.value = false;
  }
}

const redisCluster = computed(() =>
  redisStore.clusters.find((c) => c.clusterName === store.selectedIncident?.clusterId) ?? null,
);
const redisInstance = computed(() =>
  redisCluster.value?.instances.find((i) => i.instanceName === store.selectedIncident?.redisInstance) ?? null,
);
const cpuThreshold = computed(() => redisCluster.value?.thresholds.cpuThresholdPercent ?? 20);
const connThreshold = computed(() => redisCluster.value?.thresholds.connectionsThreshold ?? 4000);
const restartThreshold = computed(() => redisCluster.value?.thresholds.restartThreshold ?? 1);
const memUsagePct = computed((): number => {
  if (!redisInstance.value?.maxMemoryBytes) return 0;
  return Math.round((redisInstance.value.usedMemoryBytes / redisInstance.value.maxMemoryBytes) * 100);
});
const redisStatusClass = computed((): string => {
  if (!redisInstance.value?.isHealthy) return 'status-critical';
  if (memUsagePct.value >= 90) return 'status-critical';
  if (memUsagePct.value >= 70) return 'status-warning';
  return 'status-healthy';
});
const redisStatusLabel = computed((): string => {
  if (!redisInstance.value) return '';
  if (!redisInstance.value.isHealthy) return 'Unhealthy';
  if (memUsagePct.value >= 90) return 'Critical';
  if (memUsagePct.value >= 70) return 'Warning';
  return 'Healthy';
});

const jiraUrl = computed(() =>
  store.selectedIncident?.jiraTicketKey
    ? `${import.meta.env.VITE_JIRA_BASE_URL}/browse/${store.selectedIncident.jiraTicketKey}`
    : '#',
);

const confClass = computed(() => {
  const s = store.selectedIncident?.confidenceScore || 0;
  if (s >= 85) return 'conf-high';
  if (s >= 70) return 'conf-med';
  return 'conf-low';
});

interface AuditRow {
  time: string;
  step: string;
  trigger: 'System' | 'Agent' | 'Manual';
  action: string;
  details: string;
  elapsed: string;
  raw: number;
}

function formatElapsed(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

function deriveTrigger(approvedBy: string, action: string): 'System' | 'Agent' | 'Manual' {
  if (approvedBy === 'Manual') return 'Manual';
  if (approvedBy === 'auto' || approvedBy === 'system') return action === 'ESCALATE' ? 'Agent' : 'System';
  if (approvedBy && approvedBy.length > 0) return 'Manual';
  return 'Agent';
}

const auditRows = computed((): AuditRow[] => {
  if (!store.selectedIncident) return [];
  const inc = store.selectedIncident;
  const startMs = new Date(inc.createdAt).getTime();
  const rows: AuditRow[] = [];

  function row(ts: string | Date, step: string, trigger: AuditRow['trigger'], action: string, details: string): AuditRow {
    const t = new Date(ts).getTime();
    return {
      time: new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      step, trigger, action, details,
      elapsed: formatElapsed(t - startMs),
      raw: t,
    };
  }

  // 1 — Alarm detected
  rows.push(row(inc.createdAt, 'Alarm', 'System', 'Alarm Detected', `Received from ${inc.reportedBy} — ${inc.errorCode || 'stream issue'}`));

  // 2 — Analysis started (if AI investigated)
  if (inc.confidenceScore > 0 || (inc.resourceAnalysis as any)?.affectedComponent) {
    rows.push(row(inc.createdAt, 'Analysis', 'Agent', 'Investigation Started', 'AI fetching pod logs, Redis health, and running GPT-4o synthesis'));
  }

  // 3 — Action history (agent restarts + manual restarts)
  inc.actionHistory?.forEach((a: any) => {
    const step = a.action === 'ESCALATE' ? 'Escalation' : a.action === 'NOTIFY_CUSTOMER' ? 'Notification' : 'Recovery';
    const trigger = deriveTrigger(a.approvedBy || '', a.action);
    const extra = a.approvedBy && a.approvedBy !== 'Manual' && a.approvedBy !== 'auto' && a.approvedBy !== 'system'
      ? ` · Approved by: ${a.approvedBy}` : '';
    rows.push(row(a.executedAt, step, trigger, a.action.replace(/_/g, ' '), `${a.result}${extra}`));
  });

  // 4 — Approval decisions
  inc.approvals?.forEach((appr: any) => {
    if (appr.decision === 'pending') return;
    const trigger: AuditRow['trigger'] = appr.decision === 'timeout' ? 'System' : 'Manual';
    rows.push(row(appr.decidedAt || appr.createdAt, 'Approval', trigger,
      `Approval ${appr.decision.toUpperCase()}`,
      `${appr.proposedAction} — ${appr.decision} by ${appr.decidedBy || 'timeout'}`));
  });

  // 5 — Escalations
  inc.escalations?.forEach((e: any) => {
    rows.push(row(e.sentAt || e.createdAt, 'Escalation', 'Agent', 'Escalated', `${e.reason} → ${e.escalatedTo}`));
  });

  // 6 — Resolution
  if (inc.resolvedAt) rows.push(row(inc.resolvedAt, 'Monitoring', 'System', 'Incident Resolved', 'Stream verified healthy by Hub Monitor'));
  if (inc.closedAt) rows.push(row(inc.closedAt, 'Monitoring', 'System', 'Incident Closed', 'Closed — memory pattern recorded for future use'));

  return rows.sort((a, b) => a.raw - b.raw);
});

const incidentDuration = computed((): string | null => {
  if (!store.selectedIncident) return null;
  const end = store.selectedIncident.closedAt || store.selectedIncident.resolvedAt;
  if (!end) return null;
  return formatElapsed(new Date(end).getTime() - new Date(store.selectedIncident.createdAt).getTime());
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

onMounted(() => {
  refresh();
  redisStore.fetchRedis();
  document.addEventListener('click', onClickOutsideRedis);
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutsideRedis);
});
</script>

<style scoped>
<<<<<<< HEAD
.detail-view { min-height: 100%; background: #0a0d11; }
=======
/* ── Layout ──────────────────────────────────────── */
.detail-view { min-height: 100vh; background: var(--bg-base); color: var(--tx-1); }
>>>>>>> 18a4547af20a9be0b5a005fb9e9df2fb5bda617e

.detail-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 20px; background: var(--bg-card); border-bottom: 1px solid var(--bd);
}
.back-btn {
  background: transparent; border: 1px solid var(--bd); color: var(--tx-2);
  padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;
  transition: all .15s;
}
.back-btn:hover { border-color: var(--accent); color: var(--accent); }
.detail-title-group { display: flex; align-items: center; gap: 8px; }
.detail-channel { font-size: 15px; font-weight: 600; color: var(--tx-1); }

/* Theme toggle + refresh */
.btn-theme {
  background: transparent; border: 1px solid var(--bd); color: var(--tx-2);
  padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 13px;
  transition: all .15s;
}
.btn-theme:hover { background: var(--bg-hover); }
.btn-refresh {
  background: transparent; border: 1px solid var(--bd); color: var(--tx-2);
  padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;
  transition: all .15s;
}
.btn-refresh:hover { background: var(--bg-hover); }

/* ── Header Redis button + dropdown ──────────────── */
.hdr-redis-wrap { position: relative; margin-left: auto; }
.hdr-redis-btn {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-2); padding: 4px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.hdr-redis-btn:hover, .hdr-redis-btn.active { border-color: var(--accent); color: var(--tx-1); background: var(--bg-hover); }
.hdr-redis-btn.status-healthy  { border-color: var(--col-ok); color: var(--col-ok); }
.hdr-redis-btn.status-warning  { border-color: var(--col-warn); color: var(--col-warn); }
.hdr-redis-btn.status-critical { border-color: var(--col-err); color: var(--col-err); }
.hdr-redis-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--tx-3); }
.hdr-redis-dot.status-healthy  { background: var(--col-ok); }
.hdr-redis-dot.status-warning  { background: var(--col-warn); }
.hdr-redis-dot.status-critical { background: var(--col-err); }
.hdr-redis-name { font-size: 11px; opacity: .75; }
.hdr-redis-chevron { font-size: 9px; transition: transform .2s; display: inline-block; }
.hdr-redis-chevron.rotated { transform: rotate(180deg); }

.hdr-ri-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 300px; background: var(--bg-card); border: 1px solid var(--bd);
  border-radius: 8px; z-index: 1000;
  box-shadow: var(--shadow); padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.hdr-ri-header {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 8px; border-bottom: 1px solid var(--bd-sub);
}
.hdr-ri-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--tx-3); }
.hdr-ri-cluster { font-size: 10px; color: var(--tx-3); font-family: monospace; }

/* ── Badges ──────────────────────────────────────── */
.badge { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: .06em; }
.vip-badge { background: var(--col-err-bg); color: var(--col-err); border: 1px solid var(--col-err); }
.state-badge { background: var(--bd-sub); color: var(--tx-2); }
.state-resolved, .state-closed { color: var(--col-ok); }
.state-escalated, .state-failed { color: var(--col-err); }
.state-waiting_approval { color: var(--col-warn); }

/* ── Page states ─────────────────────────────────── */
.loading-msg, .error-msg { padding: 40px; text-align: center; color: var(--tx-3); }
.error-msg { color: var(--col-err); }

/* ── Body layout ─────────────────────────────────── */
.detail-body { padding: 16px 20px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }
.detail-left, .detail-right { display: flex; flex-direction: column; gap: 12px; }

/* ── Info card ───────────────────────────────────── */
.info-card { background: var(--bg-card); border: 1px solid var(--bd); border-radius: 8px; padding: 14px; }
.info-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--tx-3); margin-bottom: 12px; }
.info-grid { display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px; align-items: start; }
.info-key { font-size: 11px; color: var(--tx-3); }
.info-val { font-size: 12px; color: var(--tx-1); }

/* ── Redis dropdown panel internals ─────────────── */
.ri-panel { display: flex; flex-direction: column; gap: 10px; }
.ri-loading { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--tx-2); padding: 4px 0; }
.ri-loading-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--col-warn); animation: ri-pulse 1s infinite; }
@keyframes ri-pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.ri-empty { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--tx-2); padding: 4px 0; }
.ri-code { font-family: monospace; font-size: 11px; color: var(--col-warn); background: var(--col-warn-bg); padding: 1px 4px; border-radius: 3px; }
.ri-reload { background: none; border: 1px solid var(--bd); color: var(--accent); font-size: 11px; cursor: pointer; padding: 2px 8px; border-radius: 4px; }
.ri-reload:hover { background: var(--accent-bg); }
.ri-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ri-inst-name { font-size: 13px; font-weight: 700; color: var(--tx-1); }
.ri-role-badge { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; background: var(--bd-sub); color: var(--tx-2); }
.ri-role-master { background: var(--col-ok-bg); color: var(--col-ok); }
.ri-status-badge { margin-left: auto; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; }

/* Status: green / yellow / red only */
.status-healthy  { background: var(--col-ok-bg);   color: var(--col-ok); }
.status-warning  { background: var(--col-warn-bg);  color: var(--col-warn); }
.status-critical { background: var(--col-err-bg);   color: var(--col-err); }
.hdr-redis-dot.status-healthy  { background: var(--col-ok); }
.hdr-redis-dot.status-warning  { background: var(--col-warn); }
.hdr-redis-dot.status-critical { background: var(--col-err); }

.ri-metrics { display: flex; flex-direction: column; gap: 5px; }
.ri-metrics-border { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--bd-sub); }
.ri-metric-row { display: flex; align-items: baseline; justify-content: space-between; }
.ri-mkey { font-size: 11px; color: var(--tx-3); }
.ri-mval { font-size: 12px; color: var(--tx-1); }
.ri-thresh { font-size: 9px; color: var(--tx-4); margin-left: 5px; }
.val-ok       { color: var(--col-ok); }
.val-warn     { color: var(--col-warn); }
.val-critical { color: var(--col-err); }
.ri-bar-bg { height: 4px; background: var(--bd-sub); border-radius: 2px; overflow: hidden; margin-top: 4px; }
.ri-bar-fill { height: 100%; border-radius: 2px; transition: width .4s; }
.ri-bar-fill.status-healthy  { background: var(--col-ok); }
.ri-bar-fill.status-warning  { background: var(--col-warn); }
.ri-bar-fill.status-critical { background: var(--col-err); }

/* ── Utilities ───────────────────────────────────── */
.mono { font-family: monospace; }
.error-code { color: var(--col-err); }
.warn  { color: var(--col-warn); }
.dim   { color: var(--tx-3); }

/* ── Players ─────────────────────────────────────── */
.players-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 700px) { .players-grid { grid-template-columns: 1fr; } }
.player-embed { display: flex; flex-direction: column; gap: 5px; }
.player-embed-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--tx-3); }
.player-no-url { height: 180px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--bd); border-radius: 6px; color: var(--tx-3); font-size: 11px; }
.player-url-small { font-family: monospace; font-size: 9px; color: var(--tx-4); word-break: break-all; }

/* ── Draft message ───────────────────────────────── */
.draft-textarea {
  width: 100%; background: var(--bg-deep); border: 1px solid var(--bd); border-radius: 6px;
  color: var(--tx-1); padding: 8px; font-size: 12px; font-family: inherit;
  resize: vertical; outline: none; line-height: 1.55;
}
.draft-textarea:focus { border-color: var(--accent); }
.draft-actions { display: flex; gap: 8px; margin-top: 8px; }
.btn-secondary {
  flex: 1; background: var(--bd-sub); border: 1px solid var(--bd); color: var(--tx-2);
  padding: 6px; border-radius: 6px; cursor: pointer; font-size: 11px; transition: all .15s;
}
.btn-secondary:hover { background: var(--bd); color: var(--tx-1); }

/* ── Audit table ─────────────────────────────────── */
.audit-wrap { overflow-x: auto; }
.audit-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.audit-table th {
  text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--bd);
  color: var(--tx-3); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap;
}
.audit-table td { padding: 7px 8px; border-bottom: 1px solid var(--bd-faint); vertical-align: top; line-height: 1.45; color: var(--tx-1); }
.audit-table tr:last-child td { border-bottom: none; }
.audit-table tr:hover td { background: var(--bg-hover); }
.action-cell { font-weight: 600; white-space: nowrap; }
.details-cell { color: var(--tx-2); max-width: 240px; word-break: break-word; }
.elapsed-cell { color: var(--tx-3); white-space: nowrap; }

/* Step badges — green / red / yellow / gray only */
.step-badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.step-alarm      { background: var(--col-err-bg);  color: var(--col-err); }
.step-analysis   { background: var(--bd-sub);       color: var(--tx-2); }
.step-recovery   { background: var(--col-ok-bg);   color: var(--col-ok); }
.step-monitoring { background: var(--col-ok-bg);   color: var(--col-ok); }
.step-escalation { background: var(--col-err-bg);  color: var(--col-err); }
.step-notification { background: var(--col-warn-bg); color: var(--col-warn); }
.step-approval   { background: var(--col-ok-bg);   color: var(--col-ok); }
.step-manual     { background: var(--col-warn-bg);  color: var(--col-warn); }

/* Trigger badges — gray / yellow only */
.trigger-badge { padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.trig-system { background: var(--bd-sub); color: var(--tx-2); }
.trig-agent  { background: var(--bd-sub); color: var(--tx-2); }
.trig-manual { background: var(--col-warn-bg); color: var(--col-warn); }

/* Summary row */
.summary-row td { background: var(--bg-deep); border-top: 1px solid var(--bd); color: var(--tx-2); font-size: 11px; }

/* ── Approvals / Escalations / Logs ──────────────── */
.approval-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--bd-sub); }
.approval-row:last-child { border-bottom: none; }
.appr-action { font-size: 11px; flex: 1; color: var(--tx-1); }
.appr-decision { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
.appr-approved { background: var(--col-ok-bg);   color: var(--col-ok); }
.appr-rejected { background: var(--col-err-bg);  color: var(--col-err); }
.appr-timeout  { background: var(--col-warn-bg); color: var(--col-warn); }
.appr-pending  { background: var(--bd-sub); color: var(--tx-3); }
.appr-by, .appr-time { font-size: 10px; color: var(--tx-3); }

.esc-row { display: flex; gap: 10px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--bd-sub); }
.esc-row:last-child { border-bottom: none; }
.esc-reason { font-size: 11px; flex: 1; color: var(--tx-1); }
.esc-to, .esc-time { font-size: 10px; color: var(--tx-3); }

.log-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--bd-sub); }
.log-row:last-child { border-bottom: none; }
.log-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: var(--col-ok); }
.dot-red   { background: var(--col-err); }
.log-action { font-size: 11px; flex: 1; color: var(--tx-1); }
.log-dur, .log-by, .log-time { font-size: 10px; color: var(--tx-3); }
</style>
