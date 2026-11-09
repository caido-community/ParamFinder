import { type Settings, type SettingsChanges, settingsSchema } from "shared";

import type { SettingsRepository } from "../repositories";
import { SerialTaskQueue } from "../util";

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 15 * 60;

export class SettingsValidationError extends Error {}

export function createDefaultSettings(): Settings {
  return {
    delay: 20,
    requestTimeoutSeconds: DEFAULT_REQUEST_TIMEOUT_SECONDS,
    autoDetectMaxSize: true,
    learnRequestsCount: 6,
    wafDetection: true,
    ignoreCloudflareBlocks: false,
    additionalChecks: true,
    debug: false,
    autopilotEnabled: true,
    updateContentLength: true,
    ignoreAnomalyTypes: [],
    addCacheBusterParameter: true,
  };
}

export class SettingsService {
  private settings: Settings | undefined;
  private readonly queue = new SerialTaskQueue();

  constructor(private readonly repository: SettingsRepository) {}

  async initialize() {
    await this.queue.run(async () => {
      if (this.settings !== undefined) {
        return;
      }

      try {
        const stored = await this.repository.read();
        this.settings = dropIgnoredMaxSizes(settingsSchema.parse(stored));
      } catch {
        await this.repository.quarantine().catch(() => undefined);

        const settings = createDefaultSettings();
        await this.repository.write(settings);

        this.settings = settings;
      }
    });
  }

  async getSettings(): Promise<Settings> {
    return this.queue.run(async () => copySettings(this.getInitialized()));
  }

  async patchSettings(changes: SettingsChanges): Promise<Settings> {
    return this.queue.run(async () => {
      const merged = Object.fromEntries(
        Object.entries({ ...this.getInitialized(), ...changes }).filter(
          ([, value]) => value !== null,
        ),
      );
      const validated = settingsSchema.safeParse(merged);
      if (!validated.success) {
        throw new SettingsValidationError(
          validated.error.issues.map((issue) => issue.message).join("; "),
        );
      }

      const settings = dropIgnoredMaxSizes(validated.data);
      await this.repository.write(settings);

      this.settings = settings;

      return copySettings(settings);
    });
  }

  private getInitialized(): Settings {
    if (this.settings === undefined) {
      throw new Error("Settings service not initialized");
    }

    return this.settings;
  }
}

// The engine rejects explicit sizes while auto-detect is on.
function dropIgnoredMaxSizes(settings: Settings): Settings {
  if (!settings.autoDetectMaxSize) return settings;

  return {
    ...settings,
    maxQuerySize: undefined,
    maxHeaderSize: undefined,
    maxBodySize: undefined,
  };
}

function copySettings(settings: Settings): Settings {
  return { ...settings, ignoreAnomalyTypes: [...settings.ignoreAnomalyTypes] };
}
