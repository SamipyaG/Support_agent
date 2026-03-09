<template>
  <div class="restart-workflow">
    <div class="rw-title">Service Restart</div>

    <!-- No cluster yet -->
    <div v-if="!clusterId" class="rw-warn">
      ⚠ Cluster not yet determined — wait for analysis to complete.
    </div>

    <template v-else>
      <!-- ── User Handler ───────────────────────── -->
      <div class="service-block">
        <div class="service-header">
          <span class="service-name">User Handler</span>
          <span class="service-pod dim mono">user-handler-{{ dsUuid }}</span>
        </div>

        <button
          class="btn-restart"
          :class="{ done: !!uhResult, error: uhState === 'error' }"
          :disabled="uhState !== 'idle' || !!uhResult"
          @click="doRestartUH"
        >
          <span v-if="uhState === 'fetching-logs'">⬇ Downloading logs...</span>
          <span v-else-if="uhState === 'restarting'">⟳ Restarting...</span>
          <span v-else-if="uhResult">✓ Restarted</span>
          <span v-else-if="uhState === 'error'">✗ Failed — retry?</span>
          <span v-else>↻ Restart UH</span>
        </button>

        <div v-if="uhError" class="status-error">{{ uhError }}</div>
        <div v-if="uhResult" class="status-ok">
          {{ uhResult.message }}
          <span class="dim"> · {{ uhResult.deploymentName }}</span>
        </div>

        <!-- Countdown bar after UH restart -->
        <div v-if="uhResult?.success && countdown > 0" class="countdown-block">
          <span class="countdown-label">CI restart available in {{ countdown }}s</span>
          <div class="countdown-bar-bg">
            <div class="countdown-bar" :style="{ width: `${(countdown / 60) * 100}%` }"></div>
          </div>
        </div>
      </div>

      <!-- Divider -->
      <div class="service-divider"></div>

      <!-- ── Cuemana In ─────────────────────────── -->
      <div class="service-block" :class="{ locked: !ciEnabled }">
        <div class="service-header">
          <span class="service-name">Cuemana In (CI)</span>
          <span class="service-pod dim mono">cuemana-in-{{ dsUuid }}</span>
        </div>

        <button
          class="btn-restart"
          :class="{ done: !!ciResult, error: ciState === 'error' }"
          :disabled="!ciEnabled || ciState !== 'idle' || !!ciResult"
          @click="doRestartCI"
        >
          <span v-if="!uhResult" class="lock-hint">🔒 After UH restart</span>
          <span v-else-if="countdown > 0" class="lock-hint">⏳ Wait {{ countdown }}s</span>
          <span v-else-if="ciState === 'fetching-logs'">⬇ Downloading logs...</span>
          <span v-else-if="ciState === 'restarting'">⟳ Restarting...</span>
          <span v-else-if="ciResult">✓ Restarted</span>
          <span v-else-if="ciState === 'error'">✗ Failed — retry?</span>
          <span v-else>↻ Restart CI</span>
        </button>

        <div v-if="ciError" class="status-error">{{ ciError }}</div>
        <div v-if="ciResult" class="status-ok">
          {{ ciResult.message }}
          <span class="dim"> · {{ ciResult.deploymentName }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { fetchUHLogs, fetchCILogs, restartUH, restartCI, downloadTextFile } from '@/api/restart';
import type { RestartResult } from '@/api/restart';

const props = defineProps<{
  incidentId: string;
  dsUuid: string;
  clusterId: string;
}>();

type ServiceState = 'idle' | 'fetching-logs' | 'restarting' | 'error';

const uhState = ref<ServiceState>('idle');
const uhResult = ref<RestartResult | null>(null);
const uhError = ref('');

const ciState = ref<ServiceState>('idle');
const ciResult = ref<RestartResult | null>(null);
const ciError = ref('');

const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const ciEnabled = computed(() => uhResult.value?.success === true && countdown.value === 0);

function startCountdown(): void {
  countdown.value = 60;
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      clearInterval(countdownTimer!);
      countdownTimer = null;
    }
  }, 1000);
}

async function doRestartUH(): Promise<void> {
  uhError.value = '';
  uhState.value = 'fetching-logs';
  try {
    const logs = await fetchUHLogs(props.incidentId);
    downloadTextFile(logs.logs, `uh-${props.dsUuid}-logs.txt`);

    uhState.value = 'restarting';
    uhResult.value = await restartUH(props.incidentId);
    uhState.value = 'idle';

    if (uhResult.value.success) startCountdown();
  } catch (err) {
    uhState.value = 'error';
    uhError.value = (err as Error).message;
  }
}

async function doRestartCI(): Promise<void> {
  ciError.value = '';
  ciState.value = 'fetching-logs';
  try {
    const logs = await fetchCILogs(props.incidentId);
    downloadTextFile(logs.logs, `ci-${props.dsUuid}-logs.txt`);

    ciState.value = 'restarting';
    ciResult.value = await restartCI(props.incidentId);
    ciState.value = 'idle';
  } catch (err) {
    ciState.value = 'error';
    ciError.value = (err as Error).message;
  }
}

onUnmounted(() => { if (countdownTimer) clearInterval(countdownTimer); });
</script>

<style scoped>
.restart-workflow {
  background: #111318; border: 1px solid #252b36; border-radius: 8px; padding: 14px;
  display: flex; flex-direction: column; gap: 12px;
}

.rw-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .1em; color: #4f5b6e;
}

.rw-warn {
  font-size: 11px; color: #e3a23a; background: rgba(227,162,58,.08);
  border: 1px solid rgba(227,162,58,.2); border-radius: 6px; padding: 8px 10px;
}

.service-block { display: flex; flex-direction: column; gap: 7px; }
.service-block.locked { opacity: .55; }

.service-header { display: flex; align-items: baseline; gap: 8px; }
.service-name { font-size: 12px; font-weight: 600; color: #edf2f7; }
.service-pod { font-size: 10px; word-break: break-all; }

.btn-restart {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; padding: 7px 12px; border-radius: 6px; border: 1px solid #4d9de0;
  background: rgba(77,157,224,.1); color: #4d9de0;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s;
}
.btn-restart:hover:not(:disabled) { background: rgba(77,157,224,.2); }
.btn-restart:disabled { cursor: not-allowed; opacity: .6; }
.btn-restart.done { border-color: #3fb950; background: rgba(63,185,80,.1); color: #3fb950; }
.btn-restart.error { border-color: #f85149; background: rgba(248,81,73,.08); color: #f85149; }

.lock-hint { font-weight: 400; font-size: 11px; }

.status-ok { font-size: 10px; color: #3fb950; }
.status-error { font-size: 10px; color: #f85149; word-break: break-word; }

.countdown-block { display: flex; flex-direction: column; gap: 4px; }
.countdown-label { font-size: 10px; color: #e3a23a; font-family: monospace; }
.countdown-bar-bg {
  width: 100%; height: 3px; background: #1e2330; border-radius: 2px; overflow: hidden;
}
.countdown-bar {
  height: 100%; background: #e3a23a; border-radius: 2px;
  transition: width 1s linear;
}

.service-divider { height: 1px; background: #1e2330; }

.dim { color: #4f5b6e; }
.mono { font-family: monospace; }
</style>
