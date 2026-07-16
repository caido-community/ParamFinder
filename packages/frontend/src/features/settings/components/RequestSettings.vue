<script setup lang="ts">
import { storeToRefs } from "pinia";
import InputNumber from "primevue/inputnumber";
import type { Settings } from "shared";

import { useSettingsStore } from "@/features/settings/stores/store";
import { useActionResult } from "@/shared/composables/useActionResult";

const settingsStore = useSettingsStore();
const { showResult } = useActionResult();
const { data } = storeToRefs(settingsStore);

const updateSettings = async (updates: Partial<Settings>) => {
  showResult(await settingsStore.update(updates), {
    errorPrefix: "Failed to update settings",
  });
};

const setField = <K extends keyof Settings>(field: K, value: Settings[K]) => {
  return updateSettings({ [field]: value });
};

const numberPt = {
  root: { class: "w-48" },
} as const;
</script>

<template>
  <div class="p-4 space-y-4">
    <div>
      <h3 class="text-md font-semibold">Request Settings</h3>
      <p class="text-sm text-surface-400">
        Tune request timing and learning behavior.
      </p>
    </div>

    <div v-if="data !== undefined" class="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <div class="space-y-3">
        <div class="space-y-0">
          <label class="text-sm font-medium block">Request delay (ms)</label>
          <p class="text-xs text-surface-400 mt-px">
            Pause between consecutive requests.
          </p>
        </div>
        <InputNumber
          :model-value="data.delay"
          :min="0"
          :pt="numberPt"
          @update:model-value="(value) => setField('delay', value ?? 0)"
        />
      </div>

      <div class="space-y-3">
        <div class="space-y-0">
          <label class="text-sm font-medium block">
            Request timeout (seconds)
          </label>
          <p class="text-xs text-surface-400 mt-px">
            Stop an individual request if it exceeds this duration.
          </p>
        </div>
        <InputNumber
          :model-value="data.requestTimeoutSeconds"
          :min="1"
          :pt="numberPt"
          @update:model-value="
            (value) => setField('requestTimeoutSeconds', value ?? 1)
          "
        />
      </div>

      <div class="space-y-3">
        <div class="space-y-0">
          <label class="text-sm font-medium block">
            Scan timeout (seconds, optional)
          </label>
          <p class="text-xs text-surface-400 mt-px">
            Stop the complete learning and discovery run after this duration.
          </p>
        </div>
        <InputNumber
          :model-value="data.scanTimeoutSeconds"
          :min="1"
          :pt="numberPt"
          @update:model-value="
            (value) => setField('scanTimeoutSeconds', value ?? undefined)
          "
        />
      </div>

      <div class="space-y-3">
        <div class="space-y-0">
          <label class="text-sm font-medium block">Learn requests count</label>
          <p class="text-xs text-surface-400 mt-px">
            How many baseline responses to gather before discovery. Minimum 3,
            recommended 6+.
          </p>
        </div>
        <InputNumber
          :model-value="data.learnRequestsCount"
          :min="3"
          :pt="numberPt"
          @update:model-value="
            (value) => setField('learnRequestsCount', value ?? 3)
          "
        />
      </div>
    </div>
  </div>
</template>
