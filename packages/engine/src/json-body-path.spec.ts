import { describe, expect, it } from "vitest";

import {
  appendJsonBodyPath,
  formatJsonBodyPath,
  isInjectableJsonBodyPath,
  parseJsonBodyPath,
  resolveJsonBodyPath,
} from "./json-body-path";

describe("JSON body paths", () => {
  it("parses root-prefixed and legacy paths", () => {
    expect(parseJsonBodyPath("$")).toEqual([]);
    expect(parseJsonBodyPath("$.user.profile")).toEqual(["user", "profile"]);
    expect(parseJsonBodyPath("$.items[0].target")).toEqual([
      "items",
      0,
      "target",
    ]);
    expect(parseJsonBodyPath("items[0].target")).toEqual([
      "items",
      0,
      "target",
    ]);
  });

  it("formats and appends paths with dot-prop escaping", () => {
    expect(formatJsonBodyPath([])).toBe("$");
    expect(formatJsonBodyPath([0])).toBe("$[0]");
    expect(formatJsonBodyPath(["items", 0, "target"])).toBe(
      "$.items[0].target",
    );
    expect(appendJsonBodyPath("$", "profile.name")).toBe("$.profile\\.name");
    expect(appendJsonBodyPath("$.items", 0)).toBe("$.items[0]");
    expect(appendJsonBodyPath("$.items[0]", "x[y]")).toBe("$.items[0].x\\[y]");
  });

  it("resolves only existing object targets", () => {
    const body = {
      user: { profile: {} },
      items: [{ target: {} }],
      scalar: "value",
      "profile.name": {},
    };

    expect(resolveJsonBodyPath(body, "$")).toBe(body);
    expect(resolveJsonBodyPath(body, "$.user.profile")).toBe(body.user.profile);
    expect(resolveJsonBodyPath(body, "$.items[0].target")).toBe(
      body.items[0]?.target,
    );
    expect(resolveJsonBodyPath(body, "$.profile\\.name")).toBe(
      body["profile.name"],
    );
    expect(resolveJsonBodyPath(body, "$.missing")).toBeUndefined();
    expect(resolveJsonBodyPath(body, "$.scalar")).toBeUndefined();
  });

  it("rejects non-record roots and malformed or unsafe paths", () => {
    expect(isInjectableJsonBodyPath([], "$[0]")).toBe(false);
    expect(isInjectableJsonBodyPath(null, "$")).toBe(false);
    expect(isInjectableJsonBodyPath({}, "$.missing")).toBe(false);
    expect(isInjectableJsonBodyPath({}, "$broken")).toBe(false);
    expect(() => parseJsonBodyPath("$.a..b")).toThrow("Invalid JSON body path");
    expect(() => parseJsonBodyPath("$.__proto__.polluted")).toThrow(
      "Invalid JSON body path",
    );
    expect(() => formatJsonBodyPath(["constructor"])).toThrow(
      "Invalid JSON body path segments",
    );
  });
});
