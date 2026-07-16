<script setup lang="ts">
import Button from "primevue/button";
import type { ApiResult } from "shared";
import { computed } from "vue";

import { getSessionCapabilities } from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useActionResult } from "@/shared/composables/useActionResult";

defineOptions({ name: "SessionActions" });

type ActionButton = {
  key: "pause" | "resume" | "rerun" | "cancel" | "delete";
  label: string;
  icon: string;
  severity: "secondary" | "info" | "danger";
  handler: () => Promise<ApiResult<void>>;
};

const store = useSessionsStore();
const { showResult } = useActionResult();

const buttons = computed<ActionButton[]>(() => {
  const capabilities = getSessionCapabilities(store.activeDescriptor);
  const visible: ActionButton[] = [];

  if (capabilities.isRunning) {
    visible.push({
      key: "pause",
      label: "Pause",
      icon: "fas fa-pause",
      severity: "secondary",
      handler: store.pauseActive,
    });
  }
  if (capabilities.isPaused) {
    visible.push({
      key: "resume",
      label: "Resume",
      icon: "fas fa-play",
      severity: "info",
      handler: store.resumeActive,
    });
  }
  if (capabilities.canRerun) {
    visible.push({
      key: "rerun",
      label: "Rerun",
      icon: "fas fa-redo",
      severity: "info",
      handler: store.rerunActive,
    });
  }
  if (capabilities.canCancel) {
    visible.push({
      key: "cancel",
      label: "Cancel",
      icon: "fas fa-stop",
      severity: "danger",
      handler: store.cancelActive,
    });
  }
  visible.push({
    key: "delete",
    label: "Delete",
    icon: "fas fa-trash",
    severity: "danger",
    handler: store.deleteActive,
  });

  return visible;
});

const execute = async (button: ActionButton) => {
  showResult(await button.handler());
};
</script>

<template>
  <div class="flex flex-wrap gap-1">
    <Button
      v-for="button in buttons"
      :key="button.key"
      :label="button.label"
      :icon="button.icon"
      size="small"
      :severity="button.severity"
      outlined
      :loading="store.activeActionLoading === button.key"
      :disabled="store.activeActionLoading !== undefined"
      @click="execute(button)"
    />
  </div>
</template>
