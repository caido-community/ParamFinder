import { defineStore } from "pinia";
import { type ApiResult, error, ok, type Settings } from "shared";
import { ref } from "vue";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

export const useSettingsStore = defineStore("settings", () => {
  const sdk = useSDK();
  const data = ref<Settings>();

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

  const update = async (
    changes: Partial<Settings>,
  ): Promise<ApiResult<Settings>> => {
    try {
      const result = await sdk.backend.patchSettings(changes);
      if (result.success) data.value = result.value;
      return result;
    } catch (cause: unknown) {
      return error(toErrorMessage(cause));
    }
  };

  return {
    data,
    initialize,
    update,
  };
});
