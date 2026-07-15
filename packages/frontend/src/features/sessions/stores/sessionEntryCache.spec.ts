import { describe, expect, it } from "vitest";

import {
  appendEntries,
  appendPage,
  createEntryCache,
  replacePage,
} from "./sessionEntryCache";

describe("session entry cache", () => {
  it("deduplicates entries across live events and page loads", () => {
    const live = appendEntries(
      createEntryCache({ field: "sequence", direction: "asc" }),
      [{ sequence: 1, kind: "log", value: "one" }],
    );
    const result = appendPage(live, {
      items: [
        { sequence: 1, kind: "log", value: "one" },
        { sequence: 2, kind: "log", value: "two" },
      ],
      snapshotMaxSequence: 2,
    });

    expect(result.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  it("marks partial query windows stale without materializing live entries", () => {
    const partial = appendPage(createEntryCache(), {
      items: [{ sequence: 1, kind: "log", value: "one" }],
      nextCursor: "next",
      snapshotMaxSequence: 2,
    });
    const updated = appendEntries(partial, [
      { sequence: 3, kind: "log", value: "three" },
    ]);

    expect(updated.entries).toHaveLength(1);
    expect(updated.snapshotMaxSequence).toBe(3);
    expect(updated.stale).toBe(true);
    expect(updated.pendingEntries).toEqual({ "log:3": true });
  });

  it("materializes chronological live entries into a live cache", () => {
    const cache = appendPage(
      createEntryCache({ field: "sequence", direction: "asc" }),
      {
        items: [{ sequence: 1, kind: "log", value: "one" }],
        snapshotMaxSequence: 1,
      },
    );
    const updated = appendEntries(cache, [
      { sequence: 2, kind: "log", value: "two" },
    ]);

    expect(updated.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(updated.stale).toBe(false);
  });

  it("replaces a refreshed query window", () => {
    const loading = {
      ...appendPage(createEntryCache(), {
        items: [{ sequence: 1, kind: "log" as const, value: "old" }],
        snapshotMaxSequence: 1,
      }),
      loading: true,
    };
    const refreshed = replacePage(loading, {
      items: [{ sequence: 2, kind: "log", value: "new" }],
      snapshotMaxSequence: 2,
    });

    expect(refreshed.entries).toEqual([
      { sequence: 2, kind: "log", value: "new" },
    ]);
    expect(refreshed.loading).toBe(false);
  });

  it("merges an older cursor page around chronological live entries", () => {
    let cache = appendPage(
      createEntryCache({ field: "sequence", direction: "asc" }),
      {
        items: [{ sequence: 1, kind: "log", value: "one" }],
        nextCursor: "old-page-2",
        snapshotMaxSequence: 2,
      },
    );
    cache = appendEntries(cache, [
      { sequence: 3, kind: "log", value: "three" },
    ]);
    cache = appendPage(cache, {
      items: [{ sequence: 2, kind: "log", value: "two" }],
      snapshotMaxSequence: 2,
    });

    expect(cache.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(cache.snapshotMaxSequence).toBe(3);
    expect(cache.stale).toBe(false);
  });
});
