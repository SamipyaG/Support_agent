<template>
  <div class="approval-box">
    <div class="approval-header">
      <span class="approval-icon">⚡</span>
      <div>
        <div class="approval-title">Action Required</div>
        <div class="approval-subtitle">{{ proposedAction.replace(/_/g, ' ') }}</div>
      </div>
      <div class="countdown" :class="{ urgent: timeLeft <= 3 }">{{ timeLeft }}s</div>
    </div>

    <div class="approval-progress">
      <div class="progress-bar" :style="{ width: progressWidth + '%' }"></div>
    </div>

    <p class="approval-explanation">{{ explanation }}</p>

    <div class="approval-actions">
      <button class="btn-approve" :disabled="decided" @click="emitApprove">✓ Approve</button>
      <button class="btn-reject" :disabled="decided" @click="emitReject">✗ Reject</button>
    </div>

    <div v-if="decided" class="decided-msg" :class="decisionClass">
      {{ decisionMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  incidentId: string;
  proposedAction: string;
  explanation: string;
  timeoutSeconds: number;
}>();

const emit = defineEmits<{
  approve: [incidentId: string];
  reject: [incidentId: string];
}>();

const timeLeft = ref(props.timeoutSeconds);
const decided = ref(false);
const decision = ref<'approved' | 'rejected' | 'timeout' | null>(null);
let timer: ReturnType<typeof setInterval>;

const progressWidth = computed(() => (timeLeft.value / props.timeoutSeconds) * 100);

const decisionClass = computed(() => ({
  'decision-approved': decision.value === 'approved',
  'decision-rejected': decision.value === 'rejected',
  'decision-timeout': decision.value === 'timeout',
}));

const decisionMessage = computed(() => {
  if (decision.value === 'approved') return '✅ Approved — executing action';
  if (decision.value === 'rejected') return '✗ Rejected — escalating';
  if (decision.value === 'timeout') return '⏱ Timeout — auto-executing';
  return '';
});

function emitApprove(): void {
  decided.value = true;
  decision.value = 'approved';
  clearInterval(timer);
  emit('approve', props.incidentId);
}

function emitReject(): void {
  decided.value = true;
  decision.value = 'rejected';
  clearInterval(timer);
  emit('reject', props.incidentId);
}

onMounted(() => {
  timer = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(timer);
      if (!decided.value) {
        decided.value = true;
        decision.value = 'timeout';
      }
    }
  }, 1000);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.approval-box {
  background: rgba(36,26,8,.6); border: 1px solid rgba(227,162,58,.4);
  border-radius: 10px; padding: 14px; margin-bottom: 12px;
}
.approval-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.approval-icon { font-size: 18px; }
.approval-title { font-size: 13px; font-weight: 600; color: #edf2f7; }
.approval-subtitle { font-family: monospace; font-size: 11px; color: #e3a23a; margin-top: 1px; }
.countdown {
  margin-left: auto; font-family: monospace; font-size: 22px; font-weight: 700;
  color: #e3a23a; min-width: 40px; text-align: right;
}
.countdown.urgent { color: #f85149; animation: blink 0.5s ease-in-out infinite; }
@keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:.4 } }

.approval-progress {
  height: 3px; background: #252b36; border-radius: 2px; overflow: hidden; margin-bottom: 10px;
}
.progress-bar {
  height: 100%; background: #e3a23a; border-radius: 2px;
  transition: width 1s linear;
}

.approval-explanation { font-size: 11px; color: #8896aa; line-height: 1.5; margin-bottom: 12px; }

.approval-actions { display: flex; gap: 8px; }
.btn-approve, .btn-reject {
  flex: 1; padding: 8px; border-radius: 6px; font-size: 12px;
  font-weight: 600; cursor: pointer; border: none; transition: all .15s;
}
.btn-approve { background: #3fb950; color: #000; }
.btn-approve:hover:not(:disabled) { background: #4ec660; }
.btn-reject { background: transparent; color: #f85149; border: 1px solid rgba(248,81,73,.4); }
.btn-reject:hover:not(:disabled) { background: rgba(42,18,21,.6); }
.btn-approve:disabled, .btn-reject:disabled { opacity: .4; cursor: not-allowed; }

.decided-msg { margin-top: 8px; font-size: 12px; font-weight: 600; text-align: center; }
.decision-approved { color: #3fb950; }
.decision-rejected { color: #f85149; }
.decision-timeout  { color: #e3a23a; }
</style>
