import type { ApiResult } from "shared";

import { useSDK } from "@/plugins/sdk";

export type ActionResultOptions = {
  successMessage?: string;
  errorPrefix?: string;
};

export function useActionResult() {
  const sdk = useSDK();

  function showResult<T>(
    result: ApiResult<T>,
    options: ActionResultOptions = {},
  ): result is { success: true; value: T } {
    if (!result.success) {
      const message =
        options.errorPrefix !== undefined
          ? `${options.errorPrefix}: ${result.error.message}`
          : result.error.message;
      sdk.window.showToast(message, { variant: "error", duration: 10_000 });
      return false;
    }

    if (options.successMessage !== undefined) {
      sdk.window.showToast(options.successMessage, { variant: "success" });
    }

    return true;
  }

  return { showResult };
}
