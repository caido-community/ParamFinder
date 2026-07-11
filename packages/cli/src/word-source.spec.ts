import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CliOptions } from "./args";
import { loadCliWords } from "./word-source";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("loadCliWords", () => {
  it("streams large wordlists without argument spreading", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paramfinder-wordlist-"));
    tempDirectories.push(directory);
    const wordlistPath = join(directory, "large.txt");
    const words = Array.from(
      { length: 200_000 },
      (_, index) => `word-${index}`,
    );
    await writeFile(wordlistPath, words.join("\n"), "utf8");

    const loadedWords = await loadCliWords(createOptions({ wordlistPath }));

    expect(loadedWords).toHaveLength(200_000);
    expect(loadedWords[0]).toBe("word-0");
    expect(loadedWords.at(-1)).toBe("word-199999");
  });

  it("dedupes and trims words from all sources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paramfinder-wordlist-"));
    tempDirectories.push(directory);
    const wordlistPath = join(directory, "dedupe.txt");
    await writeFile(wordlistPath, " alpha \nalpha\nbeta\n", "utf8");

    const loadedWords = await loadCliWords(
      createOptions({
        words: [" beta ", "gamma"],
        wordlistPath,
      }),
    );

    expect(loadedWords).toEqual(["beta", "gamma", "alpha"]);
  });
});

function createOptions(overrides?: Partial<CliOptions>): CliOptions {
  return {
    url: "https://example.com",
    headers: [],
    words: [],
    useDefaultWords: false,
    learnRequestsCount: 3,
    autoDetectMaxSize: true,
    addCacheBusterParameter: false,
    wafDetection: true,
    additionalChecks: true,
    autopilotEnabled: true,
    customValueType: "string",
    ignoreAnomalyTypes: [],
    outputMode: "human",
    quiet: false,
    verbose: false,
    help: false,
    ...overrides,
  };
}
