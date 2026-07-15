import { access, readFile, rm, writeFile } from "fs/promises";
import path from "path";

import type { AttackType, Wordlist } from "shared";
import type { Database } from "sqlite";

const DEFAULT_ATTACK_TYPES: AttackType[] = ["body", "headers", "query"];
const ATTACK_TYPES: readonly string[] = ["query", "body", "headers"];
const MAX_FILENAME_ATTEMPTS = 100;

type WordlistRow = {
  path: string;
  enabled: number;
  attack_types: string;
};

export type WordlistsFileSystem = {
  access: (filePath: string) => Promise<void>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, data: string) => Promise<void>;
  rm: (filePath: string) => Promise<void>;
};

const fileSystem: WordlistsFileSystem = {
  access,
  readFile: async (filePath) => {
    const contents = await readFile(filePath);
    return String(contents);
  },
  writeFile,
  rm,
};

export class WordlistsRepository {
  constructor(
    private readonly database: Database,
    private readonly pluginDirectory: string,
    private readonly fs: WordlistsFileSystem = fileSystem,
  ) {}

  async initialize(): Promise<void> {
    await this.database.exec(
      `CREATE TABLE IF NOT EXISTS wordlists (
        path TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        attack_types TEXT DEFAULT 'body,headers,query'
      )`,
    );
  }

  async createFile(data: string, filename: string): Promise<string> {
    if (data === "" || filename === "") {
      throw new Error("Data and filename are required");
    }
    if (this.pluginDirectory === "") {
      throw new Error("Could not get plugin directory");
    }

    const sanitizedFilename = path.basename(filename);
    const extension = path.extname(sanitizedFilename);
    const basename = path.basename(sanitizedFilename, extension);

    for (let index = 0; index < MAX_FILENAME_ATTEMPTS; index++) {
      const candidate = path.join(
        this.pluginDirectory,
        index === 0 ? sanitizedFilename : `${basename}-${index}${extension}`,
      );
      const exists = await this.exists(candidate);
      if (exists) {
        continue;
      }

      await this.fs.writeFile(candidate, data);
      return candidate;
    }

    throw new Error("Could not find available filename after maximum attempts");
  }

  async readWords(filePath: string): Promise<string[]> {
    const contents = await this.fs.readFile(filePath);
    const words = contents
      .split("\n")
      .map((word) => word.trim())
      .filter((word) => word !== "");

    return [...new Set(words)];
  }

  async removeFile(filePath: string): Promise<void> {
    await this.fs.rm(filePath);
  }

  async insert(wordlist: Wordlist): Promise<void> {
    const statement = await this.database.prepare(
      "INSERT OR IGNORE INTO wordlists (path, enabled, attack_types) VALUES (?, ?, ?)",
    );
    await statement.run(
      wordlist.path,
      wordlist.enabled ? 1 : 0,
      wordlist.attackTypes.join(","),
    );
  }

  async list(): Promise<Wordlist[]> {
    const statement = await this.database.prepare(
      "SELECT path, enabled, attack_types FROM wordlists",
    );
    const rows = await statement.all<WordlistRow>();
    return rows.map(mapWordlist);
  }

  async findPath(filePath: string): Promise<string | undefined> {
    const statement = await this.database.prepare(
      "SELECT path FROM wordlists WHERE path = ?",
    );
    const row = await statement.get<{ path: string }>(filePath);

    return row?.path;
  }

  async delete(filePath: string): Promise<void> {
    const statement = await this.database.prepare(
      "DELETE FROM wordlists WHERE path = ?",
    );
    await statement.run(filePath);
  }

  async clear(): Promise<void> {
    const statement = await this.database.prepare("DELETE FROM wordlists");
    await statement.run();
  }

  async setEnabled(filePath: string, enabled: boolean): Promise<void> {
    const statement = await this.database.prepare(
      "UPDATE wordlists SET enabled = ? WHERE path = ?",
    );
    await statement.run(enabled ? 1 : 0, filePath);
  }

  async setAttackTypes(
    filePath: string,
    attackTypes: AttackType[],
  ): Promise<void> {
    const statement = await this.database.prepare(
      "UPDATE wordlists SET attack_types = ? WHERE path = ?",
    );
    await statement.run([...new Set(attackTypes)].join(","), filePath);
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await this.fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

function mapWordlist(row: WordlistRow): Wordlist {
  return {
    path: row.path,
    enabled: Boolean(row.enabled),
    attackTypes: parseAttackTypes(row.attack_types),
  };
}

function parseAttackTypes(value: string | null): AttackType[] {
  const parsed = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is AttackType => ATTACK_TYPES.includes(entry));
  return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_ATTACK_TYPES];
}
