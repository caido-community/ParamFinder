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
});
