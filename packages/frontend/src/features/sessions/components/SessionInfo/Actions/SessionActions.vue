<script setup lang="ts">
import Button from "primevue/button";

import { useActions } from "./useActions";

defineOptions({ name: "SessionActions" });

const { activeActionLoading, controlsDisabled, buttons, execute } =
  useActions();
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
      :loading="activeActionLoading === button.key"
      :disabled="controlsDisabled"
      @click="execute(button)"
    />
  </div>
</template>
