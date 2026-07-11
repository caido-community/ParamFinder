import {
  type ApiResult,
  error,
  ok,
  type Settings,
  type SettingsChanges,
  settingsChangesSchema,
} from "shared";

import { getSettingsStore } from "../settings/settings";
import type { BackendSDK } from "../types/types";

export async function getSettings(_: BackendSDK): Promise<ApiResult<Settings>> {
  return ok(await getSettingsStore().getSettings());
}

export async function patchSettings(
  _: BackendSDK,
  changes: SettingsChanges,
): Promise<ApiResult<Settings>> {
  const parsed = settingsChangesSchema.safeParse(changes);
  if (!parsed.success) {
    return error("Invalid settings patch.", "VALIDATION", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  try {
    return ok(await getSettingsStore().patchSettings(parsed.data));
  } catch (cause) {
    if (cause instanceof TypeError) return error(cause.message, "VALIDATION");
    throw cause;
  }
}

export async function getSettingsPath(
  _: BackendSDK,
): Promise<ApiResult<string>> {
  return ok(getSettingsStore().getSettingsPath());
}
