import { defineStore } from "pinia";
import { type ApiResult, type AttackType, error, type Wordlist } from "shared";
import { computed, readonly, ref } from "vue";

import {
  clearWordlists,
  deleteWordlist,
  importRemoteWordlist,
  importTextWordlist,
  loadWordlists,
  runWordlistMutation,
  setWordlistAttackTypes,
  setWordlistEnabled,
} from "./store.effects";
import {
  initialModel,
  type WordlistMutation,
  type WordlistsMessage,
  type WordlistsModel,
} from "./store.model";
import { update as updateModel } from "./store.update";

import { useSDK } from "@/plugins/sdk";

export const useWordlistsStore = defineStore("wordlists", () => {
  const sdk = useSDK();
  const model = ref<WordlistsModel>(initialModel);

  const dispatch = (message: WordlistsMessage) => {
    model.value = updateModel(model.value, message);
  };

  const data = computed(() => model.value.data);
  const loading = computed(() => model.value.loading);
  const storeError = computed(() => model.value.error);
  const mutation = computed(() => model.value.mutation);

  const load = () => loadWordlists(sdk, dispatch);

  const mutate = (
    nextMutation: WordlistMutation,
    request: () => Promise<ApiResult<unknown>>,
  ) => {
    if (model.value.mutation !== undefined) {
      return Promise.resolve(
        error("Another wordlist operation is already in progress.", "CONFLICT"),
      );
    }
    return runWordlistMutation(sdk, dispatch, nextMutation, request);
  };

  const importText = (filename: string, content: string) =>
    mutate({ type: "import", filename }, () =>
      importTextWordlist(sdk, filename, content),
    );

  const importRemote = (filename: string, url: string) =>
    mutate({ type: "import", filename }, () =>
      importRemoteWordlist(sdk, filename, url),
    );

  const toggle = (wordlist: Wordlist) =>
    mutate({ type: "toggle", path: wordlist.path }, () =>
      setWordlistEnabled(sdk, wordlist),
    );

  const updateAttackTypes = (wordlist: Wordlist, attackTypes: AttackType[]) =>
    mutate({ type: "attackTypes", path: wordlist.path, attackTypes }, () =>
      setWordlistAttackTypes(sdk, wordlist.path, attackTypes),
    );

  const remove = (path: string) =>
    mutate({ type: "remove", path }, () => deleteWordlist(sdk, path));

  const clear = () => mutate({ type: "clear" }, () => clearWordlists(sdk));

  return {
    state: readonly(model),
    data,
    loading,
    error: storeError,
    mutation,
    load,
    importText,
    importRemote,
    toggle,
    updateAttackTypes,
    remove,
    clear,
  };
});
