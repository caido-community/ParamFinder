import type { Settings } from "shared";

import { useSettingsStore } from "../stores/store";

import { useActionResult } from "@/shared/composables/useActionResult";

export function useSettingsActions() {
  const settingsStore = useSettingsStore();
  const { showResult } = useActionResult();

  async function updateSettings(updates: Partial<Settings>) {
    const result = await settingsStore.update(updates);
    showResult(result, { errorPrefix: "Failed to update settings" });
    return result;
  }

  return { updateSettings };
}
