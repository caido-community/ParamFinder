import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BackendSDK } from "../types/types";

import { WordlistManager } from "./wordlists";

let directory: string;

function createSdk(): BackendSDK {
  return {
    meta: { path: () => directory },
    console,
  } as unknown as BackendSDK;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "paramfinder-wordlists-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("WordlistManager reliability", () => {
  it("persists imported wordlists without opening the plugin database", async () => {
    const manager = new WordlistManager(createSdk());
    await manager.ready;
    const imported = await manager.importWordlist(
      "alpha\nbeta\n",
      "../query words.txt",
    );

    expect(imported).toMatchObject({
      name: "query_words.txt",
      enabled: true,
      status: "active",
    });
    const managedPath = path.join(
      directory,
      "wordlists",
      `${imported.id}-query_words.txt`,
    );
    await expect(readFile(managedPath, "utf8")).resolves.toBe("alpha\nbeta\n");

    const restarted = new WordlistManager(createSdk());
    await restarted.ready;
    await expect(restarted.getWordlists()).resolves.toEqual([imported]);
    await expect(restarted.getEnabledPaths("query")).resolves.toEqual([
      managedPath,
    ]);
  });

  it("finishes an interrupted pending delete during startup", async () => {
    const id = "pending";
    const managedDirectory = path.join(directory, "wordlists");
    const managedPath = path.join(managedDirectory, `${id}-pending-words.txt`);
    await mkdir(managedDirectory, { recursive: true });
    await writeFile(managedPath, "alpha\n");
    await writeManifest([
      {
        id,
        name: "pending-words.txt",
        enabled: false,
        attackTypes: ["query"],
        status: "pending_delete",
      },
    ]);

    const manager = new WordlistManager(createSdk());
    await manager.ready;

    expect(await exists(managedPath)).toBe(false);
    await expect(manager.getWordlists()).resolves.toEqual([]);
    await expect(readManifestWordlists()).resolves.toEqual([]);
  });

  it("activates a completed file from an interrupted import", async () => {
    const id = "pending";
    const managedDirectory = path.join(directory, "wordlists");
    const managedPath = path.join(managedDirectory, `${id}-pending-words.txt`);
    await mkdir(managedDirectory, { recursive: true });
    await writeFile(managedPath, "alpha\n");
    await writeManifest([
      {
        id,
        name: "pending-words.txt",
        enabled: true,
        attackTypes: ["query"],
        status: "pending",
      },
    ]);

    const manager = new WordlistManager(createSdk());
    await manager.ready;

    await expect(manager.getWordlists()).resolves.toEqual([
      {
        id,
        name: "pending-words.txt",
        enabled: true,
        attackTypes: ["query"],
        status: "active",
      },
    ]);
  });

  it("disables metadata when an interrupted import has no managed file", async () => {
    await writeManifest([
      {
        id: "missing",
        name: "missing.txt",
        enabled: true,
        attackTypes: ["body"],
        status: "pending",
      },
    ]);

    const manager = new WordlistManager(createSdk());
    await manager.ready;

    await expect(manager.getWordlists()).resolves.toEqual([
      {
        id: "missing",
        name: "missing.txt",
        enabled: false,
        attackTypes: ["body"],
        status: "disabled",
        error: "Managed wordlist file is missing.",
      },
    ]);
  });

  it("persists metadata changes and deletes only managed files", async () => {
    const manager = new WordlistManager(createSdk());
    await manager.ready;
    const imported = await manager.importWordlist("alpha\n", "words.txt");
    await manager.setEnabled(imported.id, false);
    await manager.setAttackTypes(imported.id, ["headers", "headers"]);

    const restarted = new WordlistManager(createSdk());
    await restarted.ready;
    await expect(restarted.getWordlists()).resolves.toEqual([
      {
        ...imported,
        enabled: false,
        attackTypes: ["headers"],
      },
    ]);

    const managedPath = path.join(
      directory,
      "wordlists",
      `${imported.id}-words.txt`,
    );
    await restarted.deleteWordlist(imported.id);
    expect(await exists(managedPath)).toBe(false);
    await expect(restarted.getWordlists()).resolves.toEqual([]);
  });

  it("quarantines invalid metadata instead of blocking plugin startup", async () => {
    const managedDirectory = path.join(directory, "wordlists");
    await mkdir(managedDirectory, { recursive: true });
    await writeFile(path.join(managedDirectory, "metadata.json"), "{broken");

    const manager = new WordlistManager(createSdk());
    await expect(manager.ready).resolves.toBeUndefined();
    await expect(manager.getWordlists()).resolves.toEqual([]);

    const files = await readdir(managedDirectory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^metadata\.json\.quarantine-\d+$/);
  });
});

async function writeManifest(wordlists: unknown[]): Promise<void> {
  await mkdir(path.join(directory, "wordlists"), { recursive: true });
  await writeFile(
    path.join(directory, "wordlists", "metadata.json"),
    JSON.stringify({ version: 1, wordlists }),
  );
}

async function readManifestWordlists(): Promise<unknown[]> {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "wordlists", "metadata.json"), "utf8"),
  ) as { wordlists: unknown[] };
  return manifest.wordlists;
}
