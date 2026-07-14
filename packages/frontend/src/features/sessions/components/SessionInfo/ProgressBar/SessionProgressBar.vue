<script setup lang="ts">
import ProgressBar from "primevue/progressbar";

defineOptions({ name: "SessionProgressBar" });

const { progress } = defineProps<{ progress: number }>();
</script>

<template>
  <ProgressBar
    :value="progress"
    :show-value="false"
    :pt="{
      root: {
        class: 'h-1.5 rounded-full overflow-hidden relative bg-surface-700',
      },
      value: {
        class:
          'absolute top-0 left-0 h-full bg-secondary-400 rounded-full transition-all duration-300 ease-out',
      },
    }"
  />
</template>
