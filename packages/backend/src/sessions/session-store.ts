import {
  compareSessionIds,
  type CursorPage,
  type NonTerminalSessionLifecycle,
  type ProjectSessionSnapshot,
  type SessionDescriptor,
  sessionDescriptorSchema,
  type SessionEntriesQuery,
  type SessionEntry,
  type SessionEntryInput,
  sessionEntrySchema,
  type SessionEntrySortField,
  type SessionLifecycle,
  type SessionRef,
  type SessionRerun,
  type TerminalSessionDescriptor,
  type TerminalSessionLifecycle,
} from "shared";
import type { Database, Parameter } from "sqlite";

import type { BackendSDK } from "../types/types";
import { SerialTaskQueue } from "../util/serial-task-queue";

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1_000;
const SNAPSHOT_VERSION = 2 as const;
const RESTART_ERROR = JSON.stringify({
  code: "INTERNAL",
  message: "Scan interrupted because the ParamFinder backend restarted.",
});

type SessionRow = {
  project_id: string;
  session_id: string;
  state: string;
  phase: string;
  total_parameters_amount: number;
  total_learn_requests: number;
  parameters_sent: number;
  requests_sent: number;
  findings_count: number;
  logs_count: number;
  created_at: number;
  updated_at: number;
  error_json: string | null | undefined;
  rerun_json: string | null | undefined;
};

type EntryRow = { sequence: number; kind: string; value_json: string };

const SESSION_COLUMNS = `
  project_id, session_id, state, phase, total_parameters_amount,
  total_learn_requests, parameters_sent, requests_sent, findings_count,
  logs_count, created_at, updated_at, error_json, rerun_json
`;

/** Persistent, project-scoped scan history backed by Caido's plugin database. */
export class SessionStore {
  private database: Database | undefined;
  private readonly writeQueue = new SerialTaskQueue();
  readonly ready: Promise<void>;

  constructor(
    private readonly sdk: BackendSDK,
    private readonly databasePromise: Promise<Database> = sdk.meta.db(),
  ) {
    this.ready = this.initialize();
  }

  async getCurrentProjectId(): Promise<string | undefined> {
    await this.ready;
    return (await this.sdk.projects.getCurrent())?.getId();
  }

  async listSessions(projectId: string): Promise<ProjectSessionSnapshot> {
    const database = await this.db();
    const project = await (
      await database.prepare(
        "SELECT revision FROM paramfinder_session_projects WHERE project_id = ?",
      )
    ).get<{ revision: number }>(projectId);
    const rows = await (
      await database.prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM paramfinder_sessions
         WHERE project_id = ?
         ORDER BY created_at DESC`,
      )
    ).all<SessionRow>(projectId);
    const sessions = rows
      .map(descriptorFromRow)
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          compareSessionIds(right.ref.sessionId, left.ref.sessionId),
      );

    return {
      version: SNAPSHOT_VERSION,
      projectId,
      revision: project?.revision ?? 0,
      sessions,
    };
  }

  async createSession(
    ref: SessionRef,
    totalParametersAmount: number,
    totalLearnRequests: number,
    rerun: SessionRerun,
  ): Promise<{ revision: number; session: SessionDescriptor }> {
    return this.write(() =>
      this.createSessionUnlocked(
        ref,
        totalParametersAmount,
        totalLearnRequests,
        rerun,
      ),
    );
  }

  async createNextSession(
    projectId: string,
    totalParametersAmount: number,
    totalLearnRequests: number,
    rerun: SessionRerun,
  ): Promise<{ revision: number; session: SessionDescriptor }> {
    return this.write(async () => {
      const database = await this.db();
      const rows = await (
        await database.prepare(
          "SELECT session_id FROM paramfinder_sessions WHERE project_id = ?",
        )
      ).all<{ session_id: string }>(projectId);
      return this.createSessionUnlocked(
        {
          projectId,
          sessionId: nextNumericSessionId(
            rows.map(({ session_id }) => session_id),
          ),
        },
        totalParametersAmount,
        totalLearnRequests,
        rerun,
      );
    });
  }

  private async createSessionUnlocked(
    ref: SessionRef,
    totalParametersAmount: number,
    totalLearnRequests: number,
    rerun: SessionRerun,
  ) {
    if ((await this.getSession(ref)) !== undefined) {
      throw new Error(`Session ${ref.sessionId} already exists.`);
    }

    const now = Date.now();
    const descriptor: SessionDescriptor = {
      ref,
      state: "pending",
      phase: "idle",
      totalParametersAmount,
      totalLearnRequests,
      parametersSent: 0,
      requestsSent: 0,
      findingsCount: 0,
      logsCount: 0,
      createdAt: now,
      updatedAt: now,
      rerun,
    };
    const database = this.dbWithoutReady();
    await ensureProject(database, ref.projectId);
    await insertSession(database, descriptor);
    await incrementRevision(database, ref.projectId);

    return {
      revision: await this.getRevision(ref.projectId),
      session: descriptor,
    };
  }

  async transitionSession(
    ref: SessionRef,
    lifecycle: TerminalSessionLifecycle,
  ): Promise<
    { revision: number; session: TerminalSessionDescriptor } | undefined
  >;
  async transitionSession(
    ref: SessionRef,
    lifecycle: NonTerminalSessionLifecycle,
  ): Promise<{ revision: number; session: SessionDescriptor } | undefined>;
  async transitionSession(
    ref: SessionRef,
    lifecycle: SessionLifecycle,
  ): Promise<{ revision: number; session: SessionDescriptor } | undefined> {
    return this.write(async () => {
      const previous = await this.getSession(ref);
      if (previous === undefined) return undefined;

      const session = sessionDescriptorSchema.parse({
        ...previous,
        ...lifecycle,
        updatedAt: Date.now(),
      });
      const database = this.dbWithoutReady();
      await updateSessionRow(database, session);
      await incrementRevision(database, ref.projectId);
      return { revision: await this.getRevision(ref.projectId), session };
    });
  }

  async setTotalParametersAmount(
    ref: SessionRef,
    totalParametersAmount: number,
  ): Promise<{ revision: number; session: SessionDescriptor } | undefined> {
    return this.write(async () => {
      const previous = await this.getSession(ref);
      if (previous === undefined) return undefined;

      const session = sessionDescriptorSchema.parse({
        ...previous,
        totalParametersAmount,
        updatedAt: Date.now(),
      });
      const database = this.dbWithoutReady();
      await updateSessionRow(database, session);
      await incrementRevision(database, ref.projectId);
      return { revision: await this.getRevision(ref.projectId), session };
    });
  }

  async appendEntries(
    ref: SessionRef,
    values: SessionEntryInput[],
  ): Promise<
    | { revision: number; session: SessionDescriptor; entries: SessionEntry[] }
    | undefined
  > {
    if (values.length === 0) return undefined;

    return this.write(async () => {
      const previous = await this.getSession(ref);
      if (previous === undefined) return undefined;
      const maximum = await (
        await (
          await this.db()
        ).prepare(
          `SELECT COALESCE(MAX(sequence), 0) AS maximum
           FROM paramfinder_session_entries
           WHERE project_id = ? AND session_id = ?`,
        )
      ).get<{ maximum: number }>(ref.projectId, ref.sessionId);
      let sequence = (maximum?.maximum ?? 0) + 1;
      const entries = values.map((value) => sequenceEntry(value, sequence++));

      let requests = 0;
      let parameters = 0;
      let findings = 0;
      let logs = 0;
      for (const entry of entries) {
        if (entry.kind === "request") {
          requests += 1;
          parameters += entry.value.parametersSent;
        } else if (entry.kind === "finding") {
          findings += 1;
        } else {
          logs += 1;
        }
      }

      const session: SessionDescriptor = {
        ...previous,
        parametersSent: previous.parametersSent + parameters,
        requestsSent: previous.requestsSent + requests,
        findingsCount: previous.findingsCount + findings,
        logsCount: previous.logsCount + logs,
        updatedAt: Date.now(),
      };
      const database = this.dbWithoutReady();
      await insertEntries(database, ref, entries);
      await updateSessionRow(database, session);
      await incrementRevision(database, ref.projectId);

      return {
        revision: await this.getRevision(ref.projectId),
        session,
        entries,
      };
    });
  }

  async getSession(ref: SessionRef): Promise<SessionDescriptor | undefined> {
    const row = await (
      await (
        await this.db()
      ).prepare(
        `SELECT ${SESSION_COLUMNS}
         FROM paramfinder_sessions
         WHERE project_id = ? AND session_id = ?`,
      )
    ).get<SessionRow>(ref.projectId, ref.sessionId);
    return row === undefined ? undefined : descriptorFromRow(row);
  }

  async getEntries(
    query: SessionEntriesQuery,
  ): Promise<CursorPage<SessionEntry> | undefined> {
    if ((await this.getSession(query.ref)) === undefined) return undefined;

    const database = await this.db();
    const cursor = parseCursor(query.cursor, querySignature(query));
    const currentMaximum = await (
      await database.prepare(
        `SELECT COALESCE(MAX(sequence), 0) AS maximum
         FROM paramfinder_session_entries
         WHERE project_id = ? AND session_id = ? AND kind = ?`,
      )
    ).get<{ maximum: number }>(
      query.ref.projectId,
      query.ref.sessionId,
      query.kind,
    );
    const snapshotMaxSequence =
      cursor?.snapshotMaxSequence ?? currentMaximum?.maximum ?? 0;
    const offset = cursor?.offset ?? 0;
    const filter = query.filter?.trim().toLowerCase();
    const filterSql =
      filter === undefined || filter.length === 0
        ? ""
        : " AND instr(search_text, ?) > 0";
    const params: Parameter[] = [
      query.ref.projectId,
      query.ref.sessionId,
      query.kind,
      snapshotMaxSequence,
    ];
    if (filterSql !== "") params.push(filter!);
    const where = `project_id = ? AND session_id = ? AND kind = ? AND sequence <= ?${filterSql}`;
    const total = await (
      await database.prepare(
        `SELECT COUNT(*) AS total FROM paramfinder_session_entries WHERE ${where}`,
      )
    ).get<{ total: number }>(...params);
    const sort = query.sort ?? { field: "sequence", direction: "asc" };
    const direction = sort.direction === "desc" ? "DESC" : "ASC";
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE),
    );
    const rows = await (
      await database.prepare(
        `SELECT sequence, kind, value_json
         FROM paramfinder_session_entries
         WHERE ${where}
         ORDER BY ${sortColumn(sort.field)} ${direction}, sequence ${direction}
         LIMIT ? OFFSET ?`,
      )
    ).all<EntryRow>(...params, limit, offset);
    const items = rows.map(entryFromRow);
    const nextOffset = offset + items.length;
    const totalCount = total?.total ?? 0;

    return {
      items,
      total: totalCount,
      snapshotMaxSequence,
      nextCursor:
        nextOffset < totalCount
          ? formatCursor(
              { snapshotMaxSequence, offset: nextOffset },
              querySignature(query),
            )
          : undefined,
    };
  }

  async deleteSessions(refs: SessionRef[]): Promise<Map<string, number>> {
    return this.write(async () => {
      const database = await this.db();
      const affected = new Set<string>();
      const deletions: SessionRef[] = [];
      const exists = await database.prepare(
        `SELECT 1 AS present FROM paramfinder_sessions
         WHERE project_id = ? AND session_id = ?`,
      );
      for (const ref of refs) {
        if (
          (await exists.get<{ present: number }>(
            ref.projectId,
            ref.sessionId,
          )) === undefined
        ) {
          continue;
        }
        affected.add(ref.projectId);
        deletions.push(ref);
      }
      if (deletions.length === 0) return new Map();

      const where = deletions
        .map(() => "(project_id = ? AND session_id = ?)")
        .join(" OR ");
      const parameters = deletions.flatMap(({ projectId, sessionId }) => [
        projectId,
        sessionId,
      ]);
      await (
        await database.prepare(
          `DELETE FROM paramfinder_sessions WHERE ${where}`,
        )
      ).run(...parameters);
      await (
        await database.prepare(
          `DELETE FROM paramfinder_session_entries WHERE ${where}`,
        )
      ).run(...parameters);
      for (const projectId of affected) {
        await incrementRevision(database, projectId);
      }
      return new Map(
        await Promise.all(
          [...affected].map(
            async (projectId) =>
              [projectId, await this.getRevision(projectId)] as const,
          ),
        ),
      );
    });
  }

  private async initialize(): Promise<void> {
    const database = await this.databasePromise;
    this.database = database;
    await database.exec(`
      CREATE TABLE IF NOT EXISTS paramfinder_session_projects (
        project_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
      );
      CREATE TABLE IF NOT EXISTS paramfinder_sessions (
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        state TEXT NOT NULL,
        phase TEXT NOT NULL,
        total_parameters_amount INTEGER NOT NULL,
        total_learn_requests INTEGER NOT NULL,
        parameters_sent INTEGER NOT NULL,
        requests_sent INTEGER NOT NULL,
        findings_count INTEGER NOT NULL,
        logs_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error_json TEXT,
        rerun_json TEXT NOT NULL,
        PRIMARY KEY (project_id, session_id),
        FOREIGN KEY (project_id) REFERENCES paramfinder_session_projects(project_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS paramfinder_session_entries (
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        kind TEXT NOT NULL CHECK (kind IN ('request', 'finding', 'log')),
        value_json TEXT NOT NULL,
        search_text TEXT NOT NULL,
        request_id TEXT,
        response_status INTEGER,
        response_length INTEGER,
        response_time INTEGER,
        parameters_sent INTEGER,
        parameters_tested INTEGER,
        context TEXT,
        parameter TEXT,
        anomaly TEXT,
        PRIMARY KEY (project_id, session_id, sequence),
        FOREIGN KEY (project_id, session_id)
          REFERENCES paramfinder_sessions(project_id, session_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS paramfinder_sessions_by_project_created
        ON paramfinder_sessions(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS paramfinder_entries_by_session_kind_sequence
        ON paramfinder_session_entries(project_id, session_id, kind, sequence);
    `);
    await this.reconcileInterruptedSessions();
  }

  private async reconcileInterruptedSessions(): Promise<void> {
    const database = this.dbWithoutReady();
    const projects = await (
      await database.prepare(
        `SELECT DISTINCT project_id FROM paramfinder_sessions
         WHERE state IN ('pending', 'learning', 'running', 'paused')`,
      )
    ).all<{ project_id: string }>();
    if (projects.length === 0) return;

    const now = Date.now();
    await (
      await database.prepare(
        `UPDATE paramfinder_sessions
         SET state = 'error', updated_at = ?, error_json = ?
         WHERE state IN ('pending', 'learning', 'running', 'paused')`,
      )
    ).run(now, RESTART_ERROR);
    for (const { project_id } of projects) {
      await incrementRevision(database, project_id);
    }
  }

  private async getRevision(projectId: string): Promise<number> {
    const row = await (
      await (
        await this.db()
      ).prepare(
        "SELECT revision FROM paramfinder_session_projects WHERE project_id = ?",
      )
    ).get<{ revision: number }>(projectId);
    return row?.revision ?? 0;
  }

  private write<T>(operation: () => Promise<T>): Promise<T> {
    return this.writeQueue.run(async () => {
      await this.ready;
      return operation();
    });
  }

  private async db(): Promise<Database> {
    await this.ready;
    return this.dbWithoutReady();
  }

  private dbWithoutReady(): Database {
    if (this.database === undefined) {
      throw new Error("Session database not initialized");
    }
    return this.database;
  }
}

let sessionStore: SessionStore | undefined;
export function initSessionStore(
  sdk: BackendSDK,
  database?: Promise<Database>,
): SessionStore {
  sessionStore ??= new SessionStore(sdk, database);
  return sessionStore;
}
export function getSessionStore(): SessionStore {
  if (sessionStore === undefined)
    throw new Error("Session store not initialized");
  return sessionStore;
}

function nextNumericSessionId(sessionIds: Iterable<string>): string {
  let largest = 0n;
  for (const sessionId of sessionIds) {
    if (!/^\d+$/.test(sessionId)) continue;
    const value = BigInt(sessionId);
    if (value > largest) largest = value;
  }
  return String(largest + 1n);
}

function descriptorFromRow(row: SessionRow): SessionDescriptor {
  return sessionDescriptorSchema.parse({
    ref: { projectId: row.project_id, sessionId: row.session_id },
    state: row.state,
    phase: row.phase,
    totalParametersAmount: row.total_parameters_amount,
    totalLearnRequests: row.total_learn_requests,
    parametersSent: row.parameters_sent,
    requestsSent: row.requests_sent,
    findingsCount: row.findings_count,
    logsCount: row.logs_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: parseOptionalJson(row.error_json),
    rerun: parseOptionalJson(row.rerun_json),
  });
}

function parseOptionalJson(value: string | null | undefined): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  return JSON.parse(value);
}

function entryFromRow(row: EntryRow): SessionEntry {
  return sessionEntrySchema.parse({
    sequence: row.sequence,
    kind: row.kind,
    value: JSON.parse(row.value_json),
  });
}

function sequenceEntry(
  entry: SessionEntryInput,
  sequence: number,
): SessionEntry {
  switch (entry.kind) {
    case "request":
      return { ...entry, sequence };
    case "finding":
      return { ...entry, sequence };
    case "log":
      return { ...entry, sequence };
  }
}

async function ensureProject(database: Database, projectId: string) {
  await (
    await database.prepare(
      `INSERT OR IGNORE INTO paramfinder_session_projects
       (project_id, revision) VALUES (?, 0)`,
    )
  ).run(projectId);
}

async function incrementRevision(database: Database, projectId: string) {
  await (
    await database.prepare(
      `UPDATE paramfinder_session_projects
       SET revision = revision + 1 WHERE project_id = ?`,
    )
  ).run(projectId);
}

async function insertSession(database: Database, session: SessionDescriptor) {
  await (
    await database.prepare(
      `INSERT INTO paramfinder_sessions (${SESSION_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
  ).run(...sessionParameters(session));
}

async function updateSessionRow(
  database: Database,
  session: SessionDescriptor,
) {
  await (
    await database.prepare(
      `UPDATE paramfinder_sessions SET
       state = ?, phase = ?, total_parameters_amount = ?,
       total_learn_requests = ?, parameters_sent = ?, requests_sent = ?,
       findings_count = ?, logs_count = ?, created_at = ?, updated_at = ?,
       error_json = ?, rerun_json = ?
       WHERE project_id = ? AND session_id = ?`,
    )
  ).run(
    session.state,
    session.phase,
    session.totalParametersAmount,
    session.totalLearnRequests,
    session.parametersSent,
    session.requestsSent,
    session.findingsCount,
    session.logsCount,
    session.createdAt,
    session.updatedAt,
    session.error === undefined ? null : JSON.stringify(session.error),
    JSON.stringify(session.rerun),
    session.ref.projectId,
    session.ref.sessionId,
  );
}

function sessionParameters(session: SessionDescriptor): Parameter[] {
  return [
    session.ref.projectId,
    session.ref.sessionId,
    session.state,
    session.phase,
    session.totalParametersAmount,
    session.totalLearnRequests,
    session.parametersSent,
    session.requestsSent,
    session.findingsCount,
    session.logsCount,
    session.createdAt,
    session.updatedAt,
    session.error === undefined ? null : JSON.stringify(session.error),
    JSON.stringify(session.rerun),
  ];
}

async function insertEntries(
  database: Database,
  ref: SessionRef,
  entries: SessionEntry[],
) {
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
  await (
    await database.prepare(
      `INSERT INTO paramfinder_session_entries (
       project_id, session_id, sequence, kind, value_json, search_text,
       request_id, response_status, response_length, response_time,
       parameters_sent, parameters_tested, context, parameter, anomaly
       ) VALUES ${placeholders.join(", ")}`,
    )
  ).run(...parameters);
}

function entryProjections(entry: SessionEntry) {
  if (typeof entry.value === "string") return {};
  return {
    requestId: entry.value.requestId,
    responseStatus: entry.value.responseStatus,
    responseLength: entry.value.responseLength,
    responseTime:
      "responseTime" in entry.value ? entry.value.responseTime : undefined,
    parametersSent:
      "parametersSent" in entry.value ? entry.value.parametersSent : undefined,
    parametersTested:
      "parametersSent" in entry.value
        ? (entry.value.parametersTested ?? entry.value.parametersSent)
        : undefined,
    context: "context" in entry.value ? entry.value.context : undefined,
    parameter:
      "parameter" in entry.value ? entry.value.parameter.name : undefined,
    anomaly: "anomaly" in entry.value ? entry.value.anomaly.type : undefined,
  };
}

function sortColumn(field: SessionEntrySortField): string {
  const columns: Record<SessionEntrySortField, string> = {
    sequence: "sequence",
    requestId: "request_id",
    responseStatus: "response_status",
    responseLength: "response_length",
    responseTime: "response_time",
    parametersSent: "parameters_sent",
    parametersTested: "parameters_tested",
    context: "context",
    parameter: "parameter",
    anomaly: "anomaly",
  };
  return columns[field];
}

type ParsedCursor = { snapshotMaxSequence: number; offset: number };
export class InvalidCursorError extends Error {}
function parseCursor(
  cursor: string | undefined,
  expectedSignature: string,
): ParsedCursor | undefined {
  if (!cursor) return undefined;
  const match = /^v2:(\d+):(\d+):([A-Za-z0-9_-]+)$/.exec(cursor);
  if (!match) throw new InvalidCursorError("Invalid session entry cursor");
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
  if (match[3] !== expectedSignature) {
    throw new InvalidCursorError(
      "Session entry cursor does not match the current query",
    );
  }
  return { snapshotMaxSequence, offset };
}

function formatCursor(cursor: ParsedCursor, signature: string): string {
  return `v2:${cursor.snapshotMaxSequence}:${cursor.offset}:${signature}`;
}

function querySignature(query: SessionEntriesQuery): string {
  const sort = query.sort ?? { field: "sequence", direction: "asc" };
  const normalized = JSON.stringify({
    ref: query.ref,
    kind: query.kind,
    sort,
    filter: query.filter?.trim().toLowerCase() ?? "",
  });
  return Buffer.from(normalized, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
