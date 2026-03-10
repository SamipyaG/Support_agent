import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface AlarmNotification {
  id: string;         // incident _id
  channelName: string;
  state: string;
  createdAt: string;
  isVip: boolean;
}

let dismissTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

export const useNotificationsStore = defineStore('notifications', () => {
  const queue = ref<AlarmNotification[]>([]);

  function push(n: AlarmNotification): void {
    // Don't duplicate if already in queue
    if (queue.value.some((x) => x.id === n.id)) return;
    queue.value.unshift(n);
    playBeep();

    const timer = setTimeout(() => dismiss(n.id), 8000);
    dismissTimers.set(n.id, timer);
  }

  function dismiss(id: string): void {
    const idx = queue.value.findIndex((n) => n.id === id);
    if (idx >= 0) queue.value.splice(idx, 1);
    const timer = dismissTimers.get(id);
    if (timer) { clearTimeout(timer); dismissTimers.delete(id); }
  }

  return { queue, push, dismiss };
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
