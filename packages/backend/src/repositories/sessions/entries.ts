import {
  type CursorPage,
  type SessionEntriesQuery,
  type SessionEntry,
  type SessionEntryInput,
  type SessionRef,
} from "shared";
import type { Database, Parameter } from "sqlite";

import { formatSessionEntryCursor, parseSessionEntryCursor } from "./cursor";
import {
  entryFromRow,
  entryProjections,
  type EntryRow,
  sequenceEntry,
  sortColumn,
} from "./mapping";

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1_000;

export async function createSessionEntries(
  database: Database,
  ref: SessionRef,
  values: SessionEntryInput[],
): Promise<SessionEntry[]> {
  const maximumStatement = await database.prepare(
    `SELECT COALESCE(MAX(sequence), 0) AS maximum
     FROM paramfinder_session_entries
     WHERE project_id = ? AND session_id = ?`,
  );
  const maximum = await maximumStatement.get<{ maximum: number }>(
    ref.projectId,
    ref.sessionId,
  );

  let sequence = (maximum?.maximum ?? 0) + 1;
  const entries = values.map((value) => sequenceEntry(value, sequence++));

  const placeholders = entries.map(
    () => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const parameters: Parameter[] = [];

  for (const entry of entries) {
    const projections = entryProjections(entry);
    const value = JSON.stringify(entry.value);
    parameters.push(
      ref.projectId,
      ref.sessionId,
      entry.sequence,
      entry.kind,
      value,
      value.toLowerCase(),
      projections.requestId ?? null,
      projections.responseStatus ?? null,
      projections.responseLength ?? null,
      projections.responseTime ?? null,
      projections.parametersSent ?? null,
      projections.parametersTested ?? null,
      projections.context ?? null,
      projections.parameter ?? null,
      projections.anomaly ?? null,
    );
  }

  const insert = await database.prepare(
    `INSERT INTO paramfinder_session_entries (
     project_id, session_id, sequence, kind, value_json, search_text,
     request_id, response_status, response_length, response_time,
     parameters_sent, parameters_tested, context, parameter, anomaly
     ) VALUES ${placeholders.join(", ")}`,
  );
  await insert.run(...parameters);

  return entries;
}

export async function querySessionEntries(
  database: Database,
  query: SessionEntriesQuery,
): Promise<CursorPage<SessionEntry>> {
  const cursor = parseSessionEntryCursor(query.cursor, query);
  const maximumStatement = await database.prepare(
    `SELECT COALESCE(MAX(sequence), 0) AS maximum
     FROM paramfinder_session_entries
     WHERE project_id = ? AND session_id = ? AND kind = ?`,
  );
  const currentMaximum = await maximumStatement.get<{ maximum: number }>(
    query.ref.projectId,
    query.ref.sessionId,
    query.kind,
  );

  const snapshotMaxSequence =
    cursor?.snapshotMaxSequence ?? currentMaximum?.maximum ?? 0;
  const offset = cursor?.offset ?? 0;
  const filter = query.filter?.trim().toLowerCase();
  const hasFilter = filter !== undefined && filter.length > 0;
  const where = `project_id = ? AND session_id = ? AND kind = ? AND sequence <= ?${
    hasFilter ? " AND instr(search_text, ?) > 0" : ""
  }`;
  const parameters: Parameter[] = [
    query.ref.projectId,
    query.ref.sessionId,
    query.kind,
    snapshotMaxSequence,
  ];

  if (hasFilter) {
    parameters.push(filter);
  }

  const sort = query.sort ?? { field: "sequence", direction: "asc" };
  const direction = sort.direction === "desc" ? "DESC" : "ASC";
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE),
  );

  const queryStatement = await database.prepare(
    `SELECT sequence, kind, value_json
     FROM paramfinder_session_entries
     WHERE ${where}
     ORDER BY ${sortColumn(sort.field)} ${direction}, sequence ${direction}
     LIMIT ? OFFSET ?`,
  );
  const rows = await queryStatement.all<EntryRow>(
    ...parameters,
    limit + 1,
    offset,
  );

  const hasNextPage = rows.length > limit;
  const items = rows.slice(0, limit).map(entryFromRow);

  return {
    items,
    snapshotMaxSequence,
    nextCursor: hasNextPage
      ? formatSessionEntryCursor(
          { snapshotMaxSequence, offset: offset + items.length },
          query,
        )
      : undefined,
  };
}
