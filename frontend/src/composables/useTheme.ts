import { ref, watch } from 'vue';

const STORAGE_KEY = 'gmana-theme';
const isDark = ref<boolean>(localStorage.getItem(STORAGE_KEY) !== 'light');

function applyTheme(dark: boolean): void {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
}

// Apply on init
applyTheme(isDark.value);

watch(isDark, (val) => applyTheme(val));

export function useTheme() {
  function toggle(): void {
    isDark.value = !isDark.value;
  }
  return { isDark, toggle };
}
