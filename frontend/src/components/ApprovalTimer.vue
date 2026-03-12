<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="visible" class="approval-toast">
        <div class="toast-progress">
          <div class="toast-progress-bar" :style="{ width: progressWidth + '%' }"></div>
        </div>

        <div class="toast-header">
          <span class="toast-icon">⚡</span>
          <div class="toast-titles">
            <div class="toast-title">Action Required</div>
            <div class="toast-subtitle">{{ proposedAction.replace(/_/g, ' ') }}</div>
          </div>
          <div class="toast-countdown" :class="{ urgent: timeLeft <= 3 }">{{ timeLeft }}s</div>
        </div>

        <p class="toast-explanation">{{ explanation }}</p>

        <div class="toast-actions">
          <button class="btn-approve" :disabled="decided" @click="emitApprove">✓ Approve</button>
          <button class="btn-reject" :disabled="decided" @click="emitReject">✗ Reject</button>
        </div>

        <div v-if="decided" class="decided-msg" :class="decisionClass">
          {{ decisionMessage }}
        </div>
      </div>
    </Transition>
  </Teleport>
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
const visible = ref(true);
let timer: ReturnType<typeof setInterval>;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

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

function scheduleDismiss(): void {
  dismissTimer = setTimeout(() => { visible.value = false; }, 6000);
}

function emitApprove(): void {
  decided.value = true;
  decision.value = 'approved';
  clearInterval(timer);
  emit('approve', props.incidentId);
  scheduleDismiss();
}

function emitReject(): void {
  decided.value = true;
  decision.value = 'rejected';
  clearInterval(timer);
  emit('reject', props.incidentId);
  scheduleDismiss();
}

onMounted(() => {
  timer = setInterval(() => {
    timeLeft.value--;
    if (timeLeft.value <= 0) {
      clearInterval(timer);
      if (!decided.value) {
        decided.value = true;
        decision.value = 'timeout';
        scheduleDismiss();
      }
    }
  }, 1000);
});

onUnmounted(() => {
  clearInterval(timer);
  if (dismissTimer) clearTimeout(dismissTimer);
});
</script>

<style scoped>
/* ── Toast container ─────────────────────────────── */
.approval-toast {
  position: fixed; bottom: 24px; right: 24px; z-index: 9999;
  width: 340px;
  background: rgba(30, 22, 6, 0.97);
  border: 1px solid rgba(227,162,58,.5);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.55);
  overflow: hidden;
}

/* ── Progress bar (top edge) ─────────────────────── */
.toast-progress { height: 3px; background: #1e2330; }
.toast-progress-bar {
  height: 100%; background: #e3a23a; border-radius: 0;
  transition: width 1s linear;
}

/* ── Header ──────────────────────────────────────── */
.toast-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px 8px;
}
.toast-icon { font-size: 18px; flex-shrink: 0; }
.toast-titles { flex: 1; min-width: 0; }
.toast-title { font-size: 13px; font-weight: 600; color: #edf2f7; }
.toast-subtitle { font-family: monospace; font-size: 11px; color: #e3a23a; margin-top: 2px; }
.toast-countdown {
  font-family: monospace; font-size: 22px; font-weight: 700;
  color: #e3a23a; min-width: 40px; text-align: right; flex-shrink: 0;
}
.toast-countdown.urgent { color: #f85149; animation: blink 0.5s ease-in-out infinite; }
@keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:.4 } }

/* ── Explanation ─────────────────────────────────── */
.toast-explanation {
  font-size: 11px; color: #8896aa; line-height: 1.5;
  padding: 0 14px 10px; margin: 0;
}

/* ── Action buttons ──────────────────────────────── */
.toast-actions { display: flex; gap: 0; border-top: 1px solid rgba(227,162,58,.15); }
.btn-approve, .btn-reject {
  flex: 1; padding: 10px; font-size: 12px;
  font-weight: 600; cursor: pointer; border: none; transition: all .15s;
}
.btn-approve {
  background: rgba(63,185,80,.15); color: #3fb950;
  border-right: 1px solid rgba(227,162,58,.15);
}
.btn-approve:hover:not(:disabled) { background: rgba(63,185,80,.25); }
.btn-reject { background: transparent; color: #f85149; }
.btn-reject:hover:not(:disabled) { background: rgba(248,81,73,.1); }
.btn-approve:disabled, .btn-reject:disabled { opacity: .35; cursor: not-allowed; }

/* ── Decision message ────────────────────────────── */
.decided-msg {
  padding: 8px 14px 10px; font-size: 12px; font-weight: 600; text-align: center;
  border-top: 1px solid rgba(227,162,58,.15);
}
.decision-approved { color: #3fb950; }
.decision-rejected { color: #f85149; }
.decision-timeout  { color: #e3a23a; }

/* ── Slide-in / out transition ───────────────────── */
.toast-enter-active { animation: slide-in .3s cubic-bezier(.22,.68,0,1.2); }
.toast-leave-active { animation: slide-out .25s ease-in; }
@keyframes slide-in  { from { opacity: 0; transform: translateY(20px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes slide-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(16px) scale(.96); } }
</style>
