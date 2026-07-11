import type { SDK } from "caido:plugin";
import { describe, expect, it, vi } from "vitest";

import { createDefaultSettings } from "../engine/engine-mapping";

import { SettingsConflictError, SettingsStore } from "./settings";

function createSdk(): SDK {
  return { meta: { path: () => "/plugin" } } as SDK;
}

describe("SettingsStore reliability", () => {
  it("serializes competing patches and rejects the stale revision", async () => {
    const writeFile = vi.fn(async () => {});
    const replaceFile = vi.fn<(from: string, to: string) => Promise<void>>(
      async () => {},
    );
    const store = new SettingsStore(createSdk(), {
      readFile: async () =>
        JSON.stringify({
          revision: 0,
          settings: createDefaultSettings(),
        }),
      writeFile,
      replaceFile,
    });

    const first = store.patchSettings(0, { delay: 40 });
    const second = store.patchSettings(0, { debug: true });

    await expect(first).resolves.toMatchObject({
      revision: 1,
      settings: { delay: 40, debug: false },
    });
    await expect(second).rejects.toBeInstanceOf(SettingsConflictError);
    await expect(store.getSettings()).resolves.toMatchObject({
      revision: 1,
      settings: { delay: 40, debug: false },
    });
    expect(replaceFile).toHaveBeenCalledTimes(1);
  });

  it("does not publish a revision whose durable write failed and permits retry", async () => {
    let failWrite = true;
    const store = new SettingsStore(createSdk(), {
      readFile: async () =>
        JSON.stringify({
          revision: 3,
          settings: createDefaultSettings(),
        }),
      writeFile: async () => {
        if (failWrite) throw new Error("disk full");
      },
      replaceFile: async () => {},
    });

    await expect(store.patchSettings(3, { delay: 40 })).rejects.toThrow(
      "disk full",
    );
    await expect(store.getSettings()).resolves.toMatchObject({
      revision: 3,
      settings: { delay: 20 },
    });

    failWrite = false;
    await expect(store.patchSettings(3, { delay: 60 })).resolves.toMatchObject({
      revision: 4,
      settings: { delay: 60 },
    });
  });

  it("repairs legacy settings field-by-field and persists the migrated document", async () => {
    const writeFile = vi.fn(async () => {});
    const replaceFile = vi.fn<(from: string, to: string) => Promise<void>>(
      async () => {},
    );
    const store = new SettingsStore(createSdk(), {
      readFile: async () =>
        JSON.stringify({
          timeout: 45,
          delay: 75,
          debug: true,
          learnRequestsCount: -10,
          unknown: "ignored",
        }),
      writeFile,
      replaceFile,
    });

    await expect(store.getSettings()).resolves.toMatchObject({
      revision: 0,
      settings: {
        requestTimeoutSeconds: 45,
        delay: 75,
        debug: true,
        learnRequestsCount: 6,
      },
    });
    expect(writeFile).toHaveBeenCalledWith(
      "/plugin/settings.json.tmp",
      expect.stringContaining('"requestTimeoutSeconds": 45'),
    );
    expect(replaceFile).toHaveBeenCalledWith(
      "/plugin/settings.json.tmp",
      "/plugin/settings.json",
    );
  });

  it("quarantines malformed JSON and restores validated defaults", async () => {
    const writeFile = vi.fn(async () => {});
    const replaceFile = vi.fn<(from: string, to: string) => Promise<void>>(
      async () => {},
    );
    const store = new SettingsStore(createSdk(), {
      readFile: async () => "{broken",
      writeFile,
      replaceFile,
    });

    await expect(store.getSettings()).resolves.toEqual({
      revision: 0,
      settings: createDefaultSettings(),
    });
    expect(replaceFile.mock.calls[0]?.[0]).toBe("/plugin/settings.json");
    expect(replaceFile.mock.calls[0]?.[1]).toMatch(
      /^\/plugin\/settings\.json\.quarantine-\d+$/,
    );
    expect(replaceFile.mock.calls.at(-1)).toEqual([
      "/plugin/settings.json.tmp",
      "/plugin/settings.json",
    ]);
  });
});
