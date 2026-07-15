import type { SessionEntriesQuery } from "shared";

export type SessionEntryCursor = {
  snapshotMaxSequence: number;
  offset: number;
};

export class InvalidCursorError extends Error {}

export function parseSessionEntryCursor(
  cursor: string | undefined,
  query: SessionEntriesQuery,
): SessionEntryCursor | undefined {
  if (cursor === undefined) return undefined;

  const match = /^(\d+):(\d+):([A-Za-z0-9_-]+)$/.exec(cursor);
  if (match === null)
    throw new InvalidCursorError("Invalid session entry cursor");

  const snapshotMaxSequence = Number(match[1]);
  const offset = Number(match[2]);
  if (
    !Number.isSafeInteger(snapshotMaxSequence) ||
    !Number.isSafeInteger(offset) ||
    snapshotMaxSequence < 0 ||
    offset < 0
  ) {
    throw new InvalidCursorError("Invalid session entry cursor");
  }
  if (match[3] !== querySignature(query)) {
    throw new InvalidCursorError(
      "Session entry cursor does not match the current query",
    );
  }
  return { snapshotMaxSequence, offset };
}

export function formatSessionEntryCursor(
  cursor: SessionEntryCursor,
  query: SessionEntriesQuery,
): string {
  return `${cursor.snapshotMaxSequence}:${cursor.offset}:${querySignature(query)}`;
}

function querySignature(query: SessionEntriesQuery): string {
  const normalized = JSON.stringify({
    ref: query.ref,
    kind: query.kind,
    sort: query.sort ?? { field: "sequence", direction: "asc" },
    filter: query.filter?.trim().toLowerCase() ?? "",
  });
  return Buffer.from(normalized, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
