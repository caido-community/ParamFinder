import {
  type ApiResult,
  error,
  ok,
  type Settings,
  type SettingsChanges,
  settingsChangesSchema,
} from "shared";

import {
  type SettingsService,
  SettingsValidationError,
} from "../services/settings";
import type { BackendSDK } from "../types";

export function createSettingsHandlers(settings: SettingsService) {
  const getSettings = async (_sdk: BackendSDK): Promise<ApiResult<Settings>> =>
    ok(await settings.getSettings());

  const patchSettings = async (
    _sdk: BackendSDK,
    changes: SettingsChanges,
  ): Promise<ApiResult<Settings>> => {
    const parsed = settingsChangesSchema.safeParse(changes);
    if (!parsed.success) {
      return error("Invalid settings patch.", "VALIDATION", {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    try {
      return ok(await settings.patchSettings(parsed.data));
    } catch (cause) {
      if (cause instanceof SettingsValidationError) {
        return error(cause.message, "VALIDATION");
      }
      throw cause;
    }
  };

  return { getSettings, patchSettings };
}
