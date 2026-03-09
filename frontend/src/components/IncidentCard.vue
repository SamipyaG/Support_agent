<template>
  <div class="incident-card" :class="{ vip: incident.isVip, 'awaiting-approval': incident.state === 'WAITING_APPROVAL' }">
    <div class="card-left">
      <span class="state-dot" :class="stateDotClass"></span>
    </div>

    <div class="card-body">
      <div class="card-top">
        <span class="channel-name">{{ incident.channelName }}</span>
        <span v-if="incident.isVip" class="badge vip-badge">VIP</span>
        <span class="badge state-badge" :class="`state-${incident.state.toLowerCase()}`">
          {{ incident.state.replace(/_/g, ' ') }}
        </span>
        <span v-if="incident.state === 'WAITING_APPROVAL'" class="badge approval-badge">⏳ APPROVAL NEEDED</span>
      </div>

      <div class="card-meta">
        <span class="meta-item"><span class="meta-key">uuid</span>{{ incident.dsUuid }}</span>
        <span class="meta-item"><span class="meta-key">cluster</span>{{ incident.clusterId }}</span>
        <span class="meta-item"><span class="meta-key">redis</span>{{ incident.redisInstance }}</span>
        <span class="meta-item"><span class="meta-key">type</span>{{ incident.streamType }}</span>
        <span v-if="incident.errorCode" class="meta-item error-code">{{ incident.errorCode }}</span>
      </div>

      <div v-if="incident.statusLabel" class="status-label">
        {{ incident.statusLabel }}
      </div>

      <div v-if="incident.recommendedAction" class="card-action">
        <span class="action-label">Suggested:</span>
        <span class="action-val">{{ incident.recommendedAction.replace(/_/g, ' ') }}</span>
        <span class="confidence" :class="confidenceClass">{{ incident.confidenceScore }}% conf</span>
      </div>
    </div>

    <div class="card-right">
      <span class="card-time">{{ timeAgo }}</span>
      <span class="reported-by">via {{ incident.reportedBy }}</span>
      <span v-if="incident.jiraTicketKey" class="jira-key">{{ incident.jiraTicketKey }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Incident } from '@/store/incidents';

const props = defineProps<{ incident: Incident }>();

const stateDotClass = computed(() => {
  const map: Record<string, string> = {
    NEW: 'dot-blue',
    ANALYZING: 'dot-amber',
    WAITING_APPROVAL: 'dot-amber blink',
    EXECUTING_ACTION: 'dot-amber',
    MONITORING: 'dot-blue',
    ESCALATED: 'dot-red',
    RESOLVED: 'dot-green',
    CLOSED: 'dot-green',
    FAILED: 'dot-red',
  };
  return map[props.incident.state] || 'dot-gray';
});

const confidenceClass = computed(() => {
  if (props.incident.confidenceScore >= 85) return 'conf-high';
  if (props.incident.confidenceScore >= 70) return 'conf-med';
  return 'conf-low';
});

const timeAgo = computed(() => {
  const diff = Date.now() - new Date(props.incident.createdAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
});
</script>

<style scoped>
.incident-card {
  background: #111318; border: 1px solid #252b36; border-radius: 8px;
  padding: 12px 16px; display: flex; align-items: flex-start; gap: 12px;
  cursor: pointer; transition: border-color .15s, background .15s;
}
.incident-card:hover { background: #161b24; border-color: #2e3545; }
.incident-card.vip { border-left: 3px solid #f85149; }
.incident-card.awaiting-approval { border-color: rgba(227,162,58,.5); background: rgba(36,26,8,.3); }

.card-left { padding-top: 2px; }
.state-dot {
  display: block; width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
}
.dot-red    { background: #f85149; box-shadow: 0 0 0 2px rgba(248,81,73,.2); }
.dot-amber  { background: #e3a23a; box-shadow: 0 0 0 2px rgba(227,162,58,.2); }
.dot-green  { background: #3fb950; box-shadow: 0 0 0 2px rgba(63,185,80,.2); }
.dot-blue   { background: #4d9de0; box-shadow: 0 0 0 2px rgba(77,157,224,.2); }
.dot-gray   { background: #4f5b6e; }
@keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:.3 } }
.blink { animation: blink 1s ease-in-out infinite; }

.card-body { flex: 1; }
.card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
.channel-name { font-size: 13px; font-weight: 600; }

.badge {
  font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: .06em;
}
.vip-badge { background: rgba(248,81,73,.15); color: #f85149; border: 1px solid rgba(248,81,73,.3); }
.state-badge { background: #1e2330; color: #8896aa; }
.state-analyzing { color: #e3a23a; }
.state-waiting_approval { background: rgba(227,162,58,.15); color: #e3a23a; border: 1px solid rgba(227,162,58,.3); }
.state-resolved, .state-closed { color: #3fb950; }
.state-escalated, .state-failed { color: #f85149; }
.approval-badge { background: rgba(227,162,58,.15); color: #e3a23a; border: 1px solid rgba(227,162,58,.3); animation: blink 1s ease-in-out infinite; }

.card-meta { display: flex; flex-wrap: wrap; gap: 12px; }
.meta-item { font-family: monospace; font-size: 10px; color: #4f5b6e; }
.meta-key { margin-right: 3px; color: #2e3545; }
.error-code { color: #f85149; font-weight: 600; }

.card-action { display: flex; align-items: center; gap: 8px; margin-top: 5px; }
.action-label { font-size: 10px; color: #4f5b6e; }
.action-val { font-size: 11px; font-weight: 500; color: #4d9de0; }
.confidence { font-size: 10px; font-family: monospace; padding: 1px 6px; border-radius: 4px; }
.conf-high { background: rgba(63,185,80,.15); color: #3fb950; }
.conf-med  { background: rgba(227,162,58,.15); color: #e3a23a; }
.conf-low  { background: rgba(248,81,73,.15); color: #f85149; }

.status-label { font-size: 10px; color: #8896aa; margin-top: 4px; font-style: italic; }

.card-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.card-time { font-family: monospace; font-size: 11px; color: #4f5b6e; }
.reported-by { font-size: 10px; color: #2e3545; }
.jira-key { font-family: monospace; font-size: 10px; color: #4d9de0; }
</style>
