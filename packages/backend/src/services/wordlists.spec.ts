import type { Wordlist } from "shared";
import type { Database } from "sqlite";
import { describe, expect, it, vi } from "vitest";

import {
  type WordlistsFileSystem,
  WordlistsRepository,
} from "../repositories/wordlists";

import { WordlistNotFoundError, WordlistsService } from "./wordlists";

type FakeDatabase = {
  database: Database;
  rows: Wordlist[];
  failInsert: () => void;
};

function createDatabase(): FakeDatabase {
  const rows: Wordlist[] = [];
  let insertFailure = false;
  const database = {
    exec: vi.fn(async () => {}),
    prepare: vi.fn(async (query: string) => ({
      all: vi.fn(async () =>
        rows.map((wordlist) => ({
          path: wordlist.path,
          enabled: wordlist.enabled ? 1 : 0,
          attack_types: wordlist.attackTypes.join(","),
        })),
      ),
      get: vi.fn(async (filePath: string) => {
        const wordlist = rows.find((entry) => entry.path === filePath);
        return wordlist === undefined ? undefined : { path: wordlist.path };
      }),
      run: vi.fn(async (...parameters: unknown[]) => {
        if (query.startsWith("INSERT")) {
          if (insertFailure) throw new Error("insert failed");
          rows.push({
            path: String(parameters[0]),
            enabled: Boolean(parameters[1]),
            attackTypes: String(parameters[2]).split(
              ",",
            ) as Wordlist["attackTypes"],
          });
        } else if (query === "DELETE FROM wordlists") {
          rows.splice(0);
        } else if (query.startsWith("DELETE")) {
          const index = rows.findIndex(
            (wordlist) => wordlist.path === parameters[0],
          );
          if (index !== -1) rows.splice(index, 1);
        } else if (query.includes("SET enabled")) {
          const wordlist = rows.find((entry) => entry.path === parameters[1]);
          if (wordlist !== undefined) wordlist.enabled = Boolean(parameters[0]);
        } else if (query.includes("SET attack_types")) {
          const wordlist = rows.find((entry) => entry.path === parameters[1]);
          if (wordlist !== undefined) {
            wordlist.attackTypes = String(parameters[0]).split(
              ",",
            ) as Wordlist["attackTypes"];
          }
        }
        return { changes: 1, lastInsertRowid: 1 };
      }),
    })),
  } as unknown as Database;

  return {
    database,
    rows,
    failInsert: () => {
      insertFailure = true;
    },
  };
}

function createFileSystem(): WordlistsFileSystem & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  return {
    files,
    access: vi.fn(async (filePath) => {
      if (!files.has(filePath)) throw new Error("not found");
    }),
    readFile: vi.fn(async (filePath) => {
      const data = files.get(filePath);
      if (data === undefined) throw new Error("not found");
      return data;
    }),
    writeFile: vi.fn(async (filePath, data) => {
      files.set(filePath, data);
    }),
    rm: vi.fn(async (filePath) => {
      files.delete(filePath);
    }),
  };
}

async function createService(
  database = createDatabase(),
  fs = createFileSystem(),
) {
  const repository = new WordlistsRepository(database.database, "/plugin", fs);
  const service = new WordlistsService(repository);
  await service.initialize();
  return { database, fs, service };
}

describe("WordlistsService", () => {
  it("serializes same-name imports so each receives a distinct path", async () => {
    const { database, fs, service } = await createService();

    const [first, second] = await Promise.all([
      service.importWordlist("alpha", "words.txt"),
      service.importWordlist("beta", "words.txt"),
    ]);

    expect(first.path).toBe("/plugin/words.txt");
    expect(second.path).toBe("/plugin/words-1.txt");
    expect(database.rows.map((wordlist) => wordlist.path)).toEqual([
      first.path,
      second.path,
    ]);
    expect(fs.files.get(first.path)).toBe("alpha");
    expect(fs.files.get(second.path)).toBe("beta");
  });

  it("removes a newly written file when its database insert fails", async () => {
    const database = createDatabase();
    const fs = createFileSystem();
    const { service } = await createService(database, fs);
    database.failInsert();

    await expect(service.importWordlist("alpha", "words.txt")).rejects.toThrow(
      "insert failed",
    );
    expect(fs.rm).toHaveBeenCalledWith("/plugin/words.txt");
    expect(fs.files.has("/plugin/words.txt")).toBe(false);
  });

  it("loads enabled words inside the queue and deduplicates them", async () => {
    const { service } = await createService();
    const first = await service.importWordlist("alpha\nbeta\n", "first.txt");
    await service.importWordlist("beta\ngamma\n", "second.txt");
    await service.setAttackTypes(first.path, ["headers"]);

    await expect(service.loadEnabledWords("query")).resolves.toEqual([
      "beta",
      "gamma",
    ]);
    await expect(service.loadEnabledWords("headers")).resolves.toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("does not remove an unregistered filesystem path", async () => {
    const { fs, service } = await createService();

    await expect(
      service.deleteWordlist("/plugin/unregistered.txt"),
    ).rejects.toBeInstanceOf(WordlistNotFoundError);
    expect(fs.rm).not.toHaveBeenCalled();
  });
});
