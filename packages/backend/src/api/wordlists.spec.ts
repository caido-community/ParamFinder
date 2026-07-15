import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WordlistNotFoundError,
  type WordlistsService,
} from "../services/wordlists";
import type { BackendSDK } from "../types";

import { createWordlistHandlers } from "./wordlists";

const setAttackTypes = vi.fn();
const setEnabled = vi.fn();
const remove = vi.fn();
const service = {
  deleteWordlist: remove,
  setAttackTypes,
  setEnabled,
} as unknown as WordlistsService;
const handlers = createWordlistHandlers(service);
const sdk = {} as BackendSDK;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wordlist API validation", () => {
  it("rejects unknown and empty attack type lists", async () => {
    const unknown = await handlers.setWordlistAttackTypes(sdk, "/words.txt", [
      "unknown" as "query",
    ]);
    const empty = await handlers.setWordlistAttackTypes(sdk, "/words.txt", []);

    expect(unknown).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
    expect(empty).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
    expect(setAttackTypes).not.toHaveBeenCalled();
  });

  it("rejects invalid paths and enabled values", async () => {
    const invalidPath = await handlers.deleteWordlist(
      sdk,
      42 as unknown as string,
    );
    const invalidEnabled = await handlers.setWordlistEnabled(
      sdk,
      "/words.txt",
      "yes" as unknown as boolean,
    );

    expect(invalidPath).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
    expect(invalidEnabled).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
    expect(remove).not.toHaveBeenCalled();
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("passes validated attack types to the service", async () => {
    setAttackTypes.mockResolvedValue(undefined);

    await expect(
      handlers.setWordlistAttackTypes(sdk, "/words.txt", ["query", "body"]),
    ).resolves.toEqual({ success: true, value: undefined });
    expect(setAttackTypes).toHaveBeenCalledWith("/words.txt", [
      "query",
      "body",
    ]);
  });

  it("maps unknown registered paths to not found", async () => {
    remove.mockRejectedValueOnce(
      new WordlistNotFoundError("Wordlist not found"),
    );

    await expect(
      handlers.deleteWordlist(sdk, "/words.txt"),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
