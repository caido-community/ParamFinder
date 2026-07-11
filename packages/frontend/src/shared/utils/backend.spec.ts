import { error, ok } from "shared";
import { describe, expect, it } from "vitest";

import { toErrorMessage, unwrapResult } from "./backend";

describe("backend utils", () => {
  it("unwraps successful results", () => {
    expect(unwrapResult(ok("value"))).toBe("value");
  });

  it("throws failed result errors", () => {
    expect(() => unwrapResult(error("failed"))).toThrow("failed");
  });

  it("normalizes unknown errors", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage("plain")).toBe("plain");
  });

  it("reads structured backend errors", () => {
    const apiError = { code: "IO" as const, message: "disk failed" };
    expect(toErrorMessage(apiError)).toBe("disk failed");
  });
});
