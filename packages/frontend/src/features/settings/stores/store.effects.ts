import { type ApiResult, error, ok, type Settings } from "shared";

import type { SettingsMessage } from "./store.model";

import { toErrorMessage } from "@/shared/utils/backend";
import type { FrontendSDK } from "@/types";

type Dispatch = (message: SettingsMessage) => void;

export async function loadSettings(
  sdk: FrontendSDK,
  dispatch: Dispatch,
): Promise<ApiResult<void>> {
  dispatch({ type: "LOAD_REQUEST" });
  try {
    const [settings, path] = await Promise.all([
      sdk.backend.getSettings(),
      sdk.backend.getSettingsPath(),
    ]);
    if (!settings.success) {
      dispatch({ type: "LOAD_FAILURE", error: settings.error.message });
      return settings;
    }
    if (!path.success) {
      dispatch({ type: "LOAD_FAILURE", error: path.error.message });
      return path;
    }
    dispatch({ type: "LOAD_SUCCESS", data: settings.value, path: path.value });
    return ok(undefined);
  } catch (cause: unknown) {
    const message = toErrorMessage(cause);
    dispatch({ type: "LOAD_FAILURE", error: message });
    return error(message);
  }
}

export async function saveSettings(
  sdk: FrontendSDK,
  dispatch: Dispatch,
  changes: Partial<Settings>,
): Promise<ApiResult<Settings>> {
  dispatch({ type: "SAVE_REQUEST" });
  try {
    const result = await sdk.backend.patchSettings(changes);
    if (!result.success) {
      dispatch({ type: "SAVE_FAILURE", error: result.error.message });
      return result;
    }
    dispatch({ type: "SAVE_SUCCESS", data: result.value });
    return result;
  } catch (cause: unknown) {
    const message = toErrorMessage(cause);
    dispatch({ type: "SAVE_FAILURE", error: message });
    return error(message);
  }
}
