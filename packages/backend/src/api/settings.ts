import {
  type ApiResult,
  error,
  ok,
  type SettingsDocument,
  type SettingsPatch,
  settingsPatchSchema,
} from "shared";

import { getSettingsStore, SettingsConflictError } from "../settings/settings";
import type { BackendSDK } from "../types/types";
import { getErrorMessage } from "../util/errors";

export async function getSettings(
  _: BackendSDK,
): Promise<ApiResult<SettingsDocument>> {
  try {
    return ok(await getSettingsStore().getSettings());
  } catch (cause) {
    return error(getErrorMessage(cause), "IO");
  }
}

export async function patchSettings(
  _: BackendSDK,
  patch: SettingsPatch,
): Promise<ApiResult<SettingsDocument>> {
  const parsed = settingsPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return error("Invalid settings patch.", "VALIDATION", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  try {
    return ok(
      await getSettingsStore().patchSettings(
        parsed.data.revision,
        parsed.data.changes,
      ),
    );
  } catch (cause) {
    if (cause instanceof SettingsConflictError) {
      return error(cause.message, "CONFLICT");
    }
    if (cause instanceof TypeError) return error(cause.message, "VALIDATION");
    return error(getErrorMessage(cause), "IO");
  }
}

export async function getSettingsPath(
  _: BackendSDK,
): Promise<ApiResult<string>> {
  return ok(getSettingsStore().getSettingsPath());
}
