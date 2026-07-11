import { defineStore } from "pinia";
import { error, type Settings } from "shared";
import { computed, readonly, ref } from "vue";

import { loadSettings, saveSettings } from "./store.effects";
import {
  initialModel,
  type SettingsMessage,
  type SettingsModel,
} from "./store.model";
import { update as updateModel } from "./store.update";

import { useSDK } from "@/plugins/sdk";

export const useSettingsStore = defineStore("settings", () => {
  const sdk = useSDK();
  const model = ref<SettingsModel>(initialModel);

  const dispatch = (message: SettingsMessage) => {
    model.value = updateModel(model.value, message);
  };

  const data = computed(() => model.value.data);
  const path = computed(() => model.value.path);
  const loading = computed(() => model.value.loading);
  const saving = computed(() => model.value.saving);
  const storeError = computed(() => model.value.error);

  const initialize = () => loadSettings(sdk, dispatch);

  const update = (changes: Partial<Settings>) => {
    if (model.value.data === undefined) {
      return Promise.resolve(error("Settings are not loaded yet.", "CONFLICT"));
    }
    if (model.value.saving) {
      return Promise.resolve(
        error("Another settings update is already in progress.", "CONFLICT"),
      );
    }
    return saveSettings(sdk, dispatch, changes);
  };

  return {
    state: readonly(model),
    data,
    path,
    error: storeError,
    loading,
    saving,
    initialize,
    update,
  };
});
