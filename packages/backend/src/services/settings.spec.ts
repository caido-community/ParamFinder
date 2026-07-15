import { describe, expect, it, vi } from "vitest";

import {
  type SettingsFileSystem,
  SettingsRepository,
} from "../repositories/settings";

import {
  createDefaultSettings,
  SettingsService,
  SettingsValidationError,
} from "./settings";

function createFileSystem(
  settings = JSON.stringify(createDefaultSettings()),
): SettingsFileSystem {
  return {
    readFile: vi.fn(async () => settings),
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
  };
}

async function createService(fs = createFileSystem()) {
  const repository = new SettingsRepository("/plugin", fs);
  const service = new SettingsService(repository);

  await service.initialize();

  return service;
}

describe("SettingsService", () => {
  it("serializes competing patches and publishes only durable settings", async () => {
    let failWrite = false;
    const fs = createFileSystem();
    vi.mocked(fs.rename).mockImplementation(async () => {
      if (failWrite) throw new Error("disk full");
    });
    const service = await createService(fs);

    const first = service.patchSettings({ delay: 40 });
    const second = service.patchSettings({ debug: true });

    await expect(first).resolves.toMatchObject({ delay: 40, debug: false });
    await expect(second).resolves.toMatchObject({ delay: 40, debug: true });

    failWrite = true;
    await expect(service.patchSettings({ delay: 80 })).rejects.toThrow(
      "disk full",
    );
    await expect(service.getSettings()).resolves.toMatchObject({
      delay: 40,
      debug: true,
    });
  });

  it("removes the temporary file when atomic replacement fails", async () => {
    const fs = createFileSystem();
    vi.mocked(fs.rename).mockRejectedValue(new Error("rename failed"));
    const service = await createService(fs);

    await expect(service.patchSettings({ delay: 40 })).rejects.toThrow(
      "rename failed",
    );
    expect(fs.rm).toHaveBeenCalledWith("/plugin/settings.json.tmp");
    await expect(service.getSettings()).resolves.toEqual(
      createDefaultSettings(),
    );
  });

  it("quarantines invalid settings instead of migrating legacy fields", async () => {
    const fs = createFileSystem(
      JSON.stringify({
        ...createDefaultSettings(),
        requestTimeoutSeconds: undefined,
        timeout: 45,
      }),
    );
    const service = await createService(fs);

    await expect(service.getSettings()).resolves.toEqual(
      createDefaultSettings(),
    );
    expect(vi.mocked(fs.rename).mock.calls[0]?.[0]).toBe(
      "/plugin/settings.json",
    );
    expect(vi.mocked(fs.rename).mock.calls[0]?.[1]).toMatch(
      /^\/plugin\/settings\.json\.quarantine-\d+$/,
    );
    expect(vi.mocked(fs.writeFile).mock.calls[0]?.[1]).toContain(
      '"requestTimeoutSeconds": 900',
    );
  });

  it("returns detached settings and reports invalid patches explicitly", async () => {
    const service = await createService();
    const settings = await service.getSettings();
    settings.delay = 999;
    settings.ignoreAnomalyTypes.push("body");

    await expect(service.getSettings()).resolves.toEqual(
      createDefaultSettings(),
    );
    await expect(
      service.patchSettings({ learnRequestsCount: 2 }),
    ).rejects.toBeInstanceOf(SettingsValidationError);
  });
});
