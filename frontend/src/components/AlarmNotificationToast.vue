<template>
  <Teleport to="body">
    <div class="notif-stack">
      <TransitionGroup name="notif">
        <div
          v-for="n in notifications.queue"
          :key="n.id"
          class="notif-card"
          :class="{ vip: n.isVip }"
        >
          <div class="notif-icon">🔔</div>

          <div class="notif-body">
            <div class="notif-title">
              New Alarm
              <span v-if="n.isVip" class="vip-badge">VIP</span>
            </div>
            <div class="notif-channel">{{ n.channelName }}</div>
            <div class="notif-meta">
              <span class="notif-state">{{ n.state.replace(/_/g, ' ') }}</span>
              <span class="notif-time">{{ formatTime(n.createdAt) }}</span>
            </div>
          </div>

          <button class="notif-close" @click="notifications.dismiss(n.id)">✕</button>

          <div class="notif-progress">
            <div class="notif-progress-bar" :style="{ animationDuration: '8s' }" />
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useNotificationsStore } from '@/store/notifications';

const notifications = useNotificationsStore();

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.notif-stack {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 300px;
  pointer-events: none;
}

.notif-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px 16px;
  background: #1a1f2e;
  border: 1px solid #e53e3e55;
  border-left: 3px solid #e53e3e;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  pointer-events: all;
  overflow: hidden;
}

.notif-card.vip {
  border-color: #f6ad55;
  border-left-color: #f6ad55;
  background: #1f1a10;
}

.notif-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.notif-body {
  flex: 1;
  min-width: 0;
}

.notif-title {
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

.notif-card.vip .notif-title {
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

.notif-channel {
  font-size: 13px;
  font-weight: 600;
  color: #edf2f7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.notif-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notif-state {
  font-size: 10px;
  color: #a0aec0;
  background: #ffffff10;
  padding: 1px 6px;
  border-radius: 3px;
}

.notif-time {
  font-size: 10px;
  color: #718096;
}

.notif-close {
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

.notif-close:hover {
  color: #edf2f7;
}

/* Progress bar */
.notif-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: #ffffff10;
}

.notif-progress-bar {
  height: 100%;
  background: #e53e3e;
  width: 100%;
  transform-origin: left;
  animation: shrink linear forwards;
}

.notif-card.vip .notif-progress-bar {
  background: #f6ad55;
}

@keyframes shrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

/* Transition animations */
.notif-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.notif-leave-active {
  transition: all 0.25s ease-in;
}
.notif-enter-from {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}
.notif-leave-to {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}
.notif-move {
  transition: transform 0.3s ease;
}
</style>
