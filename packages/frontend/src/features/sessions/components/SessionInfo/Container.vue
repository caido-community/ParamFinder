<script setup lang="ts">
import Card from "primevue/card";
import { computed } from "vue";

import { SessionActions } from "./Actions";
import { Outputs } from "./Outputs";
import { ProgressBar } from "./ProgressBar";
import { Stats } from "./Stats";
import { StatusBadge } from "./StatusBadge";

import { getSessionStats } from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";

defineOptions({ name: "SessionInfo" });

const store = useSessionsStore();

const fullHeightCardPt = {
  root: { style: "display: flex; flex-direction: column; height: 100%;" },
  body: { class: "flex-1 p-0 flex flex-col min-h-0" },
  content: { class: "flex-1 flex flex-col overflow-hidden min-h-0" },
};

const session = computed(() => store.activeSession);
const stats = computed(() => getSessionStats(session.value));
const progressPercent = computed(() =>
  stats.value !== undefined ? Math.round(stats.value.progress) : 0,
);
</script>

<template>
  <Card
    v-if="session !== undefined && stats !== undefined"
    class="h-full"
    :pt="fullHeightCardPt"
  >
    <template #content>
      <div class="flex flex-1 min-h-0 flex-col gap-3 p-3">
        <div class="flex items-center justify-between gap-2 shrink-0">
          <StatusBadge />
          <SessionActions />
        </div>
        <div
          v-if="session.error"
          class="shrink-0 rounded border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-200"
        >
          {{ session.error.message }}
        </div>
        <ProgressBar />
        <div class="flex items-center justify-between gap-2 shrink-0">
          <Stats />
          <span
            class="shrink-0 text-sm tabular-nums font-medium text-surface-100"
          >
            {{ progressPercent }}%
          </span>
        </div>
        <div class="flex flex-1 min-h-0 flex-col">
          <Outputs />
        </div>
      </div>
    </template>
  </Card>
</template>
