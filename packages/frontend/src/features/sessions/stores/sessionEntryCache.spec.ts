import { describe, expect, it } from "vitest";

import {
  appendEntry,
  appendPage,
  createEntryCache,
  replacePage,
} from "./sessionEntryCache";

describe("session entry cache", () => {
  it("deduplicates entries across a page and live event overlap", () => {
    const first = appendEntry(
      createEntryCache({ field: "sequence", direction: "asc" }),
      {
        sequence: 1,
        kind: "log",
        value: "one",
      },
    );
    const result = appendPage(first, {
      items: [
        { sequence: 1, kind: "log", value: "one" },
        { sequence: 2, kind: "log", value: "two" },
      ],
      total: 2,
      snapshotMaxSequence: 2,
    });
    expect(result.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  it("does not truncate results when a session exceeds a transport page", () => {
    const page = appendPage(createEntryCache(), {
      items: Array.from({ length: 1_100 }, (_, index) => ({
        sequence: index + 1,
        kind: "log" as const,
        value: String(index),
      })),
      total: 100_000,
      snapshotMaxSequence: 1_100,
    });
    expect(page.entries).toHaveLength(1_100);
    expect(page.entries[0]?.sequence).toBe(1);
    expect(page.total).toBe(100_000);
  });

  it("does not materialize live entries into a partial page window", () => {
    const partial = appendPage(createEntryCache(), {
      items: [{ sequence: 1, kind: "log", value: "one" }],
      nextCursor: "next",
      total: 2,
      snapshotMaxSequence: 2,
    });
    const updated = appendEntry(partial, {
      sequence: 3,
      kind: "log",
      value: "three",
    });
    expect(updated.entries).toHaveLength(1);
    expect(updated.total).toBe(3);
    expect(updated.stale).toBe(true);
  });

  it("keeps an old cursor snapshot stale until it can be refreshed", () => {
    const first = appendPage(createEntryCache(), {
      items: [{ sequence: 1, kind: "log", value: "one" }],
      nextCursor: "old-snapshot-page-2",
      total: 2,
      snapshotMaxSequence: 2,
    });
    const live = appendEntry(first, {
      sequence: 3,
      kind: "log",
      value: "three",
    });
    const oldSnapshotEnd = appendPage(live, {
      items: [{ sequence: 2, kind: "log", value: "two" }],
      total: 2,
      snapshotMaxSequence: 2,
    });
    expect(oldSnapshotEnd.nextCursor).toBeUndefined();
    expect(oldSnapshotEnd.total).toBe(3);
    expect(oldSnapshotEnd.snapshotMaxSequence).toBe(3);
    expect(oldSnapshotEnd.stale).toBe(true);
  });

  it("does not append a live entry to a differently sorted cache", () => {
    const sorted = appendPage(
      createEntryCache({ field: "parameter", direction: "asc" }),
      {
        items: [],
        total: 0,
        snapshotMaxSequence: 0,
      },
    );
    const liveEntry = {
      sequence: 1,
      kind: "finding" as const,
      value: {
        requestId: "request-1",
        responseStatus: 200,
        responseLength: 10,
        parameter: { name: "secret", value: "value" },
        anomaly: { type: "status-code", from: 404, to: 200 },
      },
    } as const;
    const live = appendEntry(sorted, liveEntry);
    expect(live.entries).toEqual([]);
    expect(live.stale).toBe(true);
    expect(live.total).toBe(1);
    expect(appendEntry(live, liveEntry).total).toBe(1);
  });

  it("replaces a refreshed query window", () => {
    const loading = {
      ...appendPage(createEntryCache(), {
        items: [{ sequence: 1, kind: "log" as const, value: "old" }],
        total: 1,
        snapshotMaxSequence: 1,
      }),
      loading: true,
    };

    const refreshed = replacePage(loading, {
      items: [{ sequence: 2, kind: "log", value: "new" }],
      total: 1,
      snapshotMaxSequence: 2,
    });

    expect(refreshed.entries).toEqual([
      { sequence: 2, kind: "log", value: "new" },
    ]);
    expect(refreshed.loading).toBe(false);
  });

  it("keeps every live entry for the active chronological cache", () => {
    let cache = createEntryCache({ field: "sequence", direction: "asc" });
    for (let sequence = 1; sequence <= 100_000; sequence++) {
      cache = appendEntry(cache, {
        sequence,
        kind: "log",
        value: `log-${sequence}`,
      });
    }
    expect(cache.total).toBe(100_000);
    expect(cache.entries).toHaveLength(100_000);
    expect(cache.snapshotMaxSequence).toBe(100_000);
    expect(cache.stale).toBe(false);
  });

  it("merges an old cursor page into live chronological entries", () => {
    let cache = appendPage(
      createEntryCache({ field: "sequence", direction: "asc" }),
      {
        items: [{ sequence: 1, kind: "log", value: "one" }],
        nextCursor: "old-page-2",
        total: 2,
        snapshotMaxSequence: 2,
      },
    );
    cache = appendEntry(cache, {
      sequence: 3,
      kind: "log",
      value: "three",
    });
    cache = appendPage(cache, {
      items: [{ sequence: 2, kind: "log", value: "two" }],
      total: 2,
      snapshotMaxSequence: 2,
    });

    expect(cache.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(cache.total).toBe(3);
    expect(cache.stale).toBe(false);
  });
});
