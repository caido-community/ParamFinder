<script setup lang="ts">
import ConfirmDialog from "primevue/confirmdialog";
import MenuBar from "primevue/menubar";
import type { Component } from "vue";
import { computed, onMounted, ref } from "vue";

import AdvancedScanDialog from "@/features/scan/components/AdvancedScanDialog/AdvancedScanDialog.vue";
import Sessions from "@/features/sessions/components/SessionsPage.vue";
import Settings from "@/features/settings/components/SettingsPage.vue";
import { useSettingsStore } from "@/features/settings/stores/store";
import Usage from "@/features/usage/components/UsagePage.vue";
import Wordlists from "@/features/wordlists/components/WordlistsPage.vue";
import { useWordlistsStore } from "@/features/wordlists/stores/store";
import { useActionResult } from "@/shared/composables/useActionResult";

type Page = "Sessions" | "Wordlists" | "Settings" | "Usage";

const page = ref<Page>("Sessions");

const pages: Page[] = ["Sessions", "Wordlists", "Settings", "Usage"];

const pageComponents: Record<Page, Component> = {
  Sessions,
  Wordlists,
  Settings,
  Usage,
};

const component = computed(() => pageComponents[page.value]);

const settingsStore = useSettingsStore();
const wordlistsStore = useWordlistsStore();
const { showResult } = useActionResult();

onMounted(async () => {
  const [settingsResult, wordlistsResult] = await Promise.all([
    settingsStore.initialize(),
    wordlistsStore.load(),
  ]);
  showResult(settingsResult, {
    errorPrefix: "Failed to load settings",
  });
  showResult(wordlistsResult, {
    errorPrefix: "Failed to load wordlists",
  });
});
</script>

<template>
  <div class="h-full flex flex-col gap-1">
    <MenuBar breakpoint="320px">
      <template #start>
        <div class="flex">
          <div class="px-3 py-2 font-bold text-surface-100">ParamFinder</div>
          <div
            v-for="item in pages"
            :key="item"
            class="px-3 py-2 cursor-pointer text-surface-300 rounded transition-all duration-200 ease-in-out"
            :class="{
              'bg-zinc-800/40': page === item,
              'hover:bg-surface-800/40': page !== item,
            }"
            @mousedown="page = item"
          >
            {{ item }}
          </div>
        </div>
      </template>
    </MenuBar>
    <div class="flex-1 min-h-0">
      <component :is="component" />
    </div>

    <AdvancedScanDialog />
    <ConfirmDialog :pt="{ message: { class: 'whitespace-pre-line' } }" />
  </div>
</template>
