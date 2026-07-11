import { describe, expect, it, vi } from "vitest";

import type { BackendSDK } from "../types/types";
import { deleteFile } from "../util/helper";

import { WordlistManager, WordlistNotFoundError } from "./wordlists";

vi.mock("../util/helper", () => ({
  deleteFile: vi.fn(),
  writeToFile: vi.fn(),
}));

describe("WordlistManager", () => {
  it("never deletes an unregistered filesystem path", async () => {
    const prepare = vi.fn(async (query: string) => ({
      all: vi.fn(async () => []),
      get: vi.fn(async () =>
        query.startsWith("SELECT path FROM wordlists")
          ? undefined
          : { name: "path" },
      ),
      run: vi.fn(async () => ({ changes: 0, lastInsertRowid: 0 })),
    }));
    const sdk = {
      meta: {
        db: async () => ({ exec: vi.fn(async () => {}), prepare }),
      },
    } as unknown as BackendSDK;
    const manager = new WordlistManager(sdk);

    await expect(manager.deleteWordlist("/tmp/unregistered")).rejects.toThrow(
      WordlistNotFoundError,
    );
    expect(deleteFile).not.toHaveBeenCalled();
    expect(
      prepare.mock.calls.some(([query]) =>
        query.startsWith("DELETE FROM wordlists"),
      ),
    ).toBe(false);
  });
});
