<template>
  <div class="incident-card" :class="{ vip: incident.isVip, 'awaiting-approval': incident.state === 'WAITING_APPROVAL' }">
    <div class="card-left">
      <span class="state-dot" :class="stateDotClass"></span>
    </div>

    <div class="card-body">
      <div class="card-top">
        <span
          class="channel-name"
          @contextmenu.prevent="copyUuid"
          :title="`Right-click to copy ds_uuid`"
        >{{ incident.channelName }}</span>
        <span v-if="incident.channelType" class="badge" :class="incident.channelType === 'LIVE' ? 'type-live' : 'type-vod'">
          {{ incident.channelType }}
        </span>
        <span v-if="incident.isVip" class="badge vip-badge">PRIORITIZED</span>
        <span class="badge state-badge" :class="`state-${incident.state.toLowerCase()}`">
          {{ incident.state.replace(/_/g, ' ') }}
        </span>
        <span v-if="incident.state === 'WAITING_APPROVAL'" class="badge approval-badge">⏳ APPROVAL NEEDED</span>
      </div>

      <div v-if="incident.errorCode" class="error-code">{{ incident.errorCode }}</div>

      <div v-if="incident.recommendedAction" class="card-action">
        <span class="action-label">Suggested:</span>
        <span class="action-val">{{ incident.recommendedAction.replace(/_/g, ' ') }}</span>
        <span class="confidence" :class="confidenceClass">{{ incident.confidenceScore }}% conf</span>
      </div>


    </div>

    <div class="card-right">
      <span class="card-time">{{ timeAgo }}</span>
    </div>

    <div v-if="copied" class="copy-toast">Copied!</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Incident } from '@/store/incidents';

const props = defineProps<{ incident: Incident }>();

const copied = ref(false);

function copyUuid(): void {
  navigator.clipboard.writeText(props.incident.dsUuid).then(() => {
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  });
}

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
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (secs < 60) return `${secs}s ago`;
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  return `${hours}h ${mins % 60}m ago`;
});
</script>

<style scoped>
.incident-card {
  background: var(--bg-card); border: 1px solid var(--bd); border-radius: 8px;
  padding: 12px 16px; display: flex; align-items: flex-start; gap: 12px;
  cursor: pointer; transition: border-color .15s, background .15s; position: relative;
}
.incident-card:hover { background: var(--bg-hover); border-color: var(--tx-4); }
.incident-card.vip { border-left: 3px solid var(--col-err); }
.incident-card.awaiting-approval { border-color: rgba(227,162,58,.5); }

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
.channel-name {
  font-size: 13px; font-weight: 600;
  cursor: context-menu;
}
.channel-name:hover { text-decoration: underline dotted var(--tx-3); }

.badge {
  font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: .06em;
}
.vip-badge { background: rgba(248,81,73,.15); color: #f85149; border: 1px solid rgba(248,81,73,.3); }
.type-live { background: rgba(77,157,224,.15); color: #4d9de0; border: 1px solid rgba(77,157,224,.3); }
.type-vod  { background: rgba(63,185,80,.15);  color: #3fb950; border: 1px solid rgba(63,185,80,.3); }
.state-badge { background: var(--bd-sub); color: var(--tx-2); }
.state-analyzing { color: #e3a23a; }
.state-waiting_approval { background: rgba(227,162,58,.15); color: #e3a23a; border: 1px solid rgba(227,162,58,.3); }
.state-resolved, .state-closed { color: #3fb950; }
.state-escalated, .state-failed { color: #f85149; }
.approval-badge { background: rgba(227,162,58,.15); color: #e3a23a; border: 1px solid rgba(227,162,58,.3); animation: blink 1s ease-in-out infinite; }

.error-code { font-family: monospace; font-size: 11px; color: var(--col-err); font-weight: 600; margin-bottom: 4px; }

.card-action { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.action-label { font-size: 10px; color: var(--tx-3); }
.action-val { font-size: 11px; font-weight: 500; color: var(--accent); }
.confidence { font-size: 10px; font-family: monospace; padding: 1px 6px; border-radius: 4px; }
.conf-high { background: rgba(63,185,80,.15); color: #3fb950; }
.conf-med  { background: rgba(227,162,58,.15); color: #e3a23a; }
.conf-low  { background: rgba(248,81,73,.15); color: #f85149; }


.card-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.card-time { font-family: monospace; font-size: 11px; color: var(--tx-3); }

.copy-toast {
  position: absolute; bottom: 8px; right: 12px;
  background: var(--col-ok); color: #fff;
  font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
  pointer-events: none;
}
</style>
