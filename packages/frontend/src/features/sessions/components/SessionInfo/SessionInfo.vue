<script setup lang="ts">
import Card from "primevue/card";
import { computed } from "vue";

import SessionActions from "./Actions/SessionActions.vue";
import SessionLogs from "./Outputs/Logs/SessionLogs.vue";
import SessionResults from "./Outputs/Results/SessionResults.vue";
import SessionProgressBar from "./ProgressBar/SessionProgressBar.vue";
import SessionStats from "./Stats/SessionStats.vue";
import SessionStatusBadge from "./StatusBadge/SessionStatusBadge.vue";

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
          <SessionStatusBadge />
          <SessionActions />
        </div>
        <SessionProgressBar />
        <div class="flex items-center justify-between gap-2 shrink-0">
          <SessionStats />
          <span
            class="shrink-0 text-sm tabular-nums font-medium text-surface-100"
          >
            {{ progressPercent }}%
          </span>
        </div>
        <div class="flex flex-1 min-h-0 flex-col gap-3">
          <SessionResults />
          <SessionLogs />
        </div>
      </div>
    </template>
  </Card>
</template>
