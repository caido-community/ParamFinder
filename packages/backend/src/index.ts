import { type ApiResult, error } from "shared";

import {
  cancelSession,
  pauseSession,
  resumeSession,
  startMining,
} from "./api/mining";
import { getRequest } from "./api/requests";
import {
  deleteSessions,
  getCurrentProjectId,
  getSessionEntries,
  listSessions,
} from "./api/sessions";
import { getSettings, getSettingsPath, patchSettings } from "./api/settings";
import {
  clearWordlists,
  deleteWordlist,
  getWordlists,
  importWordlist,
  setWordlistAttackTypes,
  setWordlistEnabled,
} from "./api/wordlists";
import { initSessionStore } from "./sessions/session-store";
import { initSettingsStore } from "./settings/settings";
import type { BackendSDK } from "./types/types";
import { getErrorMessage } from "./util/errors";
import { initWordlistManager } from "./wordlists/wordlists";

export type { API, BackendEvents, Events, Spec } from "./types/types";

export function init(sdk: BackendSDK) {
  const sessionStore = initSessionStore(sdk);
  const wordlistManager = initWordlistManager(sdk);
  const settingsStore = initSettingsStore(sdk);
  let bootstrapError: string | undefined;
  const ready = Promise.all([
    sessionStore.ready,
    wordlistManager.ready,
    settingsStore.ready,
  ])
    .then(() => undefined)
    .catch((cause: unknown) => {
      bootstrapError = getErrorMessage(cause);
      sdk.console.error(`[BOOTSTRAP] ${bootstrapError}`);
    });
  const afterReady =
    <Arguments extends unknown[], Value>(
      handler: (
        handlerSdk: BackendSDK,
        ...args: Arguments
      ) => Promise<ApiResult<Value>>,
    ) =>
    async (
      handlerSdk: BackendSDK,
      ...args: Arguments
    ): Promise<ApiResult<Value>> => {
      await ready;
      if (bootstrapError !== undefined) {
        return error(
          `ParamFinder backend initialization failed: ${bootstrapError}`,
          "IO",
        );
      }
      try {
        return await handler(handlerSdk, ...args);
      } catch (cause) {
        const message = getErrorMessage(cause);
        sdk.console.error(`[API] ${message}`);
        return error(`ParamFinder backend operation failed: ${message}`, "IO");
      }
    };

  sdk.api.register("startMining", afterReady(startMining));
  sdk.api.register("cancelSession", afterReady(cancelSession));
  sdk.api.register("pauseSession", afterReady(pauseSession));
  sdk.api.register("resumeSession", afterReady(resumeSession));
  sdk.api.register("deleteSessions", afterReady(deleteSessions));
  sdk.api.register("listSessions", afterReady(listSessions));
  sdk.api.register("getSessionEntries", afterReady(getSessionEntries));
  sdk.api.register("getCurrentProjectId", afterReady(getCurrentProjectId));
  sdk.api.register("getRequest", afterReady(getRequest));
  sdk.api.register("getWordlists", afterReady(getWordlists));
  sdk.api.register("clearWordlists", afterReady(clearWordlists));
  sdk.api.register("importWordlist", afterReady(importWordlist));
  sdk.api.register("deleteWordlist", afterReady(deleteWordlist));
  sdk.api.register("setWordlistEnabled", afterReady(setWordlistEnabled));
  sdk.api.register(
    "setWordlistAttackTypes",
    afterReady(setWordlistAttackTypes),
  );
  sdk.api.register("getSettings", afterReady(getSettings));
  sdk.api.register("patchSettings", afterReady(patchSettings));
  sdk.api.register("getSettingsPath", afterReady(getSettingsPath));

  sdk.console.log("Backend plugin initialized");
}
