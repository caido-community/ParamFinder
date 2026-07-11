import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { CliOptions } from "./args";
import { DEFAULT_WORDS } from "./default-words";

export async function loadCliWords(options: CliOptions): Promise<string[]> {
  const seen = new Set<string>();
  const words: string[] = [];

  if (options.useDefaultWords) {
    appendWords(words, seen, DEFAULT_WORDS);
  }

  appendWords(words, seen, options.words);

  if (options.wordlistPath) {
    await appendWordlist(words, seen, options.wordlistPath);
  }

  if (words.length === 0) {
    throw new Error(
      "Provide at least one word via defaults, --wordlist, or --word",
    );
  }

  return words;
}

function appendWords(
  target: string[],
  seen: Set<string>,
  words: Iterable<string>,
): void {
  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    target.push(trimmed);
  }
}

async function appendWordlist(
  target: string[],
  seen: Set<string>,
  wordlistPath: string,
): Promise<void> {
  const stream = createReadStream(wordlistPath, { encoding: "utf8" });
  const lineReader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lineReader) {
      appendWords(target, seen, [line]);
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }
}
