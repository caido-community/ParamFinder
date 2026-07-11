import type { AttackType, Wordlist } from "shared";
import type { Database } from "sqlite";

import type { BackendSDK } from "../types/types";
import { deleteFile, writeToFile } from "../util/helper";

const DEFAULT_ATTACK_TYPES: AttackType[] = ["body", "headers", "query"];
const ATTACK_TYPES: readonly string[] = ["query", "body", "headers"];

export class WordlistNotFoundError extends Error {}

export class WordlistManager {
  private database: Database | undefined;
  private readonly ready: Promise<void>;

  constructor(
    private readonly sdk: BackendSDK,
    private readonly databasePromise: Promise<Database> = sdk.meta.db(),
  ) {
    this.ready = this.initialize();
  }

  async importWordlist(data: string, filename: string): Promise<Wordlist> {
    const path = await writeToFile(this.sdk, data, filename);
    const wordlist: Wordlist = {
      path,
      enabled: true,
      attackTypes: [...DEFAULT_ATTACK_TYPES],
    };
    const statement = await (
      await this.db()
    ).prepare(
      "INSERT OR IGNORE INTO wordlists (path, enabled, attack_types) VALUES (?, ?, ?)",
    );
    await statement.run(path, 1, wordlist.attackTypes.join(","));
    return wordlist;
  }

  async getWordlists(): Promise<Wordlist[]> {
    const statement = await (
      await this.db()
    ).prepare("SELECT path, enabled, attack_types FROM wordlists");
    const rows = await statement.all<{
      path: string;
      enabled: number;
      attack_types: string;
    }>();
    return rows.map((row) => ({
      path: row.path,
      enabled: Boolean(row.enabled),
      attackTypes: parseAttackTypes(row.attack_types),
    }));
  }

  async getEnabledPaths(attackType: AttackType): Promise<string[]> {
    const wordlists = await this.getWordlists();
    return wordlists
      .filter(
        (wordlist) =>
          wordlist.enabled && wordlist.attackTypes.includes(attackType),
      )
      .map((wordlist) => wordlist.path);
  }

  async deleteWordlist(path: string): Promise<void> {
    const database = await this.db();
    const row = await (
      await database.prepare("SELECT path FROM wordlists WHERE path = ?")
    ).get<{ path: string }>(path);
    if (row === undefined)
      throw new WordlistNotFoundError("Wordlist not found");

    await (
      await database.prepare("DELETE FROM wordlists WHERE path = ?")
    ).run(row.path);
    await deleteFile(row.path).catch(() => undefined);
  }

  async clearWordlists(): Promise<void> {
    const wordlists = await this.getWordlists();
    const statement = await (await this.db()).prepare("DELETE FROM wordlists");
    await statement.run();
    await Promise.all(
      wordlists.map((wordlist) =>
        deleteFile(wordlist.path).catch(() => undefined),
      ),
    );
  }

  async setEnabled(path: string, enabled: boolean): Promise<void> {
    const statement = await (
      await this.db()
    ).prepare("UPDATE wordlists SET enabled = ? WHERE path = ?");
    await statement.run(enabled ? 1 : 0, path);
  }

  async setAttackTypes(path: string, attackTypes: AttackType[]): Promise<void> {
    const statement = await (
      await this.db()
    ).prepare("UPDATE wordlists SET attack_types = ? WHERE path = ?");
    await statement.run([...new Set(attackTypes)].join(","), path);
  }

  private async initialize(): Promise<void> {
    const database = await this.databasePromise;
    this.database = database;
    await database.exec(
      `CREATE TABLE IF NOT EXISTS wordlists (
        path TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        attack_types TEXT DEFAULT 'body,headers,query'
      )`,
    );
    const columns = await (
      await database.prepare("PRAGMA table_info(wordlists)")
    ).all<{ name: string }>();
    if (!columns.some((column) => column.name === "attack_types")) {
      await database.exec(
        "ALTER TABLE wordlists ADD COLUMN attack_types TEXT DEFAULT 'body,headers,query'",
      );
    }
  }

  private async db(): Promise<Database> {
    await this.ready;
    if (this.database === undefined) {
      throw new Error("Wordlist database not initialized");
    }
    return this.database;
  }
}

let wordlistManager: WordlistManager | undefined;
export function initWordlistManager(
  sdk: BackendSDK,
  database?: Promise<Database>,
): WordlistManager {
  wordlistManager ??= new WordlistManager(sdk, database);
  return wordlistManager;
}
export function getWordlistManager(): WordlistManager {
  if (wordlistManager === undefined)
    throw new Error("Wordlist manager not initialized");
  return wordlistManager;
}

function parseAttackTypes(value: string | null): AttackType[] {
  const parsed = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is AttackType => ATTACK_TYPES.includes(entry));
  return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_ATTACK_TYPES];
}
