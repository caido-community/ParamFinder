import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import type { SDK } from "caido:plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readWordlist, writeToFile } from "./helper";

let tempDirectory: string;

function createSdk(directory: string): SDK {
  return {
    meta: {
      path: () => directory,
    },
  } as SDK;
}

beforeEach(async () => {
  tempDirectory = await mkdtemp(path.join(tmpdir(), "paramfinder-backend-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("backend helpers", () => {
  it("reads wordlists with trimming, de-duplication, and empty line removal", async () => {
    const filePath = path.join(tempDirectory, "words.txt");
    await writeFile(filePath, " alpha \n\nbeta\nalpha\n beta \ngamma\n");

    await expect(readWordlist(filePath)).resolves.toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("writes imported wordlists inside the plugin directory", async () => {
    const sdk = createSdk(tempDirectory);
    const filePath = await writeToFile(sdk, "alpha\nbeta", "../words.txt");

    expect(filePath).toBe(path.join(tempDirectory, "words.txt"));
    await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\nbeta");
  });

  it("chooses the next available filename when a file already exists", async () => {
    const sdk = createSdk(tempDirectory);
    await writeFile(path.join(tempDirectory, "words.txt"), "existing");

    const filePath = await writeToFile(sdk, "new", "words.txt");

    expect(filePath).toBe(path.join(tempDirectory, "words-1.txt"));
    await expect(readFile(filePath, "utf8")).resolves.toBe("new");
  });
});
