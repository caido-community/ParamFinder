<script setup lang="ts">
import { computed } from "vue";

import type { SessionStats } from "@/features/sessions/lib/sessionStats";

defineOptions({ name: "SessionStats" });

const { stats } = defineProps<{ stats: SessionStats }>();

const items = computed(() => [
  { label: "sent", value: stats.requestsSent, highlight: false },
  { label: "tested", value: stats.parametersTested, highlight: false },
  { label: "left", value: stats.remaining, highlight: false },
  { label: "found", value: stats.findings, highlight: stats.findings > 0 },
]);
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-snug text-surface-500"
  >
    <span v-for="item in items" :key="item.label">
      <span
        class="tabular-nums font-medium"
        :class="item.highlight ? 'text-secondary-400' : 'text-surface-300'"
      >
        {{ item.value }}
      </span>
      {{ item.label }}
    </span>
  </div>
</template>
