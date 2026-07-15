import type { Database } from "sqlite";

const RESTART_ERROR = JSON.stringify({
  code: "INTERNAL",
  message: "Scan interrupted because the ParamFinder backend restarted.",
});

export async function initializeSessionDatabase(
  database: Database,
): Promise<void> {
  // The revision is the checkpoint between project hydration and live events.
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
  await failInterruptedSessions(database);
}

export async function bumpProjectRevision(
  database: Database,
  projectId: string,
): Promise<number> {
  const update = await database.prepare(
    `UPDATE paramfinder_session_projects
     SET revision = revision + 1
     WHERE project_id = ?`,
  );
  await update.run(projectId);

  const select = await database.prepare(
    "SELECT revision FROM paramfinder_session_projects WHERE project_id = ?",
  );
  const row = await select.get<{ revision: number }>(projectId);

  if (row === undefined) {
    throw new Error("Session project not initialized");
  }

  return row.revision;
}

async function failInterruptedSessions(database: Database): Promise<void> {
  const selectProjects = await database.prepare(
    `SELECT DISTINCT project_id FROM paramfinder_sessions
     WHERE state IN ('pending', 'learning', 'running', 'paused')`,
  );
  const projects = await selectProjects.all<{ project_id: string }>();

  if (projects.length === 0) {
    return;
  }

  const updateSessions = await database.prepare(
    `UPDATE paramfinder_sessions
     SET state = 'error', updated_at = ?, error_json = ?
     WHERE state IN ('pending', 'learning', 'running', 'paused')`,
  );
  await updateSessions.run(Date.now(), RESTART_ERROR);

  for (const { project_id } of projects) {
    await bumpProjectRevision(database, project_id);
  }
}
