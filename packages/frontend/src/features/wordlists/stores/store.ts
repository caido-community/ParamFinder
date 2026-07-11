import { defineStore } from "pinia";
import {
  type ApiResult,
  type AttackType,
  error,
  ok,
  type Wordlist,
} from "shared";
import { computed, ref } from "vue";

import { fetchRemoteWordlist } from "./store.effects";
import type { WordlistMutation } from "./store.model";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

type MutationJob = {
  mutation: WordlistMutation;
  request: () => Promise<ApiResult<unknown>>;
  resolve: (result: ApiResult<void>) => void;
};

export const useWordlistsStore = defineStore("wordlists", () => {
  const sdk = useSDK();
  const data = ref<Wordlist[]>([]);
  const loading = ref(false);
  const errorMessage = ref<string>();
  const currentMutation = ref<WordlistMutation>();
  const queue: MutationJob[] = [];
  let processing = false;

  const errorState = computed(() => errorMessage.value);

  async function load(): Promise<ApiResult<Wordlist[]>> {
    loading.value = true;
    try {
      const result = await sdk.backend.getWordlists();
      if (!result.success) {
        errorMessage.value = result.error.message;
        return result;
      }
      data.value = result.value;
      errorMessage.value = undefined;
      return ok(result.value);
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
    const completed: Array<{ job: MutationJob; result: ApiResult<void> }> = [];
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        if (job === undefined) {
          continue;
        }
        currentMutation.value = job.mutation;
        try {
          const result = await job.request();
          completed.push({
            job,
            result: result.success ? ok(undefined) : result,
          });
        } catch (err: unknown) {
          completed.push({ job, result: error(toErrorMessage(err)) });
        }
      }

      // Refresh once for the entire mutation burst so one completion cannot
      // clear or overwrite another operation's state.
      const refresh = await load();
      for (const item of completed) {
        const result =
          item.result.success && !refresh.success ? refresh : item.result;
        if (!result.success) {
          errorMessage.value = result.error.message;
        }
        item.job.resolve(result);
      }
    } finally {
      currentMutation.value = undefined;
      processing = false;
      if (queue.length > 0) {
        void processQueue();
      }
    }
  };

  const mutate = (
    mutation: WordlistMutation,
    request: () => Promise<ApiResult<unknown>>,
  ): Promise<ApiResult<void>> =>
    new Promise((resolve) => {
      queue.push({ mutation, request, resolve });
      void processQueue();
    });

  const importText = (filename: string, content: string) =>
    mutate({ type: "import", filename }, () =>
      sdk.backend.importWordlist(content, filename),
    );

  const importRemote = (filename: string, url: string) =>
    mutate({ type: "import", filename }, async () => {
      const download = await fetchRemoteWordlist(url);
      if (!download.success) {
        return download;
      }
      return sdk.backend.importWordlist(download.value, filename);
    });

  const toggle = (wordlist: Wordlist) =>
    mutate({ type: "toggle", id: wordlist.id }, () =>
      sdk.backend.setWordlistEnabled(wordlist.id, !wordlist.enabled),
    );

  const updateAttackTypes = (wordlist: Wordlist, attackTypes: AttackType[]) =>
    mutate({ type: "attackTypes", id: wordlist.id, attackTypes }, () =>
      sdk.backend.setWordlistAttackTypes(wordlist.id, attackTypes),
    );

  const remove = (id: string) =>
    mutate({ type: "remove", id }, () => sdk.backend.deleteWordlist(id));

  const clear = () =>
    mutate({ type: "clear" }, () => sdk.backend.clearWordlists());

  return {
    data,
    loading,
    error: errorState,
    mutation: currentMutation,
    load,
    importText,
    importRemote,
    toggle,
    updateAttackTypes,
    remove,
    clear,
  };
});
