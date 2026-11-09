import { readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";

import type { Settings } from "shared";

export type SettingsFileSystem = {
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (filePath: string) => Promise<void>;
};

const fileSystem: SettingsFileSystem = {
  readFile: async (filePath) => {
    const contents = await readFile(filePath);
    return String(contents);
  },
  writeFile,
  rename,
  rm,
};

export class SettingsRepository {
  private readonly settingsPath: string;

  constructor(
    pluginDirectory: string,
    private readonly fs: SettingsFileSystem = fileSystem,
  ) {
    this.settingsPath = path.join(pluginDirectory, "settings.json");
  }

  async read(): Promise<unknown> {
    const contents = await this.fs.readFile(this.settingsPath);
    return JSON.parse(contents) as unknown;
  }

  async write(settings: Settings): Promise<void> {
    const temporaryPath = `${this.settingsPath}.tmp`;

    try {
      await this.fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2));
      await this.fs.rename(temporaryPath, this.settingsPath);
    } catch (cause) {
      await this.fs.rm(temporaryPath).catch(() => undefined);
      throw cause;
    }
  }

  async quarantine(): Promise<void> {
    await this.fs.rename(
      this.settingsPath,
      `${this.settingsPath}.quarantine-${Date.now()}`,
    );
  }
}
