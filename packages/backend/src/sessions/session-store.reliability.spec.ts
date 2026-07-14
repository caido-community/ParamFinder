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

import type { BackendSDK } from "../types/types";

import { InvalidCursorError, SessionStore } from "./session-store";

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

function createSdk(
  currentProjectId = projectA,
  emptyStringForNull = false,
): BackendSDK {
  return {
    meta: {
      db: async () => createDatabase(emptyStringForNull),
      path: () => directory,
    },
    projects: {
      getCurrent: async () => ({ getId: () => currentProjectId }),
    },
    console,
  } as unknown as BackendSDK;
}

async function createStore(
  currentProjectId = projectA,
  emptyStringForNull = false,
): Promise<SessionStore> {
  const store = new SessionStore(
    createSdk(currentProjectId, emptyStringForNull),
  );
  await store.ready;
  return store;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "paramfinder-session-store-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("SessionStore reliability", () => {
  it("accepts empty strings returned for nullable JSON columns", async () => {
    const store = await createStore(projectA, true);
    const ref: SessionRef = { projectId: projectA, sessionId: "nullable-json" };

    await store.createSession(ref, 1, 3, createRerun());

    await expect(store.getSession(ref)).resolves.toMatchObject({
      ref,
      error: undefined,
      rerun: createRerun(),
    });
  });

  it("normalizes legacy rerun configs when reading sessions", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "legacy-config" };
    await store.createSession(ref, 1, 3, createRerun());

    const config: Record<string, unknown> = { ...createConfig() };
    delete config.autopilotEnabled;
    delete config.ignoreCloudflareBlocks;
    delete config.customValueType;

    const database = new DatabaseSync(path.join(directory, "meta.db"));
    database
      .prepare(
        `UPDATE paramfinder_sessions SET rerun_json = ?
         WHERE project_id = ? AND session_id = ?`,
      )
      .run(
        JSON.stringify({ targetRequest: createRequest(), config }),
        ref.projectId,
        ref.sessionId,
      );
    database.close();

    await expect(store.getSession(ref)).resolves.toMatchObject({
      rerun: {
        config: {
          autopilotEnabled: true,
          ignoreCloudflareBlocks: false,
          customValueType: "string",
        },
      },
    });
  });

  it("assigns the next session ID from the largest stored numeric ID", async () => {
    const store = await createStore();
    await store.createSession(
      { projectId: projectA, sessionId: "2" },
      1,
      3,
      createRerun(),
    );
    await store.createSession(
      { projectId: projectA, sessionId: "legacy-random-id" },
      1,
      3,
      createRerun(),
    );
    await store.createSession(
      { projectId: projectA, sessionId: "10" },
      1,
      3,
      createRerun(),
    );

    const reloaded = await createStore();
    const created = await reloaded.createNextSession(
      projectA,
      1,
      3,
      createRerun(),
    );

    expect(created.session.ref).toEqual({
      projectId: projectA,
      sessionId: "11",
    });
  });

  it("serializes automatic session ID allocation", async () => {
    const store = await createStore();

    const created = await Promise.all([
      store.createNextSession(projectA, 1, 3, createRerun()),
      store.createNextSession(projectA, 1, 3, createRerun()),
    ]);

    expect(created.map(({ session }) => session.ref.sessionId)).toEqual([
      "1",
      "2",
    ]);
  });

  it("lists numeric session IDs newest-first when timestamps match", async () => {
    const store = await createStore();
    const now = vi.spyOn(Date, "now").mockReturnValue(1);
    try {
      await store.createSession(
        { projectId: projectA, sessionId: "2" },
        1,
        3,
        createRerun(),
      );
      await store.createSession(
        { projectId: projectA, sessionId: "10" },
        1,
        3,
        createRerun(),
      );
    } finally {
      now.mockRestore();
    }

    const snapshot = await store.listSessions(projectA);

    expect(snapshot.sessions.map((session) => session.ref.sessionId)).toEqual([
      "10",
      "2",
    ]);
  });

  it("creates the normalized session tables and indexes in the plugin database", async () => {
    await createStore();
    const database = new DatabaseSync(path.join(directory, "meta.db"), {
      readOnly: true,
    });
    const objects = database
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE name LIKE 'paramfinder_session%' OR name LIKE 'paramfinder_entries%'`,
      )
      .all();

    expect(objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "paramfinder_session_projects",
          type: "table",
        }),
        expect.objectContaining({
          name: "paramfinder_sessions",
          type: "table",
        }),
        expect.objectContaining({
          name: "paramfinder_session_entries",
          type: "table",
        }),
        expect.objectContaining({
          name: "paramfinder_entries_by_session_kind_sequence",
          type: "index",
        }),
      ]),
    );
  });

  it("paginates a stable >1000-entry snapshot without duplicates or omissions", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "large" };
    await store.createSession(ref, 1_205, 3, createRerun());
    await store.appendEntries(
      ref,
      Array.from({ length: 1_205 }, (_, index) => ({
        kind: "request" as const,
        value: createSentRequest(index + 1),
      })),
    );

    const first = await store.getEntries({
      ref,
      kind: "request",
      limit: 1_000,
    });
    expect(first).toMatchObject({
      total: 1_205,
      snapshotMaxSequence: 1_205,
    });
    expect(first?.items).toHaveLength(1_000);
    expect(first?.items[0]?.sequence).toBe(1);
    expect(first?.items.at(-1)?.sequence).toBe(1_000);
    expect(first?.nextCursor).toMatch(/^v2:1205:1000:/);

    await store.appendEntries(
      ref,
      Array.from({ length: 5 }, (_, index) => ({
        kind: "request" as const,
        value: createSentRequest(1_206 + index),
      })),
    );
    const second = await store.getEntries({
      ref,
      kind: "request",
      cursor: first?.nextCursor,
      limit: 1_000,
    });
    expect(second).toMatchObject({
      total: 1_205,
      snapshotMaxSequence: 1_205,
      nextCursor: undefined,
    });
    expect(second?.items).toHaveLength(205);
    expect(second?.items[0]?.sequence).toBe(1_001);
    expect(second?.items.at(-1)?.sequence).toBe(1_205);

    const sequences = [...(first?.items ?? []), ...(second?.items ?? [])].map(
      (entry) => entry.sequence,
    );
    expect(new Set(sequences).size).toBe(1_205);
    expect(sequences).toEqual(
      Array.from({ length: 1_205 }, (_, index) => index + 1),
    );
    expect((await store.getSession(ref))?.requestsSent).toBe(1_210);
  });

  it("rejects a malformed pagination cursor with a typed error", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "cursor" };
    await store.createSession(ref, 1, 3, createRerun());

    await expect(
      store.getEntries({ ref, kind: "request", cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it("rejects a cursor reused with a different query", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "cursor-query" };
    await store.createSession(ref, 2, 3, createRerun());
    await store.appendEntries(ref, [
      { kind: "request", value: createSentRequest(1) },
      { kind: "request", value: createSentRequest(2) },
    ]);
    const first = await store.getEntries({
      ref,
      kind: "request",
      limit: 1,
    });

    await expect(
      store.getEntries({
        ref,
        kind: "request",
        cursor: first?.nextCursor,
        limit: 1,
        sort: { field: "responseStatus", direction: "desc" },
      }),
    ).rejects.toThrow("does not match");
  });

  it("rejects a cursor reused for another session", async () => {
    const store = await createStore();
    const firstRef: SessionRef = { projectId: projectA, sessionId: "cursor-a" };
    const secondRef: SessionRef = {
      projectId: projectA,
      sessionId: "cursor-b",
    };
    await store.createSession(firstRef, 2, 3, createRerun());
    await store.createSession(secondRef, 2, 3, createRerun());
    await store.appendEntries(firstRef, [
      { kind: "request", value: createSentRequest(1) },
      { kind: "request", value: createSentRequest(2) },
    ]);
    await store.appendEntries(secondRef, [
      { kind: "request", value: createSentRequest(3) },
      { kind: "request", value: createSentRequest(4) },
    ]);
    const first = await store.getEntries({
      ref: firstRef,
      kind: "request",
      limit: 1,
    });

    await expect(
      store.getEntries({
        ref: secondRef,
        kind: "request",
        cursor: first?.nextCursor,
        limit: 1,
      }),
    ).rejects.toThrow("does not match");
  });

  it("uses persisted projections for deterministic sorting and literal filters", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "sort" };
    await store.createSession(ref, 5, 3, createRerun());
    await store.appendEntries(ref, [
      { kind: "request", value: createSentRequest(1) },
      { kind: "request", value: createSentRequest(2) },
      { kind: "request", value: createSentRequest(3) },
      {
        kind: "request",
        value: createSentRequest(4, { requestId: "literal%_match" }),
      },
      { kind: "request", value: createSentRequest(5, { requestId: "xxAB" }) },
    ]);

    const sorted = await store.getEntries({
      ref,
      kind: "request",
      sort: { field: "responseStatus", direction: "desc" },
    });
    expect(
      sorted?.items.map((entry) => ({
        sequence: entry.sequence,
        status:
          typeof entry.value === "string"
            ? undefined
            : entry.value.responseStatus,
      })),
    ).toEqual([
      { sequence: 3, status: 500 },
      { sequence: 5, status: 200 },
      { sequence: 4, status: 200 },
      { sequence: 2, status: 200 },
      { sequence: 1, status: 200 },
    ]);

    const filtered = await store.getEntries({
      ref,
      kind: "request",
      filter: "%_",
    });
    expect(filtered?.total).toBe(1);
    expect(filtered?.items[0]?.value).toMatchObject({
      requestId: "literal%_match",
    });
  });

  it("stores quoted identifiers and entry values as data", async () => {
    const store = await createStore();
    const ref: SessionRef = {
      projectId: "project-'quoted'",
      sessionId: "session-'quoted'",
    };
    await store.createSession(ref, 1, 3, createRerun());
    await store.appendEntries(ref, [
      {
        kind: "request",
        value: createSentRequest(1, { requestId: "request-'quoted'" }),
      },
    ]);

    await expect(store.getSession(ref)).resolves.toMatchObject({ ref });
    await expect(
      store.getEntries({ ref, kind: "request" }),
    ).resolves.toMatchObject({
      items: [{ value: { requestId: "request-'quoted'" } }],
    });
  });

  it("sorts every projected entry field in SQLite", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "all-sorts" };
    await store.createSession(ref, 2, 3, createRerun());
    await store.appendEntries(ref, [
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

    const requestSorts = [
      ["sequence", [1, 2]],
      ["requestId", [2, 1]],
      ["responseStatus", [1, 2]],
      ["responseTime", [2, 1]],
      ["responseLength", [2, 1]],
      ["parametersSent", [1, 2]],
      ["parametersTested", [2, 1]],
      ["context", [1, 2]],
    ] as const;
    for (const [field, expected] of requestSorts) {
      const page = await store.getEntries({
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
      const page = await store.getEntries({
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

  it("keeps a deletion batch atomic when a row rejects the statement", async () => {
    const store = await createStore();
    const first: SessionRef = { projectId: projectA, sessionId: "keep-a" };
    const second: SessionRef = { projectId: projectB, sessionId: "fail-b" };
    await store.createSession(first, 1, 3, createRerun());
    await store.createSession(second, 1, 3, createRerun());
    const beforeA = await store.listSessions(projectA);
    const beforeB = await store.listSessions(projectB);

    const database = new DatabaseSync(path.join(directory, "meta.db"));
    database.exec(`
      CREATE TRIGGER reject_project_b_delete
      BEFORE DELETE ON paramfinder_sessions
      WHEN OLD.project_id = '${projectB}'
      BEGIN
        SELECT RAISE(ABORT, 'forced delete failure');
      END;
    `);
    await expect(store.deleteSessions([first, second])).rejects.toThrow(
      "forced delete failure",
    );
    expect(await store.listSessions(projectA)).toMatchObject({
      revision: beforeA.revision,
      sessions: [{ ref: first }],
    });
    expect(await store.listSessions(projectB)).toMatchObject({
      revision: beforeB.revision,
      sessions: [{ ref: second }],
    });
    database.exec("DROP TRIGGER reject_project_b_delete");

    const revisions = await store.deleteSessions([first, second]);
    expect(revisions).toEqual(
      new Map([
        [projectA, beforeA.revision + 1],
        [projectB, beforeB.revision + 1],
      ]),
    );
    expect((await store.listSessions(projectA)).sessions).toEqual([]);
    expect((await store.listSessions(projectB)).sessions).toEqual([]);
  });

  it("increments revisions monotonically across create, append, state, and delete", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "revision" };
    const created = await store.createSession(ref, 1, 3, createRerun());
    const appended = await store.appendEntries(ref, [
      { kind: "log", value: "created" },
    ]);
    const updated = await store.transitionSession(ref, {
      state: EngineState.Running,
      phase: EnginePhase.Discovery,
    });
    const deleted = await store.deleteSessions([ref]);

    expect([
      created.revision,
      appended?.revision,
      updated?.revision,
      deleted.get(projectA),
    ]).toEqual([1, 2, 3, 4]);
  });

  it("reconciles interrupted runtime states to a durable error on restart", async () => {
    const original = await createStore();
    const interrupted: SessionRef = {
      projectId: projectA,
      sessionId: "interrupted",
    };
    const completed: SessionRef = {
      projectId: projectA,
      sessionId: "completed",
    };
    await original.createSession(interrupted, 10, 3, createRerun());
    await original.transitionSession(interrupted, {
      state: EngineState.Running,
      phase: EnginePhase.Discovery,
    });
    await original.createSession(completed, 10, 3, createRerun());
    await original.appendEntries(completed, [
      { kind: "request", value: createSentRequest(1) },
    ]);
    await original.transitionSession(completed, {
      state: EngineState.Completed,
      phase: EnginePhase.Discovery,
    });
    const beforeRestart = await original.listSessions(projectA);

    const restarted = await createStore();
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
    ).resolves.toMatchObject({ total: 1 });
    expect((await restarted.listSessions(projectA)).revision).toBe(
      beforeRestart.revision + 1,
    );
  });
});
