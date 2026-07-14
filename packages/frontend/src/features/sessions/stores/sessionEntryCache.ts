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
  knownEntries: Record<string, true>;
  pendingEntries: Record<string, true>;
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
    knownEntries: {},
    pendingEntries: {},
  };
}

export function appendPage(
  cache: SessionEntryCache,
  page: CursorPage<SessionEntry>,
): SessionEntryCache {
  const newEntries = page.items.filter(
    (entry) => cache.knownEntries[entryKey(entry)] === undefined,
  );
  const knownEntries = { ...cache.knownEntries };
  const pendingEntries = { ...cache.pendingEntries };
  for (const entry of newEntries) {
    const key = entryKey(entry);
    knownEntries[key] = true;
    delete pendingEntries[key];
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
    knownEntries,
    pendingEntries,
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
    knownEntries: Object.fromEntries(
      entries.map((entry) => [entryKey(entry), true]),
    ),
    pendingEntries: {},
  };
}

export function appendEntry(
  cache: SessionEntryCache,
  entry: SessionEntry,
): SessionEntryCache {
  const key = entryKey(entry);
  if (cache.knownEntries[key] === true || cache.pendingEntries[key] === true)
    return cache;
  if (!isLiveSequenceCache(cache)) {
    return {
      ...cache,
      total: cache.total + 1,
      snapshotMaxSequence: Math.max(cache.snapshotMaxSequence, entry.sequence),
      stale: true,
      pendingEntries: { ...cache.pendingEntries, [key]: true },
    };
  }
  return {
    ...cache,
    entries: [...cache.entries, entry],
    total: cache.total + 1,
    snapshotMaxSequence: Math.max(cache.snapshotMaxSequence, entry.sequence),
    knownEntries: { ...cache.knownEntries, [key]: true },
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
      cache.knownEntries[key] === true ||
      cache.pendingEntries[key] === true ||
      batchEntries.has(key)
    )
      return false;
    batchEntries.add(key);
    return true;
  });
  if (additions.length === 0) return cache;

  const canMaterialize = isLiveSequenceCache(cache);
  if (!canMaterialize) {
    const pendingEntries = { ...cache.pendingEntries };
    for (const entry of additions) pendingEntries[entryKey(entry)] = true;
    return {
      ...cache,
      total: cache.total + additions.length,
      snapshotMaxSequence: additions.reduce(
        (maximum, current) => Math.max(maximum, current.sequence),
        cache.snapshotMaxSequence,
      ),
      stale: true,
      pendingEntries,
    };
  }
  const knownEntries = { ...cache.knownEntries };
  for (const entry of additions) knownEntries[entryKey(entry)] = true;
  return {
    ...cache,
    entries: [...cache.entries, ...additions],
    total: cache.total + additions.length,
    snapshotMaxSequence: additions.reduce(
      (maximum, current) => Math.max(maximum, current.sequence),
      cache.snapshotMaxSequence,
    ),
    knownEntries,
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
