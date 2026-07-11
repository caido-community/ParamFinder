import { readFile, rename, writeFile } from "fs/promises";
import path from "path";

import type { SDK } from "caido:plugin";
import { type Settings, type SettingsDocument, settingsSchema } from "shared";

import { createDefaultSettings } from "../engine/engine-mapping";

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

export class SettingsConflictError extends Error {}

export class SettingsStore {
  private document: SettingsDocument = {
    revision: 0,
    settings: createDefaultSettings(),
  };
  private writeQueue: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(
    private readonly sdk: SDK,
    private readonly persistence: SettingsPersistence = fileSettingsPersistence,
  ) {
    this.ready = this.loadSettingsFromFile();
  }

  async getSettings(): Promise<SettingsDocument> {
    await this.ready;
    await this.writeQueue;
    return copySettingsDocument(this.document);
  }

  async patchSettings(
    expectedRevision: number,
    changes: Partial<Settings>,
  ): Promise<SettingsDocument> {
    await this.ready;
    return this.serialized(async () => {
      if (expectedRevision !== this.document.revision) {
        throw new SettingsConflictError(
          `Settings revision ${expectedRevision} is stale; current revision is ${this.document.revision}.`,
        );
      }
      const validated = settingsSchema.safeParse({
        ...this.document.settings,
        ...changes,
      });
      if (!validated.success) {
        throw new TypeError(
          validated.error.issues.map((issue) => issue.message).join("; "),
        );
      }
      const next = {
        revision: this.document.revision + 1,
        settings: validated.data,
      };
      await this.persist(next);
      this.document = next;
      return copySettingsDocument(next);
    });
  }

  getSettingsPath(): string {
    return path.join(this.sdk.meta.path(), "settings.json");
  }

  private async persist(document: SettingsDocument): Promise<void> {
    const settingsPath = this.getSettingsPath();
    const data = JSON.stringify(document, null, 2);
    if (this.persistence.replaceFile === undefined) {
      await this.persistence.writeFile(settingsPath, data);
      return;
    }
    const tempPath = `${settingsPath}.tmp`;
    await this.persistence.writeFile(tempPath, data);
    await this.persistence.replaceFile(tempPath, settingsPath);
  }

  private async loadSettingsFromFile(): Promise<void> {
    try {
      const raw = JSON.parse(
        await this.persistence.readFile(this.getSettingsPath()),
      ) as unknown;
      const migrated = migrateSettings(raw);
      this.document = migrated;
      if (!isValidSettingsDocument(raw)) await this.persist(migrated);
    } catch {
      if (this.persistence.replaceFile !== undefined) {
        await this.persistence
          .replaceFile(
            this.getSettingsPath(),
            `${this.getSettingsPath()}.quarantine-${Date.now()}`,
          )
          .catch(() => undefined);
      }
      await this.persist(this.document);
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function copySettingsDocument(document: SettingsDocument): SettingsDocument {
  return {
    revision: document.revision,
    settings: {
      ...document.settings,
      ignoreAnomalyTypes: [...document.settings.ignoreAnomalyTypes],
    },
  };
}

function migrateSettings(raw: unknown): SettingsDocument {
  let revision = 0;
  let source = raw;
  if (isSettingsDocument(raw)) {
    const parsed = settingsSchema.safeParse(raw.settings);
    if (parsed.success)
      return { revision: raw.revision, settings: parsed.data };
    revision = raw.revision;
    source = raw.settings;
  }
  const legacy =
    typeof source === "object" && source !== null
      ? (source as Record<string, unknown>)
      : {};
  const legacyTimeout =
    typeof legacy.timeout === "number" && legacy.timeout > 0
      ? legacy.timeout
      : undefined;
  const defaults = createDefaultSettings();
  const candidate: Record<string, unknown> = { ...defaults };
  const timeoutMigrations: Record<string, unknown> = {
    ...legacy,
    requestTimeoutSeconds: legacy.requestTimeoutSeconds ?? legacyTimeout,
  };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (timeoutMigrations[key] === undefined) continue;
    const attempt = settingsSchema.safeParse({
      ...candidate,
      [key]: timeoutMigrations[key],
    });
    if (attempt.success) candidate[key] = attempt.data[key];
  }
  const parsed = settingsSchema.safeParse(candidate);
  return {
    revision,
    settings: parsed.success ? parsed.data : createDefaultSettings(),
  };
}

function isSettingsDocument(value: unknown): value is SettingsDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger((value as { revision?: unknown }).revision) &&
    (value as { revision: number }).revision >= 0 &&
    "settings" in value
  );
}

function isValidSettingsDocument(value: unknown): value is SettingsDocument {
  return (
    isSettingsDocument(value) &&
    settingsSchema.safeParse(value.settings).success
  );
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
