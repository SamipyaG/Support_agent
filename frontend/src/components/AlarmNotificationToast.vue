<template>
  <Teleport to="body">
    <Transition name="toast">
      <div
        v-if="store.currentToast"
        class="toast-card"
        :class="{ vip: store.currentToast.isVip }"
      >
        <div class="toast-icon">🔔</div>

        <div class="toast-body">
          <div class="toast-title">
            New Alarm
            <span v-if="store.currentToast.isVip" class="vip-badge">VIP</span>
          </div>
          <div class="toast-channel">{{ store.currentToast.channelName }}</div>
          <div class="toast-meta">
            <span class="toast-state">{{ store.currentToast.state.replace(/_/g, ' ') }}</span>
            <span class="toast-time">{{ formatTime(store.currentToast.createdAt) }}</span>
          </div>
        </div>

        <button class="toast-close" @click="store.dismissToast()">✕</button>

        <div class="toast-progress">
          <div class="toast-progress-bar" :style="{ animationDuration: '5s' }" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useNotificationsStore } from '@/store/notifications';

const store = useNotificationsStore();

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.toast-card {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  width: 300px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px 16px;
  background: #1a1f2e;
  border: 1px solid #e53e3e55;
  border-left: 3px solid #e53e3e;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.toast-card.vip {
  border-color: #f6ad55;
  border-left-color: #f6ad55;
  background: #1f1a10;
}

.toast-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.toast-body {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #e53e3e;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}

.toast-card.vip .toast-title {
  color: #f6ad55;
}

.vip-badge {
  font-size: 9px;
  background: #f6ad5533;
  color: #f6ad55;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid #f6ad5566;
}

.toast-channel {
  font-size: 13px;
  font-weight: 600;
  color: #edf2f7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.toast-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toast-state {
  font-size: 10px;
  color: #a0aec0;
  background: #ffffff10;
  padding: 1px 6px;
  border-radius: 3px;
}

.toast-time {
  font-size: 10px;
  color: #718096;
}

.toast-close {
  background: none;
  border: none;
  color: #718096;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  flex-shrink: 0;
  line-height: 1;
  margin-top: 1px;
  transition: color 0.15s;
}

.toast-close:hover {
  color: #edf2f7;
}

/* Progress bar */
.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #ffffff10;
}

.toast-progress-bar {
  height: 100%;
  background: #e53e3e;
  width: 100%;
  transform-origin: left;
  animation: shrink linear forwards;
}

.toast-card.vip .toast-progress-bar {
  background: #f6ad55;
}

@keyframes shrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

/* Transition */
.toast-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast-leave-active {
  transition: all 0.25s ease-in;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}
</style>
