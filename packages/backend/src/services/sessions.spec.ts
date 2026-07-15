import { mkdtemp, rm } from "fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "os";
import path from "path";

import { AnomalyType, EnginePhase, EngineState } from "@paramfinder/engine";
import type {
  ParamMinerConfig,
  Request,
  SentRequest,
  SessionRef,
  SessionRerun,
} from "shared";
import type { Database, Parameter } from "sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initializeSessionDatabase,
  SessionsRepository,
} from "../repositories/sessions";

import {
  InvalidCursorError,
  type SessionsPersistence,
  SessionsService,
} from "./sessions";

let directory: string;

const projectA = "project-a";
const projectB = "project-b";

function createRequest(): Request {
  return {
    id: "target",
    host: "example.com",
    port: 443,
    url: "https://example.com/",
    path: "/",
    query: "",
    method: "GET",
    headers: { Host: ["example.com"] },
    body: "",
    tls: true,
    raw: "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n",
    context: "discovery",
  };
}

function createConfig(): ParamMinerConfig {
  return {
    attackType: "query",
    learnRequestsCount: 3,
    autoDetectMaxSize: false,
    maxQuerySize: 200,
    updateContentLength: false,
    autopilotEnabled: false,
    addCacheBusterParameter: false,
    wafDetection: false,
    ignoreCloudflareBlocks: false,
    additionalChecks: false,
    ignoreAnomalyTypes: [],
    customValueType: "string",
    delayBetweenRequests: 0,
    requestTimeoutSeconds: 5,
    scanTimeoutSeconds: 60,
    debug: false,
  };
}

function createRerun(): SessionRerun {
  return { targetRequest: createRequest(), config: createConfig() };
}

function createSentRequest(
  index: number,
  overrides: Partial<SentRequest> = {},
) {
  return {
    requestId: `request-${index.toString().padStart(4, "0")}`,
    responseStatus: index % 3 === 0 ? 500 : 200,
    responseTime: index,
    responseLength: index * 2,
    parametersSent: (index % 5) + 1,
    parametersTested: (index % 5) + 1,
    context: "discovery" as const,
    ...overrides,
  };
}

function createDatabase(emptyStringForNull = false): Database {
  const database = new DatabaseSync(path.join(directory, "meta.db"));
  database.exec("PRAGMA foreign_keys = ON");
  return {
    exec: async (sql) => {
      if (/\b(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
        throw new Error(
          "Explicit transactions are unsupported by Caido SQLite",
        );
      }
      database.exec(sql);
    },
    prepare: async (sql) => {
      const statement = database.prepare(sql);
      return {
        all: async <T extends object>(...params: Parameter[]) =>
          statement.all(...params) as T[],
        get: async <T extends object>(...params: Parameter[]) => {
          const row = statement.get(...params) as T | undefined;
          if (!emptyStringForNull || row === undefined) return row;
          return Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              value === null ? "" : value,
            ]),
          ) as T;
        },
        run: async (...params: Parameter[]) => {
          const result = statement.run(...params);
          return {
            changes: Number(result.changes),
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
      };
    },
  };
}

async function createService(
  emptyStringForNull = false,
): Promise<SessionsService> {
  const database = createDatabase(emptyStringForNull);
  await initializeSessionDatabase(database);

  const repository = new SessionsRepository(database);
  return new SessionsService(repository);
}

function insertPersistedSession(ref: SessionRef, createdAt = Date.now()): void {
  const database = new DatabaseSync(path.join(directory, "meta.db"));
  database
    .prepare(
      `INSERT OR IGNORE INTO paramfinder_session_projects
       (project_id, revision) VALUES (?, 0)`,
    )
    .run(ref.projectId);
  database
    .prepare(
      `INSERT INTO paramfinder_sessions (
       project_id, session_id, state, phase, total_parameters_amount,
       total_learn_requests, parameters_sent, requests_sent, findings_count,
       logs_count, created_at, updated_at, error_json, rerun_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref.projectId,
      ref.sessionId,
      EngineState.Pending,
      EnginePhase.Idle,
      1,
      3,
      0,
      0,
      0,
      0,
      createdAt,
      createdAt,
      null,
      JSON.stringify(createRerun()),
    );
  database.close();
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "paramfinder-sessions-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("SessionsService", () => {
  it("accepts empty strings returned for nullable JSON columns", async () => {
    const service = await createService(true);
    const { ref } = (
      await service.createNextSession(projectA, 1, 3, createRerun())
    ).session;

    await expect(service.getSession(ref)).resolves.toMatchObject({
      ref,
      error: undefined,
      rerun: createRerun(),
    });
  });

  it("assigns IDs from stored numeric IDs and serializes allocation", async () => {
    const service = await createService();
    insertPersistedSession({ projectId: projectA, sessionId: "2" });
    insertPersistedSession({
      projectId: projectA,
      sessionId: "legacy-random-id",
    });
    insertPersistedSession({ projectId: projectA, sessionId: "10" });

    const created = await Promise.all([
      service.createNextSession(projectA, 1, 3, createRerun()),
      service.createNextSession(projectA, 1, 3, createRerun()),
    ]);

    expect(created.map(({ session }) => session.ref.sessionId)).toEqual([
      "11",
      "12",
    ]);
  });

  it("lists numeric session IDs newest-first when timestamps match", async () => {
    const service = await createService();
    insertPersistedSession({ projectId: projectA, sessionId: "2" }, 1);
    insertPersistedSession({ projectId: projectA, sessionId: "10" }, 1);

    const snapshot = await service.listSessions(projectA);

    expect(snapshot.sessions.map((session) => session.ref.sessionId)).toEqual([
      "10",
      "2",
    ]);
  });

  it("paginates a stable snapshot without duplicates or omissions", async () => {
    const service = await createService();
    const { ref } = (
      await service.createNextSession(projectA, 1_205, 3, createRerun())
    ).session;
    await service.appendEntries(
      ref,
      Array.from({ length: 1_205 }, (_, index) => ({
        kind: "request" as const,
        value: createSentRequest(index + 1),
      })),
    );

    const first = await service.getEntries({
      ref,
      kind: "request",
      limit: 1_000,
    });
    expect(first).toMatchObject({ snapshotMaxSequence: 1_205 });
    expect(first?.items).toHaveLength(1_000);

    await service.appendEntries(
      ref,
      Array.from({ length: 5 }, (_, index) => ({
        kind: "request" as const,
        value: createSentRequest(1_206 + index),
      })),
    );
    const second = await service.getEntries({
      ref,
      kind: "request",
      cursor: first?.nextCursor,
      limit: 1_000,
    });
    expect(second).toMatchObject({
      snapshotMaxSequence: 1_205,
      nextCursor: undefined,
    });
    expect(second?.items).toHaveLength(205);

    const sequences = [...(first?.items ?? []), ...(second?.items ?? [])].map(
      ({ sequence }) => sequence,
    );
    expect(sequences).toEqual(
      Array.from({ length: 1_205 }, (_, index) => index + 1),
    );
    expect((await service.getSession(ref))?.requestsSent).toBe(1_210);
  });

  it("rejects malformed and mismatched pagination cursors", async () => {
    const service = await createService();
    const firstRef = (
      await service.createNextSession(projectA, 2, 3, createRerun())
    ).session.ref;
    const secondRef = (
      await service.createNextSession(projectA, 2, 3, createRerun())
    ).session.ref;
    await service.appendEntries(firstRef, [
      { kind: "request", value: createSentRequest(1) },
      { kind: "request", value: createSentRequest(2) },
    ]);
    const first = await service.getEntries({
      ref: firstRef,
      kind: "request",
      limit: 1,
    });

    await expect(
      service.getEntries({
        ref: firstRef,
        kind: "request",
        cursor: "not-a-cursor",
      }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(
      service.getEntries({
        ref: firstRef,
        kind: "request",
        cursor: first?.nextCursor,
        limit: 1,
        sort: { field: "responseStatus", direction: "desc" },
      }),
    ).rejects.toThrow("does not match");
    await expect(
      service.getEntries({
        ref: secondRef,
        kind: "request",
        cursor: first?.nextCursor,
        limit: 1,
      }),
    ).rejects.toThrow("does not match");
  });

  it("uses persisted projections for sorting and literal filters", async () => {
    const service = await createService();
    const { ref } = (
      await service.createNextSession(projectA, 5, 3, createRerun())
    ).session;
    await service.appendEntries(ref, [
      { kind: "request", value: createSentRequest(1) },
      { kind: "request", value: createSentRequest(2) },
      { kind: "request", value: createSentRequest(3) },
      {
        kind: "request",
        value: createSentRequest(4, { requestId: "literal%_match" }),
      },
      { kind: "request", value: createSentRequest(5, { requestId: "xxAB" }) },
    ]);

    const sorted = await service.getEntries({
      ref,
      kind: "request",
      sort: { field: "responseStatus", direction: "desc" },
    });
    expect(sorted?.items.map(({ sequence }) => sequence)).toEqual([
      3, 5, 4, 2, 1,
    ]);

    const filtered = await service.getEntries({
      ref,
      kind: "request",
      filter: "%_",
    });
    expect(filtered?.items).toHaveLength(1);
    expect(filtered?.items[0]?.value).toMatchObject({
      requestId: "literal%_match",
    });
  });

  it("sorts every projected entry field in SQLite", async () => {
    const service = await createService();
    const { ref } = (
      await service.createNextSession(projectA, 2, 3, createRerun())
    ).session;
    await service.appendEntries(ref, [
      {
        kind: "request",
        value: createSentRequest(1, {
          requestId: "z",
          responseStatus: 201,
          responseTime: 20,
          responseLength: 100,
          parametersSent: 2,
          parametersTested: 5,
          context: "discovery",
        }),
      },
      {
        kind: "request",
        value: createSentRequest(2, {
          requestId: "a",
          responseStatus: 500,
          responseTime: 10,
          responseLength: 50,
          parametersSent: 4,
          parametersTested: 4,
          context: "learning",
        }),
      },
      {
        kind: "finding",
        value: {
          requestId: "finding-z",
          responseStatus: 201,
          responseLength: 100,
          parameter: { name: "z", value: "1" },
          anomaly: { type: AnomalyType.StatusCode, from: 200, to: 201 },
        },
      },
      {
        kind: "finding",
        value: {
          requestId: "finding-a",
          responseStatus: 500,
          responseLength: 50,
          parameter: { name: "a", value: "2" },
          anomaly: { type: AnomalyType.Redirect },
        },
      },
    ]);

    for (const [field, expected] of [
      ["sequence", [1, 2]],
      ["requestId", [2, 1]],
      ["responseStatus", [1, 2]],
      ["responseTime", [2, 1]],
      ["responseLength", [2, 1]],
      ["parametersSent", [1, 2]],
      ["parametersTested", [2, 1]],
      ["context", [1, 2]],
    ] as const) {
      const page = await service.getEntries({
        ref,
        kind: "request",
        sort: { field, direction: "asc" },
      });
      expect(
        page?.items.map(({ sequence }) => sequence),
        field,
      ).toEqual(expected);
    }

    for (const [field, expected] of [
      ["parameter", [4, 3]],
      ["anomaly", [4, 3]],
    ] as const) {
      const page = await service.getEntries({
        ref,
        kind: "finding",
        sort: { field, direction: "asc" },
      });
      expect(
        page?.items.map(({ sequence }) => sequence),
        field,
      ).toEqual(expected);
    }
  });

  it("stores quoted identifiers and entry values as data", async () => {
    const service = await createService();
    const { ref } = (
      await service.createNextSession("project-'quoted'", 1, 3, createRerun())
    ).session;
    await service.appendEntries(ref, [
      {
        kind: "request",
        value: createSentRequest(1, { requestId: "request-'quoted'" }),
      },
    ]);

    await expect(service.getSession(ref)).resolves.toMatchObject({ ref });
    await expect(
      service.getEntries({ ref, kind: "request" }),
    ).resolves.toMatchObject({
      items: [{ value: { requestId: "request-'quoted'" } }],
    });
  });

  it("keeps a deletion batch atomic when a row rejects the statement", async () => {
    const service = await createService();
    const first = (
      await service.createNextSession(projectA, 1, 3, createRerun())
    ).session.ref;
    const second = (
      await service.createNextSession(projectB, 1, 3, createRerun())
    ).session.ref;
    const beforeA = await service.listSessions(projectA);
    const beforeB = await service.listSessions(projectB);

    const database = new DatabaseSync(path.join(directory, "meta.db"));
    database.exec(`
      CREATE TRIGGER reject_project_b_delete
      BEFORE DELETE ON paramfinder_sessions
      WHEN OLD.project_id = '${projectB}'
      BEGIN
        SELECT RAISE(ABORT, 'forced delete failure');
      END;
    `);
    await expect(service.deleteSessions([first, second])).rejects.toThrow(
      "forced delete failure",
    );
    expect(await service.listSessions(projectA)).toMatchObject({
      revision: beforeA.revision,
      sessions: [{ ref: first }],
    });
    expect(await service.listSessions(projectB)).toMatchObject({
      revision: beforeB.revision,
      sessions: [{ ref: second }],
    });
    database.exec("DROP TRIGGER reject_project_b_delete");

    const revisions = await service.deleteSessions([first, second]);
    expect(revisions).toEqual(
      new Map([
        [projectA, beforeA.revision + 1],
        [projectB, beforeB.revision + 1],
      ]),
    );
  });

  it("increments revisions across create, append, state, and delete", async () => {
    const service = await createService();
    const created = await service.createNextSession(
      projectA,
      1,
      3,
      createRerun(),
    );
    const { ref } = created.session;
    const appended = await service.appendEntries(ref, [
      { kind: "log", value: "created" },
    ]);
    const updated = await service.transitionSession(ref, {
      state: EngineState.Running,
      phase: EnginePhase.Discovery,
    });
    const deleted = await service.deleteSessions([ref]);

    expect([
      created.revision,
      appended?.revision,
      updated?.revision,
      deleted.get(projectA),
    ]).toEqual([1, 2, 3, 4]);
  });

  it("reconciles interrupted states to a durable error on restart", async () => {
    const original = await createService();
    const interrupted = (
      await original.createNextSession(projectA, 10, 3, createRerun())
    ).session.ref;
    await original.transitionSession(interrupted, {
      state: EngineState.Running,
      phase: EnginePhase.Discovery,
    });
    const completed = (
      await original.createNextSession(projectA, 10, 3, createRerun())
    ).session.ref;
    await original.appendEntries(completed, [
      { kind: "request", value: createSentRequest(1) },
    ]);
    await original.transitionSession(completed, {
      state: EngineState.Completed,
      phase: EnginePhase.Discovery,
    });
    const beforeRestart = await original.listSessions(projectA);

    const restarted = await createService();
    await expect(restarted.getSession(interrupted)).resolves.toMatchObject({
      state: EngineState.Error,
      phase: EnginePhase.Discovery,
      error: {
        code: "INTERNAL",
        message: expect.stringContaining("backend restarted"),
      },
    });
    await expect(restarted.getSession(completed)).resolves.toMatchObject({
      state: EngineState.Completed,
      requestsSent: 1,
    });
    await expect(
      restarted.getEntries({ ref: completed, kind: "request" }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ kind: "request" })],
    });
    expect((await restarted.listSessions(projectA)).revision).toBe(
      beforeRestart.revision + 1,
    );
  });

  it("queues reads behind an in-progress mutation", async () => {
    let releaseInsert: (() => void) | undefined;
    const insert = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          releaseInsert = () => resolve(1);
        }),
    );
    const find = vi.fn(async () => undefined);
    const repository = {
      nextSessionId: async () => "1",
      insert,
      find,
    } as unknown as SessionsPersistence;
    const service = new SessionsService(repository);

    const create = service.createNextSession(projectA, 1, 3, createRerun());
    await vi.waitFor(() => expect(insert).toHaveBeenCalledOnce());
    const read = service.getSession({ projectId: projectA, sessionId: "1" });
    await Promise.resolve();
    expect(find).not.toHaveBeenCalled();

    releaseInsert?.();
    await create;
    await read;
    expect(find).toHaveBeenCalledOnce();
  });
});
