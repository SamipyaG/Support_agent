import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/api/axios';

export const useVipChannelsStore = defineStore('vipChannels', () => {
  const channelNames = ref<string[]>([]);
  const loading = ref(false);

  // Lower-cased set for fast O(1) lookups
  const channelNamesLower = computed(
    () => new Set(channelNames.value.map((n) => n.toLowerCase())),
  );

  function isVipChannel(name: string): boolean {
    return channelNamesLower.value.has(name.toLowerCase());
  }

  async function fetchVipChannels(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<{ channels: string[] }>('/channels/vip');
      channelNames.value = res.data.channels;
    } catch {
      // silently fail — keep stale data
    } finally {
      loading.value = false;
    }
  }

  return { channelNames, loading, isVipChannel, fetchVipChannels };
});
