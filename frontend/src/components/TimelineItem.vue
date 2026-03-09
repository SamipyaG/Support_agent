<template>
  <div class="timeline-item">
    <div class="tl-line">
      <div class="tl-dot" :class="dotClass"></div>
      <div class="tl-connector" v-if="!isLast"></div>
    </div>
    <div class="tl-content">
      <div class="tl-header">
        <span class="tl-label">{{ label }}</span>
        <span class="tl-time">{{ formattedTime }}</span>
      </div>
      <div class="tl-desc">{{ description }}</div>
      <div v-if="extra" class="tl-extra">{{ extra }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  label: string;
  description: string;
  timestamp: string;
  type?: 'action' | 'state' | 'approval' | 'escalation' | 'info';
  extra?: string;
  isLast?: boolean;
}>();

const dotClass = computed(() => `dot-${props.type || 'info'}`);

const formattedTime = computed(() => {
  return new Date(props.timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
});
</script>

<style scoped>
.timeline-item { display: flex; gap: 12px; min-height: 48px; }
.tl-line { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.tl-dot {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 3px;
}
.dot-action   { background: #4d9de0; }
.dot-state    { background: #e3a23a; }
.dot-approval { background: #3fb950; }
.dot-escalation { background: #f85149; }
.dot-info     { background: #4f5b6e; }
.tl-connector { flex: 1; width: 1px; background: #252b36; margin-top: 4px; min-height: 20px; }

.tl-content { flex: 1; padding-bottom: 16px; }
.tl-header { display: flex; justify-content: space-between; margin-bottom: 2px; }
.tl-label { font-size: 12px; font-weight: 600; }
.tl-time { font-family: monospace; font-size: 10px; color: #4f5b6e; }
.tl-desc { font-size: 11px; color: #8896aa; line-height: 1.45; }
.tl-extra { font-family: monospace; font-size: 10px; color: #4f5b6e; margin-top: 3px; }
</style>
