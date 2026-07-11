import type { SDK } from "caido:plugin";
import { describe, expect, it, vi } from "vitest";

import { createDefaultSettings } from "../engine/engine-mapping";

import { SettingsStore } from "./settings";

function createSdk(): SDK {
  return { meta: { path: () => "/plugin" } } as SDK;
}

describe("SettingsStore reliability", () => {
  it("serializes competing patches so the last write wins deterministically", async () => {
    const writeFile = vi.fn(async () => {});
    const replaceFile = vi.fn<(from: string, to: string) => Promise<void>>(
      async () => {},
    );
    const store = new SettingsStore(createSdk(), {
      readFile: async () => JSON.stringify(createDefaultSettings()),
      writeFile,
      replaceFile,
    });

    const first = store.patchSettings({ delay: 40 });
    const second = store.patchSettings({ debug: true });

    await expect(first).resolves.toMatchObject({ delay: 40, debug: false });
    await expect(second).resolves.toMatchObject({ delay: 40, debug: true });
    await expect(store.getSettings()).resolves.toMatchObject({
      delay: 40,
      debug: true,
    });
    expect(replaceFile).toHaveBeenCalledTimes(2);
  });

  it("does not publish settings whose durable write failed and permits retry", async () => {
    let failWrite = true;
    const store = new SettingsStore(createSdk(), {
      readFile: async () => JSON.stringify(createDefaultSettings()),
      writeFile: async () => {
        if (failWrite) throw new Error("disk full");
      },
      replaceFile: async () => {},
    });

    await expect(store.patchSettings({ delay: 40 })).rejects.toThrow(
      "disk full",
    );
    await expect(store.getSettings()).resolves.toMatchObject({ delay: 20 });

    failWrite = false;
    await expect(store.patchSettings({ delay: 60 })).resolves.toMatchObject({
      delay: 60,
    });
  });

  it("repairs legacy settings field-by-field and persists the migrated file", async () => {
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
      requestTimeoutSeconds: 45,
      delay: 75,
      debug: true,
      learnRequestsCount: 6,
    });
    expect((await store.getSettings()).scanTimeoutSeconds).toBeUndefined();
    expect(writeFile).toHaveBeenCalledWith(
      "/plugin/settings.json.tmp",
      expect.stringContaining('"requestTimeoutSeconds": 45'),
    );
    expect(replaceFile).toHaveBeenCalledWith(
      "/plugin/settings.json.tmp",
      "/plugin/settings.json",
    );
  });

  it("returns detached settings values", async () => {
    const store = new SettingsStore(createSdk(), {
      readFile: async () => JSON.stringify(createDefaultSettings()),
      writeFile: async () => {},
    });

    const first = await store.getSettings();
    first.delay = 999;
    first.ignoreAnomalyTypes.push("body");

    await expect(store.getSettings()).resolves.toEqual(createDefaultSettings());
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

    await expect(store.getSettings()).resolves.toEqual(createDefaultSettings());
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
