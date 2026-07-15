import { defineStore } from "pinia";
import {
  type ApiResult,
  type AttackType,
  error,
  ok,
  type Wordlist,
} from "shared";
import { ref } from "vue";

import { fetchRemoteWordlist } from "./remote";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

export const useWordlistsStore = defineStore("wordlists", () => {
  const sdk = useSDK();
  const data = ref<Wordlist[]>([]);
  const loading = ref(false);
  const mutating = ref(false);

  const load = async (): Promise<ApiResult<Wordlist[]>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.getWordlists();
      if (result.success) {
        data.value = result.value;
      }
      return result;
    } catch (cause: unknown) {
      return error(toErrorMessage(cause));
    } finally {
      loading.value = false;
    }
  };

  const mutate = async (
    request: () => Promise<ApiResult<unknown>>,
  ): Promise<ApiResult<void>> => {
    if (mutating.value) {
      return error(
        "Another wordlist operation is already in progress.",
        "CONFLICT",
      );
    }

    mutating.value = true;
    try {
      const result = await request();
      if (!result.success) {
        return result;
      }

      const refreshed = await sdk.backend.getWordlists();
      if (!refreshed.success) {
        return refreshed;
      }

      data.value = refreshed.value;
      return ok(undefined);
    } catch (cause: unknown) {
      return error(toErrorMessage(cause));
    } finally {
      mutating.value = false;
    }
  };

  const importText = (filename: string, content: string) =>
    mutate(() => sdk.backend.importWordlist(content, filename));

  const importRemote = (filename: string, url: string) =>
    mutate(async () => {
      const download = await fetchRemoteWordlist(url);
      return download.success
        ? sdk.backend.importWordlist(download.value, filename)
        : download;
    });

  const toggle = (wordlist: Wordlist) =>
    mutate(() =>
      sdk.backend.setWordlistEnabled(wordlist.path, !wordlist.enabled),
    );

  const updateAttackTypes = (wordlist: Wordlist, attackTypes: AttackType[]) =>
    mutate(() =>
      sdk.backend.setWordlistAttackTypes(wordlist.path, attackTypes),
    );

  const remove = (path: string) =>
    mutate(() => sdk.backend.deleteWordlist(path));

  const clear = () => mutate(() => sdk.backend.clearWordlists());

  return {
    data,
    loading,
    mutating,
    load,
    importText,
    importRemote,
    toggle,
    updateAttackTypes,
    remove,
    clear,
  };
});
