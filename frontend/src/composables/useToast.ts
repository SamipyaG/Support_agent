import { reactive } from 'vue';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

const toasts = reactive<Toast[]>([]);
let nextId = 1;

export function useToast() {
  function show(type: Toast['type'], title: string, message?: string, durationMs = 4000): void {
    const id = nextId++;
    toasts.push({ id, type, title, message });
    setTimeout(() => remove(id), durationMs);
  }

  function remove(id: number): void {
    const idx = toasts.findIndex((t) => t.id === id);
    if (idx !== -1) toasts.splice(idx, 1);
  }

  return { toasts, show, remove };
}
