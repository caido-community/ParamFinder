import type { SDK } from "caido:plugin";
import { describe, expect, it, vi } from "vitest";

import { createDefaultSettings } from "../engine/engine-mapping";

import { SettingsConflictError, SettingsStore } from "./settings";

const createSdk = (): SDK =>
  ({
    meta: { path: () => "/plugin" },
  }) as SDK;

describe("SettingsStore", () => {
  it("migrates the legacy timeout only to the request deadline", async () => {
    const writes: string[] = [];
    const store = new SettingsStore(createSdk(), {
      readFile: async () => JSON.stringify({ delay: 75, timeout: 900 }),
      writeFile: async (_, data) => {
        writes.push(data);
      },
    });
    const document = await store.getSettings();
    expect(document.settings).toMatchObject({
      delay: 75,
      requestTimeoutSeconds: 900,
    });
    expect(document.settings.scanTimeoutSeconds).toBeUndefined();
    expect(writes.length).toBeGreaterThan(0);
  });

  it("persists a patch before resolving and increments the revision", async () => {
    const writeFile = vi.fn(async () => {});
    const store = new SettingsStore(createSdk(), {
      readFile: async () =>
        JSON.stringify({
          revision: 0,
          settings: createDefaultSettings(),
        }),
      writeFile,
    });
    const updated = await store.patchSettings(0, { debug: true });
    expect(updated.revision).toBe(1);
    expect(updated.settings.debug).toBe(true);
    expect(writeFile).toHaveBeenCalled();
  });

  it("returns a detached settings document without structuredClone", async () => {
    const store = new SettingsStore(createSdk(), {
      readFile: async () =>
        JSON.stringify({
          revision: 0,
          settings: createDefaultSettings(),
        }),
      writeFile: async () => {},
    });

    const first = await store.getSettings();
    first.settings.delay = 999;
    first.settings.ignoreAnomalyTypes.push("body");

    const second = await store.getSettings();
    expect(second.settings.delay).toBe(createDefaultSettings().delay);
    expect(second.settings.ignoreAnomalyTypes).toEqual([]);
  });

  it("rejects stale concurrent patches", async () => {
    const store = new SettingsStore(createSdk(), {
      readFile: async () =>
        JSON.stringify({
          revision: 0,
          settings: createDefaultSettings(),
        }),
      writeFile: async () => {},
    });
    await store.patchSettings(0, { debug: true });
    await expect(store.patchSettings(0, { delay: 10 })).rejects.toBeInstanceOf(
      SettingsConflictError,
    );
  });

  it("repairs one invalid document field without dropping valid fields", async () => {
    const store = new SettingsStore(createSdk(), {
      readFile: async () =>
        JSON.stringify({
          revision: 7,
          settings: {
            ...createDefaultSettings(),
            delay: 123,
            learnRequestsCount: -1,
          },
        }),
      writeFile: async () => {},
    });
    const document = await store.getSettings();
    expect(document.revision).toBe(7);
    expect(document.settings.delay).toBe(123);
    expect(document.settings.learnRequestsCount).toBe(6);
  });
});
