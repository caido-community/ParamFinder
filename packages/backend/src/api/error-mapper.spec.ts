import { describe, expect, it, vi } from "vitest";

import type { BackendSDK } from "../types";

import { mapApiErrors } from "./error-mapper";

describe("mapApiErrors", () => {
  it("logs and maps an unexpected handler failure once", async () => {
    const sdk = { console: { error: vi.fn() } } as unknown as BackendSDK;
    const handler = mapApiErrors(async () => {
      throw new Error("database unavailable");
    });

    await expect(handler(sdk)).resolves.toEqual({
      success: false,
      error: {
        code: "IO",
        details: undefined,
        message: "ParamFinder backend operation failed: database unavailable",
      },
    });
    expect(sdk.console.error).toHaveBeenCalledOnce();
    expect(sdk.console.error).toHaveBeenCalledWith(
      "[API] database unavailable",
    );
  });
});
