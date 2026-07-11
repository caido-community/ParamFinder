<script setup lang="ts">
import { storeToRefs } from "pinia";
import InputNumber from "primevue/inputnumber";
import MultiSelect from "primevue/multiselect";
import ToggleSwitch from "primevue/toggleswitch";
import { AnomalyType, type Settings } from "shared";

import { useSettingsActions } from "../composables/useSettingsActions";

import { useSettingsStore } from "@/features/settings/stores/store";

const settingsStore = useSettingsStore();
const { updateSettings } = useSettingsActions();
const { data, saving } = storeToRefs(settingsStore);

type BooleanSettingKey = {
  [K in keyof Settings]-?: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const toggles: {
  field: BooleanSettingKey;
  label: string;
  description: string;
}[] = [
  {
    field: "wafDetection",
    label: "WAF detection",
    description:
      "Automatically detect and adjust to web application firewalls.",
  },
  {
    field: "ignoreCloudflareBlocks",
    label: "Ignore Cloudflare WAF blocks",
    description:
      "Skip Cloudflare 403 block pages instead of reporting them as findings, so payload-like wordlist entries that trip the firewall don't create noise.",
  },
  {
    field: "additionalChecks",
    label: "Additional checks",
    description:
      "Perform extra learning checks to reduce false positives at the cost of more requests.",
  },
  {
    field: "autopilotEnabled",
    label: "Autopilot",
    description:
      "Automatically adjust scan parameters based on target responses.",
  },
  {
    field: "updateContentLength",
    label: "Update Content-Length",
    description:
      "Automatically rewrite the Content-Length header when mutating bodies.",
  },
  {
    field: "addCacheBusterParameter",
    label: "Always add cache-buster parameter",
    description:
      "Append a random parameter to defeat caches during header attacks.",
  },
  {
    field: "debug",
    label: "Debug mode",
    description: "Emit extensive debug logging from the engine.",
  },
];

const anomalyOptions = Object.values(AnomalyType).map((type) => ({
  label: type,
  value: type,
}));

const getBool = (field: BooleanSettingKey) => data.value?.[field] === true;

const setBool = (field: BooleanSettingKey, value: boolean) => {
  void updateSettings({ [field]: value });
};

const setMaxSize = (
  field: "maxQuerySize" | "maxHeaderSize" | "maxBodySize",
  value: number | undefined,
) => {
  void updateSettings({ [field]: value });
};

const setIgnoreAnomalyTypes = (value: AnomalyType[]) => {
  void updateSettings({ ignoreAnomalyTypes: value });
};

const onAutoDetectMaxSize = (value: boolean) => {
  if (value) {
    void updateSettings({
      autoDetectMaxSize: value,
      maxQuerySize: undefined,
      maxHeaderSize: undefined,
      maxBodySize: undefined,
    });
    return;
  }
  void updateSettings({ autoDetectMaxSize: value });
};

const numberPt = {
  root: { class: "w-full" },
} as const;
</script>

<template>
  <div v-if="data !== undefined" class="p-4 space-y-4">
    <div>
      <h3 class="text-md font-semibold">Advanced Settings</h3>
      <p class="text-sm text-surface-400">
        Fine-tune detection behavior and limits.
      </p>
    </div>

    <div class="rounded border border-surface-700 divide-y divide-surface-700">
      <div class="flex items-center justify-between gap-6 px-4 py-3">
        <div class="min-w-0">
          <label class="text-sm font-medium">Auto-detect max sizes</label>
          <p class="text-sm text-surface-400">
            Discover the maximum URL, header, and body sizes the server accepts.
          </p>
        </div>
        <ToggleSwitch
          :model-value="data.autoDetectMaxSize"
          :disabled="saving"
          @update:model-value="onAutoDetectMaxSize"
        />
      </div>

      <div
        v-if="!data.autoDetectMaxSize"
        class="grid gap-4 sm:grid-cols-3 px-4 py-3 bg-surface-800/30"
      >
        <div class="space-y-1">
          <label class="text-xs font-medium block text-surface-300"
            >Max URL size</label
          >
          <InputNumber
            :model-value="data.maxQuerySize ?? 0"
            :min="0"
            :disabled="saving"
            :pt="numberPt"
            @update:model-value="
              (value) => setMaxSize('maxQuerySize', value ?? undefined)
            "
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium block text-surface-300"
            >Max header size</label
          >
          <InputNumber
            :model-value="data.maxHeaderSize ?? 0"
            :min="0"
            :disabled="saving"
            :pt="numberPt"
            @update:model-value="
              (value) => setMaxSize('maxHeaderSize', value ?? undefined)
            "
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs font-medium block text-surface-300"
            >Max body size</label
          >
          <InputNumber
            :model-value="data.maxBodySize ?? 0"
            :min="0"
            :disabled="saving"
            :pt="numberPt"
            @update:model-value="
              (value) => setMaxSize('maxBodySize', value ?? undefined)
            "
          />
        </div>
      </div>

      <div
        v-for="toggle in toggles"
        :key="toggle.field"
        class="flex items-center justify-between gap-6 px-4 py-3"
      >
        <div class="min-w-0">
          <label class="text-sm font-medium">{{ toggle.label }}</label>
          <p class="text-sm text-surface-400">{{ toggle.description }}</p>
        </div>
        <ToggleSwitch
          :model-value="getBool(toggle.field)"
          :disabled="saving"
          @update:model-value="(value) => setBool(toggle.field, value)"
        />
      </div>
    </div>

    <div>
      <label class="text-sm font-medium block mb-1">
        Anomaly types to ignore
      </label>
      <p class="text-xs text-surface-400 mb-2">
        Skip findings caused by selected anomaly types to suppress false
        positives.
      </p>
      <MultiSelect
        :model-value="data.ignoreAnomalyTypes"
        :options="anomalyOptions"
        option-label="label"
        option-value="value"
        display="chip"
        filter
        class="w-full"
        placeholder="Select anomaly types to ignore"
        :disabled="saving"
        @update:model-value="setIgnoreAnomalyTypes"
      />
    </div>
  </div>
</template>
