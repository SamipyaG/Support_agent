<template>
  <Teleport to="body">
    <div class="trd-backdrop">
      <div class="trd-modal">
        <!-- Header -->
        <div class="trd-header">
          <span class="trd-icon">⚠</span>
          <div class="trd-titles">
            <div class="trd-title">Move Traffic to Source</div>
            <div class="trd-subtitle mono">{{ channelName }}</div>
          </div>
          <button v-if="phase === 'input'" class="trd-close" @click="$emit('close')">✕</button>
        </div>

        <div class="trd-divider"></div>

        <!-- ── Phase 1: Percentage input ── -->
        <template v-if="phase === 'input'">
          <p class="trd-reason">
            G-Mana stream not recovering after restart attempts.<br />
            Redirecting traffic to source stream will maintain service continuity.
          </p>

          <div class="trd-field">
            <label class="trd-label">Redirect Percentage</label>
            <div class="trd-pct-row">
              <input
                v-model.number="percentage"
                type="number"
                min="1"
                max="100"
                class="trd-input"
                placeholder="30"
                :disabled="executing"
              />
              <span class="trd-pct-sym">%</span>
            </div>
            <div class="trd-hint">
              {{ percentage }}% of viewers will be served from the source stream
            </div>
          </div>

          <div v-if="errorMsg" class="trd-error">{{ errorMsg }}</div>

          <div class="trd-actions">
            <button
              class="trd-btn-execute"
              :disabled="!validPct || executing"
              @click="execute"
            >
              <span v-if="executing">↗ Redirecting…</span>
              <span v-else>↗ Redirect Traffic ({{ percentage || '—' }}%)</span>
            </button>
            <button class="trd-btn-cancel" :disabled="executing" @click="$emit('close')">
              Cancel
            </button>
          </div>
        </template>

        <!-- ── Phase 2: Monitoring ── -->
        <template v-else-if="phase === 'monitoring'">
          <div class="trd-mon-row">
            <span class="trd-mon-dot"></span>
            <div class="trd-mon-info">
              <div class="trd-mon-title">
                Traffic redirected to source ({{ percentage }}%)
              </div>
              <div class="trd-mon-sub">
                Monitoring G-Mana stream health every 30s…
                <span v-if="nextCheckIn > 0" class="trd-countdown">Next check in {{ nextCheckIn }}s</span>
              </div>
            </div>
          </div>

          <div class="trd-checks">
            <div
              v-for="(check, i) in healthChecks"
              :key="i"
              class="trd-check-row"
              :class="check.healthy ? 'check-ok' : 'check-fail'"
            >
              <span class="check-icon">{{ check.healthy ? '✓' : '✗' }}</span>
              <span class="check-time mono">{{ check.time }}</span>
              <span class="check-label">{{ check.healthy ? 'G-Mana healthy' : 'Still unhealthy' }}</span>
            </div>
          </div>

          <div v-if="errorMsg" class="trd-error">{{ errorMsg }}</div>

          <button class="trd-btn-revert" @click="manualRevert">↩ Revert to G-Mana now</button>
        </template>

        <!-- ── Phase 3: Reverted ── -->
        <template v-else-if="phase === 'reverted'">
          <div class="trd-success-row">
            <span class="trd-success-icon">✓</span>
            <div>
              <div class="trd-success-title">G-Mana stream recovered</div>
              <div class="trd-success-sub">Traffic has been restored from source back to G-Mana.</div>
            </div>
          </div>
          <button class="trd-btn-cancel" @click="$emit('close')">Close</button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { redirectTrafficToSource, revertTrafficToGMana, checkGManaHealth } from '@/api/traffic';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  incidentId: string;
  channelName: string;
}>();

const emit = defineEmits<{
  close: [];
  redirected: [percentage: number];
  reverted: [];
}>();

const { show: toastShow } = useToast();

type Phase = 'input' | 'monitoring' | 'reverted';

const phase     = ref<Phase>('input');
const percentage = ref<number>(30);
const executing  = ref(false);
const errorMsg   = ref('');
const nextCheckIn = ref(0);

interface HealthCheck { time: string; healthy: boolean }
const healthChecks = ref<HealthCheck[]>([]);

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const validPct = computed(
  () => Number.isInteger(percentage.value) && percentage.value >= 1 && percentage.value <= 100,
);

function fmtTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function execute(): Promise<void> {
  if (!validPct.value) return;
  executing.value = true;
  errorMsg.value = '';
  try {
    await redirectTrafficToSource(props.incidentId, percentage.value);
    toastShow('success', `Traffic redirected to source (${percentage.value}%)`, `Monitoring G-Mana recovery for ${props.channelName}`);
    emit('redirected', percentage.value);
    phase.value = 'monitoring';
    startMonitoring();
  } catch (err) {
    errorMsg.value = (err as Error).message;
    toastShow('error', 'Redirect failed', (err as Error).message);
  } finally {
    executing.value = false;
  }
}

function startMonitoring(): void {
  // Immediate first check after 30s; tick countdown every second
  nextCheckIn.value = 30;
  countdownTimer = setInterval(() => {
    nextCheckIn.value--;
    if (nextCheckIn.value <= 0) nextCheckIn.value = 30;
  }, 1000);

  monitorTimer = setInterval(async () => {
    try {
      const health = await checkGManaHealth(props.incidentId);
      healthChecks.value.push({ time: fmtTime(), healthy: health.gmanaHealthy });
      if (health.gmanaHealthy) {
        await performRevert(true);
      }
    } catch {
      // ignore transient health check failures
    }
  }, 30_000);
}

async function manualRevert(): Promise<void> {
  await performRevert(false);
}

async function performRevert(auto: boolean): Promise<void> {
  stopMonitoring();
  try {
    await revertTrafficToGMana(props.incidentId);
    toastShow(
      'success',
      'G-Mana stream recovered — traffic restored',
      auto
        ? `${props.channelName} is healthy again — reverted automatically`
        : `Traffic manually reverted to G-Mana for ${props.channelName}`,
    );
    emit('reverted');
    phase.value = 'reverted';
  } catch (err) {
    errorMsg.value = (err as Error).message;
    toastShow('error', 'Revert failed', (err as Error).message);
  }
}

function stopMonitoring(): void {
  if (monitorTimer)   { clearInterval(monitorTimer);   monitorTimer   = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

onUnmounted(stopMonitoring);
</script>

<style scoped>
/* ── Backdrop ─────────────────────────────────────── */
.trd-backdrop {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0, 0, 0, .65);
  display: flex; align-items: center; justify-content: center;
}

/* ── Modal card ──────────────────────────────────── */
.trd-modal {
  width: 420px; max-width: calc(100vw - 32px);
  background: #111318;
  border: 1px solid rgba(227, 162, 58, .45);
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, .7);
  display: flex; flex-direction: column; gap: 0;
  overflow: hidden;
  animation: modal-in .25s cubic-bezier(.22, .68, 0, 1.2);
}
@keyframes modal-in { from { opacity: 0; transform: scale(.94) translateY(10px); } to { opacity: 1; transform: none; } }

/* ── Header ──────────────────────────────────────── */
.trd-header {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 16px 12px;
}
.trd-icon { font-size: 20px; flex-shrink: 0; }
.trd-titles { flex: 1; min-width: 0; }
.trd-title { font-size: 14px; font-weight: 700; color: #edf2f7; }
.trd-subtitle { font-size: 11px; color: #e3a23a; margin-top: 2px; word-break: break-all; }
.trd-close {
  background: none; border: none; color: #4f5b6e; font-size: 14px;
  cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: color .15s;
  flex-shrink: 0;
}
.trd-close:hover { color: #edf2f7; }

.trd-divider { height: 1px; background: rgba(227, 162, 58, .15); }

/* ── Reason text ─────────────────────────────────── */
.trd-reason {
  margin: 0; padding: 12px 16px;
  font-size: 11px; color: #8896aa; line-height: 1.6;
}

/* ── Percentage input ────────────────────────────── */
.trd-field { padding: 0 16px 12px; display: flex; flex-direction: column; gap: 6px; }
.trd-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #4f5b6e; }
.trd-pct-row { display: flex; align-items: center; gap: 8px; }
.trd-input {
  width: 90px; padding: 8px 10px;
  background: #0d1117; border: 1px solid #252b36; border-radius: 6px;
  color: #edf2f7; font-size: 18px; font-weight: 700; font-family: monospace;
  outline: none; text-align: center; transition: border-color .15s;
}
.trd-input:focus { border-color: #e3a23a; }
.trd-input:disabled { opacity: .5; }
.trd-pct-sym { font-size: 18px; font-weight: 700; color: #e3a23a; }
.trd-hint { font-size: 10px; color: #4f5b6e; }

/* ── Error ───────────────────────────────────────── */
.trd-error {
  margin: 0 16px 10px;
  font-size: 11px; color: #f85149;
  background: rgba(248, 81, 73, .08); border: 1px solid rgba(248, 81, 73, .2);
  border-radius: 6px; padding: 7px 10px;
}

/* ── Action buttons ──────────────────────────────── */
.trd-actions { display: flex; flex-direction: column; gap: 8px; padding: 0 16px 16px; }
.trd-btn-execute {
  width: 100%; padding: 11px; border-radius: 7px;
  border: 1px solid #e3a23a; background: rgba(227, 162, 58, .12);
  color: #e3a23a; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.trd-btn-execute:hover:not(:disabled) { background: rgba(227, 162, 58, .22); }
.trd-btn-execute:disabled { opacity: .45; cursor: not-allowed; }

.trd-btn-cancel {
  width: 100%; padding: 9px; border-radius: 7px;
  border: 1px solid #252b36; background: transparent;
  color: #4f5b6e; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.trd-btn-cancel:hover:not(:disabled) { border-color: #4f5b6e; color: #8896aa; }
.trd-btn-cancel:disabled { opacity: .4; cursor: not-allowed; }

/* ── Monitoring phase ────────────────────────────── */
.trd-mon-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px 8px;
}
.trd-mon-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #e3a23a; flex-shrink: 0; margin-top: 3px;
  animation: mon-pulse 1.5s ease-in-out infinite;
}
@keyframes mon-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(.85); } }
.trd-mon-info { flex: 1; min-width: 0; }
.trd-mon-title { font-size: 12px; font-weight: 600; color: #edf2f7; }
.trd-mon-sub { font-size: 11px; color: #4f5b6e; margin-top: 3px; }
.trd-countdown { color: #e3a23a; font-family: monospace; margin-left: 4px; }

.trd-checks {
  display: flex; flex-direction: column; gap: 4px;
  margin: 0 16px 10px;
  max-height: 120px; overflow-y: auto;
}
.trd-check-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 10px; padding: 4px 8px; border-radius: 5px;
}
.check-ok  { background: rgba(63, 185, 80, .08); }
.check-fail { background: rgba(248, 81, 73, .06); }
.check-icon { font-size: 10px; width: 12px; flex-shrink: 0; }
.check-ok  .check-icon { color: #3fb950; }
.check-fail .check-icon { color: #f85149; }
.check-time { color: #4f5b6e; }
.check-label { color: #8896aa; }

.trd-btn-revert {
  width: calc(100% - 32px); margin: 0 16px 16px;
  padding: 9px; border-radius: 7px;
  border: 1px solid rgba(77, 157, 224, .4); background: rgba(77, 157, 224, .08);
  color: #4d9de0; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.trd-btn-revert:hover { background: rgba(77, 157, 224, .15); border-color: #4d9de0; }

/* ── Reverted / success ──────────────────────────── */
.trd-success-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 16px 12px;
}
.trd-success-icon {
  width: 28px; height: 28px; border-radius: 50%;
  background: rgba(63, 185, 80, .15); color: #3fb950;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; flex-shrink: 0;
}
.trd-success-title { font-size: 13px; font-weight: 600; color: #3fb950; }
.trd-success-sub { font-size: 11px; color: #8896aa; margin-top: 3px; }

/* ── Utilities ───────────────────────────────────── */
.mono { font-family: monospace; }
</style>
