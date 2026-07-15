import { defineStore } from "pinia";
import { type ApiResult, error, ok, type Settings } from "shared";
import { ref } from "vue";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

export const useSettingsStore = defineStore("settings", () => {
  const sdk = useSDK();
  const data = ref<Settings>();
  const saving = ref(false);
  let pendingUpdate:
    | {
        changes: Partial<Settings>;
        result: Promise<ApiResult<Settings>>;
      }
    | undefined;

  const initialize = async (): Promise<ApiResult<void>> => {
    try {
      const result = await sdk.backend.getSettings();
      if (!result.success) return result;

      data.value = result.value;
      return ok(undefined);
    } catch (cause: unknown) {
      return error(toErrorMessage(cause));
    }
  };

  const update = (changes: Partial<Settings>) => {
    if (data.value === undefined) {
      return Promise.resolve(error("Settings are not loaded yet.", "CONFLICT"));
    }

    const changedSettings = getChangedSettings(data.value, changes);
    if (Object.keys(changedSettings).length === 0) {
      return Promise.resolve(ok(data.value));
    }

    if (pendingUpdate !== undefined) {
      if (settingsChangesEqual(pendingUpdate.changes, changedSettings)) {
        return pendingUpdate.result;
      }
      return Promise.resolve(
        error("Another settings update is already in progress.", "CONFLICT"),
      );
    }

    const result = save(changedSettings).finally(() => {
      pendingUpdate = undefined;
    });
    pendingUpdate = { changes: changedSettings, result };
    return result;
  };

  const save = async (
    changes: Partial<Settings>,
  ): Promise<ApiResult<Settings>> => {
    saving.value = true;
    try {
      const result = await sdk.backend.patchSettings(changes);
      if (result.success) data.value = result.value;
      return result;
    } catch (cause: unknown) {
      return error(toErrorMessage(cause));
    } finally {
      saving.value = false;
    }
  };

  return {
    data,
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
