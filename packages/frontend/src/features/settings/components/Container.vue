<script setup lang="ts">
import Card from "primevue/card";

import AdvancedSettings from "./AdvancedSettings.vue";
import RequestSettings from "./RequestSettings.vue";

import { useSettingsStore } from "@/features/settings/stores/store";
import PageHeader from "@/shared/components/PageHeader.vue";

const settingsStore = useSettingsStore();
</script>

<template>
  <div class="h-full flex flex-col gap-1 min-h-0">
    <PageHeader
      title="Settings"
      description="Configure how ParamFinder probes targets and detects findings."
    />

    <div
      v-if="settingsStore.error !== undefined"
      class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
    >
      {{ settingsStore.error }}
    </div>

    <div class="flex-1 min-h-0 flex flex-col gap-1">
      <Card
        class="shrink-0"
        :pt="{
          body: { class: 'p-0' },
          content: { class: 'p-0' },
        }"
      >
        <template #content>
          <RequestSettings />
        </template>
      </Card>

      <Card
        class="flex-1 min-h-0 h-full"
        :pt="{
          root: { style: 'display: flex; flex-direction: column;' },
          body: { class: 'flex-1 p-0 flex flex-col min-h-0' },
          content: { class: 'flex-1 min-h-0 overflow-auto' },
        }"
      >
        <template #content>
          <AdvancedSettings />
        </template>
      </Card>
    </div>
  </div>
</template>
