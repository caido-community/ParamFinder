import { type ApiResult, error } from "shared";

import type { BackendSDK } from "../types";
import { getErrorMessage } from "../util";

type Handler<Arguments extends unknown[], Value> = (
  sdk: BackendSDK,
  ...args: Arguments
) => Promise<ApiResult<Value>>;

export function mapApiErrors<Arguments extends unknown[], Value>(
  handler: Handler<Arguments, Value>,
): Handler<Arguments, Value> {
  return async (sdk, ...args) => {
    try {
      return await handler(sdk, ...args);
    } catch (cause) {
      const message = getErrorMessage(cause);
      sdk.console.error(`[API] ${message}`);
      return error(`ParamFinder backend operation failed: ${message}`, "IO");
    }
  };
}
