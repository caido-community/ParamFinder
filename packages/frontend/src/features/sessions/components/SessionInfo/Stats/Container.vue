<script setup lang="ts">
import { computed } from "vue";

import { getSessionStats } from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";

defineOptions({ name: "SessionStats" });

const store = useSessionsStore();
const stats = computed(() => getSessionStats(store.activeSession));

const items = computed(() => {
  const value = stats.value;
  if (value === undefined) {
    return [];
  }

  return [
    { label: "sent", value: value.requestsSent, highlight: false },
    { label: "tested", value: value.parametersTested, highlight: false },
    { label: "left", value: value.remaining, highlight: false },
    { label: "found", value: value.findings, highlight: value.findings > 0 },
  ];
});
</script>

<template>
  <div
    v-if="stats !== undefined"
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
