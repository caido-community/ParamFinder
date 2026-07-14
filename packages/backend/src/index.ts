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
import { pauseSessionsOutsideProject } from "./engine/session-manager";
import { initSessionStore } from "./sessions/session-store";
import { initSettingsStore } from "./settings/settings";
import type { BackendSDK } from "./types/types";
import { getErrorMessage } from "./util/errors";
import { initWordlistManager } from "./wordlists/wordlists";

export type { API, Events, Spec } from "shared";

export function init(sdk: BackendSDK) {
  const database = sdk.meta.db();
  const sessions = initSessionStore(sdk, database);
  initWordlistManager(
    sdk,
    sessions.ready.then(() => database),
  );
  initSettingsStore(sdk);

  sdk.events.onProjectChange(async (eventSdk, project) => {
    const result = await pauseSessionsOutsideProject(
      eventSdk,
      project?.getId(),
    );
    if (!result.success) {
      eventSdk.console.error(
        `[SESSIONS] Could not pause sessions after project change: ${result.error.message}`,
      );
    }
  });

  const guard =
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
      try {
        return await handler(handlerSdk, ...args);
      } catch (cause) {
        const message = getErrorMessage(cause);
        sdk.console.error(`[API] ${message}`);

        return error(`ParamFinder backend operation failed: ${message}`, "IO");
      }
    };

  sdk.api.register("startMining", guard(startMining));
  sdk.api.register("cancelSession", guard(cancelSession));
  sdk.api.register("pauseSession", guard(pauseSession));
  sdk.api.register("resumeSession", guard(resumeSession));
  sdk.api.register("deleteSessions", guard(deleteSessions));
  sdk.api.register("listSessions", guard(listSessions));
  sdk.api.register("getSessionEntries", guard(getSessionEntries));
  sdk.api.register("getCurrentProjectId", guard(getCurrentProjectId));
  sdk.api.register("getRequest", guard(getRequest));
  sdk.api.register("getWordlists", guard(getWordlists));
  sdk.api.register("clearWordlists", guard(clearWordlists));
  sdk.api.register("importWordlist", guard(importWordlist));
  sdk.api.register("deleteWordlist", guard(deleteWordlist));
  sdk.api.register("setWordlistEnabled", guard(setWordlistEnabled));
  sdk.api.register("setWordlistAttackTypes", guard(setWordlistAttackTypes));
  sdk.api.register("getSettings", guard(getSettings));
  sdk.api.register("patchSettings", guard(patchSettings));
  sdk.api.register("getSettingsPath", guard(getSettingsPath));

  sdk.console.log("Backend plugin initialized");
}
