<script setup lang="ts">
import ProgressBar from "primevue/progressbar";
import { computed } from "vue";

import { getSessionStats } from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";

defineOptions({ name: "SessionProgressBar" });

const store = useSessionsStore();
const stats = computed(() => getSessionStats(store.activeSession));
</script>

<template>
  <ProgressBar
    v-if="stats !== undefined"
    :value="stats.progress"
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
