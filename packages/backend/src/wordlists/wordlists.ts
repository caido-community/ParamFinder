import { Buffer } from "buffer";
import { access, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";

import {
  type AttackType,
  attackTypeSchema,
  type Wordlist,
  wordlistSchema,
} from "shared";

import type { BackendSDK } from "../types/types";
import { generateID } from "../util/helper";

const MAX_WORDLIST_BYTES = 10 * 1024 * 1024;
const MANIFEST_VERSION = 1;
const MANIFEST_FILENAME = "metadata.json";
const SAFE_ID = /^[a-z0-9_-]+$/i;
const DEFAULT_ATTACK_TYPES: AttackType[] = ["body", "headers", "query"];

type StoredWordlist = Wordlist;
type WordlistManifest = {
  version: typeof MANIFEST_VERSION;
  wordlists: StoredWordlist[];
};

export class WordlistManager {
  private wordlists: StoredWordlist[] = [];
  private operationQueue: Promise<void>;
  readonly ready: Promise<void>;

  constructor(private readonly sdk: BackendSDK) {
    this.ready = this.initialize();
    this.operationQueue = this.ready;
  }

  async importWordlist(data: string, filename: string): Promise<Wordlist> {
    return this.serialized(async () => {
      const bytes = Buffer.byteLength(data, "utf8");
      if (bytes === 0) throw new TypeError("Wordlist is empty.");
      if (bytes > MAX_WORDLIST_BYTES) {
        throw new TypeError("Wordlist exceeds the 10 MiB import limit.");
      }

      const wordlist: StoredWordlist = {
        id: generateID(),
        name: sanitizeFilename(filename),
        enabled: true,
        attackTypes: [...DEFAULT_ATTACK_TYPES],
        status: "pending",
      };
      await this.persist([...this.wordlists, wordlist]);

      const finalPath = this.wordlistPath(wordlist);
      const temporaryPath = `${finalPath}.tmp`;
      try {
        await writeFile(temporaryPath, data);
        await rename(temporaryPath, finalPath);
        const active = { ...wordlist, status: "active" as const };
        await this.replace(active);
        return active;
      } catch (cause) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        await this.replace({
          ...wordlist,
          enabled: false,
          status: "disabled",
          error: errorMessage(cause),
        });
        throw cause;
      }
    });
  }

  async getWordlists(): Promise<Wordlist[]> {
    return this.serialized(async () =>
      [...this.wordlists]
        .sort(compareWordlists)
        .map((wordlist) => detach(wordlist)),
    );
  }

  async getEnabledPaths(attackType: AttackType): Promise<string[]> {
    return this.serialized(async () =>
      this.wordlists.flatMap((wordlist) =>
        wordlist.enabled &&
        wordlist.status === "active" &&
        wordlist.attackTypes.includes(attackType)
          ? [this.wordlistPath(wordlist)]
          : [],
      ),
    );
  }

  async deleteWordlist(id: string): Promise<void> {
    return this.serialized(async () => {
      const wordlist = this.find(id);
      if (wordlist === undefined) return;

      await this.replace({
        ...wordlist,
        enabled: false,
        status: "pending_delete",
        error: undefined,
      });
      await rm(this.wordlistPath(wordlist), { force: true });
      await this.persist(this.wordlists.filter((entry) => entry.id !== id));
    });
  }

  async clearWordlists(): Promise<void> {
    return this.serialized(async () => {
      const pendingDeletes = this.wordlists.map((wordlist) => ({
        ...wordlist,
        enabled: false,
        status: "pending_delete" as const,
        error: undefined,
      }));
      await this.persist(pendingDeletes);
      for (const wordlist of pendingDeletes) {
        await rm(this.wordlistPath(wordlist), { force: true });
      }
      await this.persist([]);
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.update(id, (wordlist) => ({ ...wordlist, enabled }));
  }

  async setAttackTypes(id: string, attackTypes: AttackType[]): Promise<void> {
    if (
      attackTypes.length === 0 ||
      attackTypes.some((value) => !attackTypeSchema.safeParse(value).success)
    ) {
      throw new TypeError("At least one valid attack type is required.");
    }
    const uniqueAttackTypes = [...new Set(attackTypes)];
    return this.update(id, (wordlist) => ({
      ...wordlist,
      attackTypes: uniqueAttackTypes,
    }));
  }

  private async initialize(): Promise<void> {
    await mkdir(this.managedDirectory(), { recursive: true });
    await this.recoverInterruptedManifestWrite();
    this.wordlists = await this.loadManifest();
    await this.reconcileInterruptedOperations();
  }

  private async recoverInterruptedManifestWrite(): Promise<void> {
    const manifestPath = this.manifestPath();
    const temporaryPath = this.temporaryManifestPath();
    if (await exists(manifestPath)) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return;
    }
    if (!(await exists(temporaryPath))) return;

    try {
      parseManifest(String(await readFile(temporaryPath)));
      await rename(temporaryPath, manifestPath);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async loadManifest(): Promise<StoredWordlist[]> {
    if (!(await exists(this.manifestPath()))) return [];
    const contents = String(await readFile(this.manifestPath()));
    try {
      return parseManifest(contents).wordlists;
    } catch (cause) {
      const quarantinePath = `${this.manifestPath()}.quarantine-${Date.now()}`;
      await rename(this.manifestPath(), quarantinePath);
      this.sdk.console.error(
        `[WORDLISTS] Invalid metadata moved to ${quarantinePath}: ${errorMessage(cause)}`,
      );
      return [];
    }
  }

  private async reconcileInterruptedOperations(): Promise<void> {
    const reconciled: StoredWordlist[] = [];
    let changed = false;

    for (const wordlist of this.wordlists) {
      const filePath = this.wordlistPath(wordlist);
      await rm(`${filePath}.tmp`, { force: true }).catch(() => undefined);

      if (wordlist.status === "pending_delete") {
        await rm(filePath, { force: true });
        changed = true;
        continue;
      }

      const fileExists = await exists(filePath);
      if (wordlist.status === "pending" && fileExists) {
        reconciled.push({ ...wordlist, status: "active", error: undefined });
        changed = true;
        continue;
      }
      if (!fileExists && wordlist.status !== "disabled") {
        reconciled.push({
          ...wordlist,
          enabled: false,
          status: "disabled",
          error: "Managed wordlist file is missing.",
        });
        changed = true;
        continue;
      }
      reconciled.push(wordlist);
    }

    if (changed) await this.persist(reconciled);
  }

  private async update(
    id: string,
    change: (wordlist: StoredWordlist) => StoredWordlist,
  ): Promise<void> {
    return this.serialized(async () => {
      const wordlist = this.find(id);
      if (wordlist === undefined) throw new Error("Wordlist not found.");
      await this.replace(change(wordlist));
    });
  }

  private find(id: string): StoredWordlist | undefined {
    return this.wordlists.find((wordlist) => wordlist.id === id);
  }

  private async replace(wordlist: StoredWordlist): Promise<void> {
    await this.persist(
      this.wordlists.map((entry) =>
        entry.id === wordlist.id ? wordlist : entry,
      ),
    );
  }

  private async persist(wordlists: StoredWordlist[]): Promise<void> {
    const manifest: WordlistManifest = {
      version: MANIFEST_VERSION,
      wordlists,
    };
    const temporaryPath = this.temporaryManifestPath();
    try {
      await writeFile(temporaryPath, JSON.stringify(manifest));
      await rename(temporaryPath, this.manifestPath());
      this.wordlists = wordlists;
    } catch (cause) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw cause;
    }
  }

  private wordlistPath(wordlist: StoredWordlist): string {
    return path.join(
      this.managedDirectory(),
      `${wordlist.id}-${sanitizeFilename(wordlist.name)}`,
    );
  }

  private managedDirectory(): string {
    return path.join(this.sdk.meta.path(), "wordlists");
  }

  private manifestPath(): string {
    return path.join(this.managedDirectory(), MANIFEST_FILENAME);
  }

  private temporaryManifestPath(): string {
    return `${this.manifestPath()}.tmp`;
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async () => {
      await this.ready;
      return operation();
    };
    const result = this.operationQueue.then(execute, execute);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

let wordlistManager: WordlistManager | undefined;
export function initWordlistManager(sdk: BackendSDK): WordlistManager {
  wordlistManager ??= new WordlistManager(sdk);
  return wordlistManager;
}
export function getWordlistManager(): WordlistManager {
  if (wordlistManager === undefined)
    throw new Error("Wordlist manager not initialized");
  return wordlistManager;
}

function parseManifest(data: string): WordlistManifest {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error("Wordlist metadata is not valid JSON.");
  }
  if (!isRecord(value) || value.version !== MANIFEST_VERSION) {
    throw new Error("Unsupported wordlist metadata version.");
  }
  if (!Array.isArray(value.wordlists)) {
    throw new Error("Wordlist metadata does not contain a wordlist array.");
  }

  const ids = new Set<string>();
  const wordlists = value.wordlists.map((entry) => {
    const parsed = wordlistSchema.safeParse(entry);
    if (!parsed.success) throw new Error("Wordlist metadata is invalid.");
    if (!SAFE_ID.test(parsed.data.id))
      throw new Error("Wordlist metadata contains an unsafe ID.");
    if (ids.has(parsed.data.id)) {
      throw new Error("Wordlist metadata contains duplicate IDs.");
    }
    ids.add(parsed.data.id);
    return detach(parsed.data);
  });
  return { version: MANIFEST_VERSION, wordlists };
}

function sanitizeFilename(filename: string): string {
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") return "wordlist.txt";
  return safe;
}

function compareWordlists(left: Wordlist, right: Wordlist): number {
  const byName = left.name.localeCompare(right.name);
  return byName === 0 ? left.id.localeCompare(right.id) : byName;
}

function detach(wordlist: Wordlist): Wordlist {
  return { ...wordlist, attackTypes: [...wordlist.attackTypes] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
