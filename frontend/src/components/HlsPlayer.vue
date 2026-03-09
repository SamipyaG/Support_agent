<template>
  <div class="hls-player">
    <video
      ref="videoEl"
      class="hls-video"
      controls
      muted
      playsinline
    ></video>
    <div v-if="error" class="hls-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import Hls from 'hls.js';

const props = defineProps<{ src: string }>();

const videoEl = ref<HTMLVideoElement | null>(null);
const error = ref('');
let hls: Hls | null = null;

function load(src: string): void {
  error.value = '';
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (!src || !videoEl.value) return;

  if (Hls.isSupported()) {
    hls = new Hls({ enableWorker: false });
    hls.loadSource(src);
    hls.attachMedia(videoEl.value);
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) error.value = `Stream error: ${data.details}`;
    });
  } else if (videoEl.value.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari)
    videoEl.value.src = src;
  } else {
    error.value = 'HLS not supported in this browser';
  }
}

onMounted(() => load(props.src));
watch(() => props.src, (src) => load(src));
onBeforeUnmount(() => { hls?.destroy(); });
</script>

<style scoped>
.hls-player { position: relative; width: 100%; }
.hls-video {
  width: 100%; height: 180px;
  background: #0d1017; border: 1px solid #252b36; border-radius: 6px;
  display: block;
}
.hls-error {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; background: rgba(13,16,23,.85);
  color: #f85149; font-size: 11px; text-align: center;
  padding: 8px; border-radius: 6px;
}
</style>
