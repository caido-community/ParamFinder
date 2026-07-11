import { defineStore } from "pinia";
import {
  type ApiResult,
  error,
  ok,
  type Settings,
  type SettingsDocument,
} from "shared";
import { computed, ref } from "vue";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

type PatchJob = {
  changes: Partial<Settings>;
  resolve: (result: ApiResult<Settings>) => void;
};

export const useSettingsStore = defineStore("settings", () => {
  const sdk = useSDK();
  const document = ref<SettingsDocument>();
  const optimisticData = ref<Settings>();
  const path = ref("");
  const loading = ref(false);
  const saving = ref(false);
  const errorMessage = ref<string>();
  const queue: PatchJob[] = [];
  let processing = false;

  const data = computed(() => optimisticData.value ?? document.value?.settings);
  const errorState = computed(() => errorMessage.value);

  const pendingChanges = () =>
    queue.reduce<Partial<Settings>>(
      (changes, job) => ({ ...changes, ...job.changes }),
      {},
    );

  const applyServerDocument = (next: SettingsDocument) => {
    document.value = next;
    optimisticData.value = { ...next.settings, ...pendingChanges() };
  };

  async function fetchDocument(): Promise<ApiResult<SettingsDocument>> {
    try {
      const result = await sdk.backend.getSettings();
      if (!result.success) {
        return result;
      }
      applyServerDocument(result.value);
      return ok(result.value);
    } catch (err: unknown) {
      return error(toErrorMessage(err));
    }
  }

  async function initialize(): Promise<ApiResult<void>> {
    loading.value = true;
    errorMessage.value = undefined;
    try {
      const [settingsResult, pathResult] = await Promise.all([
        fetchDocument(),
        sdk.backend.getSettingsPath(),
      ]);
      if (!settingsResult.success) {
        errorMessage.value = settingsResult.error.message;
        return settingsResult;
      }
      if (!pathResult.success) {
        errorMessage.value = pathResult.error.message;
        return pathResult;
      }
      path.value = pathResult.value;
      return ok(undefined);
    } catch (err: unknown) {
      const message = toErrorMessage(err);
      errorMessage.value = message;
      return error(message);
    } finally {
      loading.value = false;
    }
  }

  const processQueue = async () => {
    if (processing) {
      return;
    }
    processing = true;
    saving.value = true;
    try {
      while (queue.length > 0) {
        const job = queue[0];
        if (job === undefined) {
          break;
        }
        if (document.value === undefined) {
          const fetched = await fetchDocument();
          if (!fetched.success) {
            queue.shift();
            job.resolve(fetched);
            continue;
          }
        }

        let result = await sdk.backend.patchSettings({
          revision: document.value!.revision,
          changes: job.changes,
        });
        if (!result.success && result.error.code === "CONFLICT") {
          const refreshed = await fetchDocument();
          if (refreshed.success) {
            result = await sdk.backend.patchSettings({
              revision: refreshed.value.revision,
              changes: job.changes,
            });
          }
        }

        queue.shift();
        if (result.success) {
          applyServerDocument(result.value);
          errorMessage.value = undefined;
          job.resolve(ok(result.value.settings));
        } else {
          errorMessage.value = result.error.message;
          job.resolve(result);
          await fetchDocument();
        }
      }
    } catch (err: unknown) {
      const message = toErrorMessage(err);
      errorMessage.value = message;
      while (queue.length > 0) {
        queue.shift()?.resolve(error(message));
      }
    } finally {
      processing = false;
      saving.value = false;
      optimisticData.value = document.value?.settings;
    }
  };

  function update(changes: Partial<Settings>): Promise<ApiResult<Settings>> {
    if (data.value === undefined) {
      return Promise.resolve(error("Settings are not loaded yet.", "CONFLICT"));
    }
    optimisticData.value = { ...data.value, ...changes };
    errorMessage.value = undefined;
    return new Promise((resolve) => {
      queue.push({ changes, resolve });
      void processQueue();
    });
  }

  return {
    data,
    path,
    error: errorState,
    loading,
    saving,
    initialize,
    update,
  };
});
