import type { CursorPage, SessionEntry, SessionEntrySort } from "shared";

export type SessionEntryCache = {
  entries: SessionEntry[];
  nextCursor?: string;
  total: number;
  snapshotMaxSequence: number;
  loading: boolean;
  error?: string;
  sort?: SessionEntrySort;
  filter?: string;
  stale: boolean;
  requestId: number;
  knownEntries: Set<string>;
  pendingEntries: Set<string>;
};

export function createEntryCache(
  sort?: SessionEntrySort,
  filter?: string,
): SessionEntryCache {
  return {
    entries: [],
    total: 0,
    snapshotMaxSequence: 0,
    loading: false,
    sort,
    filter,
    stale: false,
    requestId: 0,
    knownEntries: new Set(),
    pendingEntries: new Set(),
  };
}

export function appendPage(
  cache: SessionEntryCache,
  page: CursorPage<SessionEntry>,
): SessionEntryCache {
  const newEntries = page.items.filter(
    (entry) => !cache.knownEntries.has(entryKey(entry)),
  );
  for (const entry of newEntries) {
    const key = entryKey(entry);
    cache.knownEntries.add(key);
    cache.pendingEntries.delete(key);
  }
  const newestSequence = Math.max(
    cache.snapshotMaxSequence,
    page.snapshotMaxSequence,
  );
  const entries = [...cache.entries, ...newEntries];
  if (isLiveSequenceCache(cache)) {
    entries.sort((left, right) => left.sequence - right.sequence);
  }
  return {
    ...cache,
    entries,
    nextCursor: page.nextCursor,
    total: Math.max(cache.total, page.total),
    snapshotMaxSequence: newestSequence,
    loading: false,
    error: undefined,
    stale: cache.stale && newestSequence > page.snapshotMaxSequence,
  };
}

/** Replace a query window without hiding the previous rows while it loads. */
export function replacePage(
  cache: SessionEntryCache,
  page: CursorPage<SessionEntry>,
): SessionEntryCache {
  const liveSequence = isLiveSequenceCache(cache);
  const liveEntries = liveSequence
    ? cache.entries.filter((entry) => entry.sequence > page.snapshotMaxSequence)
    : [];
  const entries = [...page.items, ...liveEntries];
  if (liveSequence) {
    entries.sort((left, right) => left.sequence - right.sequence);
  }
  const snapshotMaxSequence = liveEntries.reduce(
    (maximum, entry) => Math.max(maximum, entry.sequence),
    page.snapshotMaxSequence,
  );
  return {
    ...cache,
    entries,
    nextCursor: page.nextCursor,
    total: liveSequence ? Math.max(page.total, cache.total) : page.total,
    snapshotMaxSequence,
    loading: false,
    error: undefined,
    stale: false,
    knownEntries: new Set(entries.map(entryKey)),
    pendingEntries: new Set(),
  };
}

export function appendEntry(
  cache: SessionEntryCache,
  entry: SessionEntry,
): SessionEntryCache {
  const key = entryKey(entry);
  if (cache.knownEntries.has(key) || cache.pendingEntries.has(key))
    return cache;
  if (!isLiveSequenceCache(cache)) {
    cache.pendingEntries.add(key);
    return {
      ...cache,
      total: cache.total + 1,
      snapshotMaxSequence: Math.max(cache.snapshotMaxSequence, entry.sequence),
      stale: true,
    };
  }
  cache.knownEntries.add(key);
  cache.entries.push(entry);
  return {
    ...cache,
    total: cache.total + 1,
    snapshotMaxSequence: Math.max(cache.snapshotMaxSequence, entry.sequence),
  };
}

export function appendEntries(
  cache: SessionEntryCache,
  entries: SessionEntry[],
): SessionEntryCache {
  const batchEntries = new Set<string>();
  const additions = entries.filter((entry) => {
    const key = entryKey(entry);
    if (
      cache.knownEntries.has(key) ||
      cache.pendingEntries.has(key) ||
      batchEntries.has(key)
    )
      return false;
    batchEntries.add(key);
    return true;
  });
  if (additions.length === 0) return cache;

  const canMaterialize = isLiveSequenceCache(cache);
  if (!canMaterialize) {
    for (const entry of additions) {
      cache.pendingEntries.add(entryKey(entry));
    }
    return {
      ...cache,
      total: cache.total + additions.length,
      snapshotMaxSequence: additions.reduce(
        (maximum, current) => Math.max(maximum, current.sequence),
        cache.snapshotMaxSequence,
      ),
      stale: true,
    };
  }
  for (const entry of additions) {
    cache.knownEntries.add(entryKey(entry));
  }
  return {
    ...cache,
    entries: [...cache.entries, ...additions],
    total: cache.total + additions.length,
    snapshotMaxSequence: additions.reduce(
      (maximum, current) => Math.max(maximum, current.sequence),
      cache.snapshotMaxSequence,
    ),
  };
}

function entryKey(entry: SessionEntry): string {
  return `${entry.kind}:${entry.sequence}`;
}

function isLiveSequenceCache(cache: SessionEntryCache): boolean {
  return (
    cache.filter === undefined &&
    cache.sort?.field === "sequence" &&
    cache.sort.direction === "asc"
  );
}
