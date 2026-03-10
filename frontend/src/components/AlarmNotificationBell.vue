<template>
  <div class="bell-wrapper" ref="wrapperRef">
    <!-- Bell button -->
    <button class="bell-btn" :class="{ ringing: store.unreadCount > 0 }" @click="toggleDropdown">
      <svg class="bell-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        />
        <path
          d="M13.73 21a2 2 0 0 1-3.46 0"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        />
      </svg>
      <span v-if="store.unreadCount > 0" class="bell-badge">
        {{ store.unreadCount > 99 ? '99+' : store.unreadCount }}
      </span>
    </button>

    <!-- Dropdown panel -->
    <Transition name="dropdown">
      <div v-if="isOpen" class="bell-dropdown">
        <div class="dropdown-header">
          <span class="dropdown-title">Alarm Notifications</span>
          <button
            v-if="store.unreadCount > 0"
            class="mark-read-btn"
            @click="store.markAllRead()"
          >
            Mark all read
          </button>
        </div>

        <div v-if="store.notifications.length > 0" class="dropdown-list">
          <div
            v-for="n in store.notifications"
            :key="n.id"
            class="notif-item"
            :class="{ unread: !n.isRead, vip: n.isVip }"
            @click="openIncident(n.id)"
          >
            <div class="unread-dot" :class="{ visible: !n.isRead }" />
            <div class="notif-item-body">
              <div class="notif-item-channel">{{ n.channelName }}</div>
              <div class="notif-item-meta">
                <span class="notif-item-state">{{ n.state.replace(/_/g, ' ') }}</span>
                <span class="notif-item-time">{{ formatTime(n.createdAt) }}</span>
              </div>
            </div>
            <span v-if="n.isVip" class="notif-item-vip">VIP</span>
          </div>
        </div>

        <div v-else class="dropdown-empty">
          No recent alarms
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationsStore } from '@/store/notifications';

const store = useNotificationsStore();
const router = useRouter();
const isOpen = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);

function toggleDropdown(): void {
  isOpen.value = !isOpen.value;
}

function openIncident(id: string): void {
  store.markRead(id);
  isOpen.value = false;
  router.push({ name: 'incident-detail', params: { id } });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function handleClickOutside(e: MouseEvent): void {
  if (wrapperRef.value && !wrapperRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', handleClickOutside));
</script>

<style scoped>
.bell-wrapper {
  position: relative;
}

/* ── Bell button ─────────────────────────────────────────── */
.bell-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 8px;
  cursor: pointer;
  color: var(--tx-2);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.bell-btn:hover {
  color: var(--tx-1);
  border-color: var(--tx-3);
  background: var(--bg-hover);
}

.bell-btn.ringing {
  color: #e53e3e;
  border-color: #e53e3e55;
  animation: ring 1.5s ease-in-out 3;
}

.bell-svg {
  width: 16px;
  height: 16px;
}

.bell-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  background: #e53e3e;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--bg-base);
  line-height: 1;
}

@keyframes ring {
  0%, 100% { transform: rotate(0deg); }
  15%       { transform: rotate(15deg); }
  30%       { transform: rotate(-12deg); }
  45%       { transform: rotate(10deg); }
  60%       { transform: rotate(-8deg); }
  75%       { transform: rotate(5deg); }
}

/* ── Dropdown panel ──────────────────────────────────────── */
.bell-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 320px;
  max-height: 400px;
  background: var(--bg-card);
  border: 1px solid var(--bd);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 9998;
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--bd-sub);
  flex-shrink: 0;
}

.dropdown-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--tx-2);
}

.mark-read-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}

.mark-read-btn:hover {
  color: var(--tx-1);
}

.dropdown-list {
  overflow-y: auto;
  flex: 1;
}

.dropdown-list::-webkit-scrollbar { width: 4px; }
.dropdown-list::-webkit-scrollbar-track { background: transparent; }
.dropdown-list::-webkit-scrollbar-thumb { background: var(--bd); border-radius: 2px; }

/* ── Notification items ──────────────────────────────────── */
.notif-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--bd-faint);
  transition: background 0.12s;
}

.notif-item:last-child {
  border-bottom: none;
}

.notif-item:hover {
  background: var(--bg-hover);
}

.notif-item.unread {
  background: var(--accent-bg);
}

.notif-item.unread:hover {
  background: var(--bg-hover);
}

.notif-item.vip {
  border-left: 2px solid #f6ad55;
}

.unread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: transparent;
}

.unread-dot.visible {
  background: var(--accent);
}

.notif-item-body {
  flex: 1;
  min-width: 0;
}

.notif-item-channel {
  font-size: 12px;
  font-weight: 600;
  color: var(--tx-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.notif-item.unread .notif-item-channel {
  color: var(--tx-1);
}

.notif-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.notif-item-state {
  font-size: 10px;
  color: var(--tx-2);
  background: var(--bd-faint);
  padding: 1px 5px;
  border-radius: 3px;
}

.notif-item-time {
  font-size: 10px;
  color: var(--tx-3);
}

.notif-item-vip {
  font-size: 9px;
  background: #f6ad5522;
  color: #f6ad55;
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid #f6ad5544;
  flex-shrink: 0;
}

.dropdown-empty {
  padding: 24px 14px;
  text-align: center;
  font-size: 12px;
  color: var(--tx-3);
}

/* ── Dropdown transition ─────────────────────────────────── */
.dropdown-enter-active {
  transition: all 0.2s cubic-bezier(0.34, 1.2, 0.64, 1);
}
.dropdown-leave-active {
  transition: all 0.15s ease-in;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}
</style>
