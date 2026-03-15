<template>
  <Teleport to="body">
    <div class="tc-wrap">
      <TransitionGroup name="tc" tag="div" class="tc-list">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="tc-toast"
          :class="`tc-${t.type}`"
          @click="remove(t.id)"
        >
          <span class="tc-icon">{{ t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ' }}</span>
          <div class="tc-body">
            <div class="tc-title">{{ t.title }}</div>
            <div v-if="t.message" class="tc-msg">{{ t.message }}</div>
          </div>
          <button class="tc-close" @click.stop="remove(t.id)">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/useToast';
const { toasts, remove } = useToast();
</script>

<style scoped>
.tc-wrap { position: fixed; top: 20px; right: 24px; z-index: 10000; pointer-events: none; }
.tc-list { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }

.tc-toast {
  display: flex; align-items: flex-start; gap: 10px;
  min-width: 280px; max-width: 380px;
  padding: 12px 14px; border-radius: 8px;
  border: 1px solid; cursor: pointer; pointer-events: all;
  box-shadow: 0 6px 20px rgba(0,0,0,.45);
  transition: opacity .2s;
}
.tc-toast:hover { opacity: .85; }

.tc-success { background: rgba(16,28,18,.97); border-color: rgba(63,185,80,.4); }
.tc-error   { background: rgba(28,14,14,.97); border-color: rgba(248,81,73,.4); }
.tc-info    { background: rgba(12,20,32,.97); border-color: rgba(77,157,224,.4); }

.tc-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
.tc-success .tc-icon { color: #3fb950; }
.tc-error   .tc-icon { color: #f85149; }
.tc-info    .tc-icon { color: #4d9de0; }

.tc-body  { flex: 1; min-width: 0; }
.tc-title { font-size: 12px; font-weight: 600; color: #edf2f7; }
.tc-msg   { font-size: 11px; color: #8896aa; margin-top: 2px; line-height: 1.4; }

.tc-close {
  background: none; border: none; color: #4f5b6e; cursor: pointer;
  font-size: 16px; line-height: 1; flex-shrink: 0; padding: 0 2px;
}
.tc-close:hover { color: #8896aa; }

/* Transitions */
.tc-enter-active { animation: tc-in .25s cubic-bezier(.22,.68,0,1.2); }
.tc-leave-active { animation: tc-out .2s ease-in; }
@keyframes tc-in  { from { opacity:0; transform: translateX(30px) scale(.95); } to { opacity:1; transform: none; } }
@keyframes tc-out { from { opacity:1; transform: none; } to { opacity:0; transform: translateX(20px) scale(.95); } }
</style>
