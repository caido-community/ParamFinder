import { describe, expect, it } from "vitest";

import { getGlobalRequestIds } from "./requestSource";

describe("getGlobalRequestIds", () => {
  it("returns all HTTP history request selections in stable order", () => {
    expect(
      getGlobalRequestIds({
        page: {
          kind: "HTTPHistory",
          selection: {
            kind: "Selected",
            main: "main",
            secondary: ["second", "third"],
          },
        },
      }),
    ).toEqual(["main", "second", "third"]);
  });

  it("uses only page contexts that expose request identities", () => {
    expect(
      getGlobalRequestIds({
        page: { kind: "Replay", selection: { kind: "Empty" } },
      }),
    ).toEqual([]);
  });

  it("does not truncate selections larger than 25 requests", () => {
    const secondary = Array.from(
      { length: 30 },
      (_, index) => `request-${index + 2}`,
    );
    expect(
      getGlobalRequestIds({
        page: {
          kind: "HTTPHistory",
          selection: {
            kind: "Selected",
            main: "request-1",
            secondary,
          },
        },
      }),
    ).toEqual(["request-1", ...secondary]);
  });
});
