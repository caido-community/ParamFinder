import { describe, expect, it } from "vitest";

import {
  countLineDifferences,
  MAX_HEURISTIC_BODY_LENGTH,
  sampleBody,
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

  it("returns immediately equivalent results for identical bodies", () => {
    const body = "same line\n".repeat(MAX_HEURISTIC_BODY_LENGTH);

    expect(stringSimilarity(body, body)).toBe(1);
    expect(countLineDifferences(body, body)).toBe(0);
  });
});
