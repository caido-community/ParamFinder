import { defineStore } from "pinia";
import { error, ok, type Settings } from "shared";
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
  let pendingUpdate:
    | {
        changes: Partial<Settings>;
        result: ReturnType<typeof saveSettings>;
      }
    | undefined;

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

    const changedSettings = getChangedSettings(model.value.data, changes);
    if (Object.keys(changedSettings).length === 0) {
      return Promise.resolve(ok(model.value.data));
    }

    if (pendingUpdate !== undefined) {
      if (settingsChangesEqual(pendingUpdate.changes, changedSettings)) {
        return pendingUpdate.result;
      }
      return Promise.resolve(
        error("Another settings update is already in progress.", "CONFLICT"),
      );
    }

    const result = saveSettings(sdk, dispatch, changedSettings).finally(() => {
      pendingUpdate = undefined;
    });
    pendingUpdate = { changes: changedSettings, result };
    return result;
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

function getChangedSettings(
  current: Settings,
  changes: Partial<Settings>,
): Partial<Settings> {
  const changedSettings = { ...changes };
  for (const key of Object.keys(changedSettings) as (keyof Settings)[]) {
    if (settingsValueEqual(current[key], changedSettings[key])) {
      delete changedSettings[key];
    }
  }
  return changedSettings;
}

function settingsChangesEqual(
  left: Partial<Settings>,
  right: Partial<Settings>,
): boolean {
  const leftKeys = Object.keys(left) as (keyof Settings)[];
  const rightKeys = Object.keys(right) as (keyof Settings)[];
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && settingsValueEqual(left[key], right[key]),
    )
  );
}

function settingsValueEqual(
  left: Settings[keyof Settings] | undefined,
  right: Settings[keyof Settings] | undefined,
): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }
  return Object.is(left, right);
}
