import {
  compareSessionIds,
  type CursorPage,
  type ProjectSessionSnapshot,
  type SessionDescriptor,
  type SessionEntriesQuery,
  type SessionEntry,
  type SessionEntryInput,
  type SessionRef,
} from "shared";
import type { Database } from "sqlite";

import { createSessionEntries, querySessionEntries } from "./entries";
import {
  descriptorFromRow,
  nextNumericSessionId,
  SESSION_COLUMNS,
  sessionParameters,
  type SessionRow,
} from "./mapping";
import { bumpProjectRevision } from "./schema";

export class SessionsRepository {
  constructor(private readonly database: Database) {}

  async list(projectId: string): Promise<ProjectSessionSnapshot> {
    const projectStatement = await this.database.prepare(
      "SELECT revision FROM paramfinder_session_projects WHERE project_id = ?",
    );
    const project = await projectStatement.get<{ revision: number }>(projectId);

    const sessionsStatement = await this.database.prepare(
      `SELECT ${SESSION_COLUMNS}
       FROM paramfinder_sessions
       WHERE project_id = ?
       ORDER BY created_at DESC`,
    );
    const rows = await sessionsStatement.all<SessionRow>(projectId);
    const sessions = rows
      .map(descriptorFromRow)
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          compareSessionIds(right.ref.sessionId, left.ref.sessionId),
      );

    return {
      projectId,
      revision: project?.revision ?? 0,
      sessions,
    };
  }

  async find(ref: SessionRef): Promise<SessionDescriptor | undefined> {
    const statement = await this.database.prepare(
      `SELECT ${SESSION_COLUMNS}
       FROM paramfinder_sessions
       WHERE project_id = ? AND session_id = ?`,
    );
    const row = await statement.get<SessionRow>(ref.projectId, ref.sessionId);

    return row === undefined ? undefined : descriptorFromRow(row);
  }

  async nextSessionId(projectId: string): Promise<string> {
    const statement = await this.database.prepare(
      "SELECT session_id FROM paramfinder_sessions WHERE project_id = ?",
    );
    const rows = await statement.all<{ session_id: string }>(projectId);

    return nextNumericSessionId(rows.map(({ session_id }) => session_id));
  }

  async insert(session: SessionDescriptor): Promise<number> {
    await ensureProject(this.database, session.ref.projectId);

    const statement = await this.database.prepare(
      `INSERT INTO paramfinder_sessions (${SESSION_COLUMNS}, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await statement.run(...sessionParameters(session), Date.now());

    return bumpProjectRevision(this.database, session.ref.projectId);
  }

  async update(session: SessionDescriptor): Promise<number> {
    await updateSessionRow(this.database, session);

    return bumpProjectRevision(this.database, session.ref.projectId);
  }

  async appendEntries(
    ref: SessionRef,
    values: SessionEntryInput[],
    session: SessionDescriptor,
  ): Promise<{ revision: number; entries: SessionEntry[] }> {
    const entries = await createSessionEntries(this.database, ref, values);
    await updateSessionRow(this.database, session);

    const revision = await bumpProjectRevision(this.database, ref.projectId);

    return { revision, entries };
  }

  queryEntries(query: SessionEntriesQuery): Promise<CursorPage<SessionEntry>> {
    return querySessionEntries(this.database, query);
  }

  async delete(refs: SessionRef[]): Promise<Map<string, number>> {
    const affected = new Set<string>();
    const deletions: SessionRef[] = [];
    const exists = await this.database.prepare(
      `SELECT 1 AS present FROM paramfinder_sessions
       WHERE project_id = ? AND session_id = ?`,
    );

    for (const ref of refs) {
      const row = await exists.get<{ present: number }>(
        ref.projectId,
        ref.sessionId,
      );

      if (row === undefined) {
        continue;
      }

      affected.add(ref.projectId);
      deletions.push(ref);
    }

    if (deletions.length === 0) {
      return new Map();
    }

    const where = deletions
      .map(() => "(project_id = ? AND session_id = ?)")
      .join(" OR ");
    const parameters = deletions.flatMap(({ projectId, sessionId }) => [
      projectId,
      sessionId,
    ]);

    const deleteSessions = await this.database.prepare(
      `DELETE FROM paramfinder_sessions WHERE ${where}`,
    );
    await deleteSessions.run(...parameters);

    const deleteEntries = await this.database.prepare(
      `DELETE FROM paramfinder_session_entries WHERE ${where}`,
    );
    await deleteEntries.run(...parameters);

    const revisions = new Map<string, number>();

    for (const projectId of affected) {
      const revision = await bumpProjectRevision(this.database, projectId);
      revisions.set(projectId, revision);
    }

    return revisions;
  }
}

async function ensureProject(database: Database, projectId: string) {
  const statement = await database.prepare(
    `INSERT OR IGNORE INTO paramfinder_session_projects
     (project_id, revision) VALUES (?, 0)`,
  );
  await statement.run(projectId);
}

async function updateSessionRow(
  database: Database,
  session: SessionDescriptor,
) {
  const statement = await database.prepare(
    `UPDATE paramfinder_sessions SET
     state = ?, phase = ?, total_parameters_amount = ?,
     total_learn_requests = ?, parameters_sent = ?, requests_sent = ?,
     findings_count = ?, logs_count = ?, updated_at = ?,
     error_json = ?, rerun_json = ?
     WHERE project_id = ? AND session_id = ?`,
  );
  await statement.run(
    session.state,
    session.phase,
    session.totalParametersAmount,
    session.totalLearnRequests,
    session.parametersSent,
    session.requestsSent,
    session.findingsCount,
    session.logsCount,
    Date.now(),
    session.error === undefined ? null : JSON.stringify(session.error),
    JSON.stringify(session.rerun),
    session.ref.projectId,
    session.ref.sessionId,
  );
}
