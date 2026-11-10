import { describe, expect, it } from "vitest";

import {
  MAX_HEURISTIC_BODY_LENGTH,
  sampleBody,
  sanitizeWords,
  stringSimilarity,
} from "./utils";

describe("body analysis helpers", () => {
  it("samples large bodies from the start, middle, and end", () => {
    const padding = "a".repeat(MAX_HEURISTIC_BODY_LENGTH);
    const body = `start ${padding} middle ${padding} end`;

    const sampled = sampleBody(body);

    expect(sampled).toHaveLength(MAX_HEURISTIC_BODY_LENGTH);
    expect(sampled).toMatch(/^start /);
    expect(sampled).toContain(" middle ");
    expect(sampled).toMatch(/ end$/);
  });

  it("detects large similarity changes in the sampled body", () => {
    const body = "a".repeat(MAX_HEURISTIC_BODY_LENGTH * 4);
    const changedStart =
      Math.floor(body.length / 2) - MAX_HEURISTIC_BODY_LENGTH;
    const changed = `${body.slice(0, changedStart)}${"b".repeat(MAX_HEURISTIC_BODY_LENGTH * 2)}${body.slice(changedStart + MAX_HEURISTIC_BODY_LENGTH * 2)}`;

    expect(stringSimilarity(body, changed)).toBeLessThan(0.95);
  });
});

describe("sanitizeWords", () => {
  it("drops control characters that wordlists carry by accident", () => {
    expect(
      sanitizeWords(["token", "\u0003token", "\u0003debug", "a\u0000b\u007f"]),
    ).toEqual(["token", "debug", "ab"]);
  });

  it("drops lone surrogates but keeps characters outside the BMP", () => {
    expect(sanitizeWords(["a\ud800b", "\udc00", "key\u{1f511}"])).toEqual([
      "ab",
      "key\u{1f511}",
    ]);
  });
});
