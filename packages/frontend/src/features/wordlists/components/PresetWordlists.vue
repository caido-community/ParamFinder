<script setup lang="ts">
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import { ref } from "vue";

import { wordlistPresets } from "../data/presets";
import { useWordlistsStore } from "../stores/store";

import { useActionResult } from "@/shared/composables/useActionResult";

const wordlistsStore = useWordlistsStore();
const { mutation } = storeToRefs(wordlistsStore);
const { showResult } = useActionResult();

const importing = ref<string | undefined>(undefined);

const importPreset = async (preset: (typeof wordlistPresets)[number]) => {
  importing.value = preset.name;
  try {
    const filename = `${preset.name.replaceAll("/", "-")}.txt`;
    showResult(await wordlistsStore.importRemote(filename, preset.url), {
      errorPrefix: "Failed to import preset",
    });
  } finally {
    importing.value = undefined;
  }
};
</script>

<template>
  <div class="p-4">
    <div class="mb-3">
      <h3 class="text-md font-semibold">Preset Wordlists</h3>
      <p class="text-sm text-surface-400">
        Popular wordlists curated for parameter discovery.
      </p>
    </div>

    <div class="grid gap-2 grid-cols-5">
      <div
        v-for="preset in wordlistPresets"
        :key="preset.name"
        class="flex flex-col gap-2 p-3 rounded border border-surface-700 bg-surface-800/50"
      >
        <div class="flex-1">
          <div class="text-sm text-surface-100">
            {{ preset.name }}
          </div>
          <p class="text-xs text-surface-400 mt-1">
            {{ preset.description }}
          </p>
        </div>
        <Button
          label="Import"
          icon="fas fa-download"
          size="small"
          severity="secondary"
          outlined
          :loading="importing === preset.name"
          :disabled="mutation !== undefined"
          @click="importPreset(preset)"
        />
      </div>
    </div>
  </div>
</template>
