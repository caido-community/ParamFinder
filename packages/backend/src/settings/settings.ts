import { readFile, rename, writeFile } from "fs/promises";
import path from "path";

import { isRecordObject } from "@paramfinder/engine";
import type { SDK } from "caido:plugin";
import { type Settings, settingsSchema } from "shared";

import { createDefaultSettings } from "../engine/engine-mapping";
import { writeFileAtomically } from "../util/atomic-file";
import { SerialTaskQueue } from "../util/serial-task-queue";

type SettingsPersistence = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  replaceFile?: (from: string, to: string) => Promise<void>;
};

const fileSettingsPersistence: SettingsPersistence = {
  readFile: async (settingsPath) => String(await readFile(settingsPath)),
  writeFile,
  replaceFile: rename,
};

export class SettingsStore {
  private settings: Settings = createDefaultSettings();
  private readonly writeQueue = new SerialTaskQueue();
  readonly ready: Promise<void>;

  constructor(
    private readonly sdk: SDK,
    private readonly persistence: SettingsPersistence = fileSettingsPersistence,
  ) {
    this.ready = this.loadSettingsFromFile();
  }

  async getSettings(): Promise<Settings> {
    await this.ready;
    await this.writeQueue.onIdle();
    return copySettings(this.settings);
  }

  async patchSettings(changes: Partial<Settings>): Promise<Settings> {
    await this.ready;
    return this.writeQueue.run(async () => {
      const validated = settingsSchema.safeParse({
        ...this.settings,
        ...changes,
      });
      if (!validated.success) {
        throw new TypeError(
          validated.error.issues.map((issue) => issue.message).join("; "),
        );
      }

      await this.persist(validated.data);
      this.settings = validated.data;

      return copySettings(validated.data);
    });
  }

  getSettingsPath(): string {
    return path.join(this.sdk.meta.path(), "settings.json");
  }

  private async persist(settings: Settings): Promise<void> {
    const data = JSON.stringify(settings, null, 2);
    await writeFileAtomically(this.getSettingsPath(), data, this.persistence);
  }

  private async loadSettingsFromFile(): Promise<void> {
    try {
      const raw = JSON.parse(
        await this.persistence.readFile(this.getSettingsPath()),
      ) as unknown;
      const migrated = migrateSettings(raw);
      this.settings = migrated.settings;

      if (migrated.changed) await this.persist(migrated.settings);
    } catch {
      await this.persistence
        .replaceFile?.(
          this.getSettingsPath(),
          `${this.getSettingsPath()}.quarantine-${Date.now()}`,
        )
        .catch(() => undefined);
      await this.persist(this.settings);
    }
  }
}

function copySettings(settings: Settings): Settings {
  return { ...settings, ignoreAnomalyTypes: [...settings.ignoreAnomalyTypes] };
}

function migrateSettings(raw: unknown): {
  settings: Settings;
  changed: boolean;
} {
  const current = settingsSchema.safeParse(raw);
  if (current.success) return { settings: current.data, changed: false };

  const legacy = isRecordObject(raw) ? raw : {};
  // Legacy `timeout` (seconds) was renamed to `requestTimeoutSeconds`.
  const legacyTimeout =
    typeof legacy.timeout === "number" && legacy.timeout > 0
      ? legacy.timeout
      : undefined;
  const candidate: Record<string, unknown> = {
    ...legacy,
    requestTimeoutSeconds: legacy.requestTimeoutSeconds ?? legacyTimeout,
  };

  const defaults = createDefaultSettings();
  const repaired: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (candidate[key] === undefined) continue;

    const field = settingsSchema.shape[key].safeParse(candidate[key]);
    if (field.success) repaired[key] = field.data;
  }

  return {
    settings: settingsSchema.parse(repaired),
    changed: true,
  };
}

let settingsStore: SettingsStore | undefined;
export function initSettingsStore(sdk: SDK): SettingsStore {
  settingsStore ??= new SettingsStore(sdk);
  return settingsStore;
}
export function getSettingsStore(): SettingsStore {
  if (settingsStore === undefined)
    throw new Error("Settings store not initialized");
  return settingsStore;
}
