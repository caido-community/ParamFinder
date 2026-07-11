import type { ApiError, ApiResult } from "shared";

import type { FrontendSDK } from "@/types";

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  if (isApiError(err)) {
    return err.message;
  }

  return String(err);
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

export function unwrapResult<T>(result: ApiResult<T>): T {
  if (!result.success) {
    throw new Error(result.error.message);
  }

  return result.value;
}

export async function handleBackendCall<T>(
  promise: Promise<ApiResult<T>>,
  sdk: FrontendSDK,
): Promise<T> {
  try {
    return unwrapResult(await promise);
  } catch (err: unknown) {
    const message = toErrorMessage(err);
    sdk.window.showToast(message, { variant: "error", duration: 10_000 });
    throw new Error(message);
  }
}
