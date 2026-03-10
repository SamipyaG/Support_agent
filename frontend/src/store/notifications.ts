import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface AlarmNotification {
  id: string;         // incident _id
  channelName: string;
  state: string;
  createdAt: string;
  isVip: boolean;
  isRead: boolean;
}

export const useNotificationsStore = defineStore('notifications', () => {
  // Persistent list — stays until cleared (max 50)
  const notifications = ref<AlarmNotification[]>([]);
  // Current toast id (null = no toast visible)
  const toastId = ref<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const unreadCount = computed(() => notifications.value.filter((n) => !n.isRead).length);

  const currentToast = computed(() =>
    toastId.value ? (notifications.value.find((n) => n.id === toastId.value) ?? null) : null,
  );

  function push(n: Omit<AlarmNotification, 'isRead'>): void {
    if (notifications.value.some((x) => x.id === n.id)) return;
    notifications.value.unshift({ ...n, isRead: false });
    if (notifications.value.length > 50) notifications.value.pop();
    _showToast(n.id);
    playBeep();
  }

  function _showToast(id: string): void {
    if (toastTimer) clearTimeout(toastTimer);
    toastId.value = id;
    toastTimer = setTimeout(() => {
      toastId.value = null;
      toastTimer = null;
    }, 5000);
  }

  function dismissToast(): void {
    if (toastTimer) clearTimeout(toastTimer);
    toastId.value = null;
    toastTimer = null;
  }

  function markRead(id: string): void {
    const n = notifications.value.find((x) => x.id === id);
    if (n) n.isRead = true;
  }

  function markAllRead(): void {
    notifications.value.forEach((n) => {
      n.isRead = true;
    });
  }

  return { notifications, toastId, currentToast, unreadCount, push, dismissToast, markRead, markAllRead };
});

function playBeep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => ctx.close();
  } catch {
    // Browser may block AudioContext without user interaction — silently ignore
  }
}
