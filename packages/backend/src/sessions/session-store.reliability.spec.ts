import { access, mkdtemp, readFile, rename, rm, writeFile } from "fs/promises";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BackendSDK } from "../types/types";

import {
  InvalidCursorError,
  type SessionFilePersistence,
  SessionStore,
} from "./session-store";

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
    additionalChecks: false,
    ignoreAnomalyTypes: [],
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

function createSdk(currentProjectId = projectA): BackendSDK {
  return {
    meta: {
      db: async () => {
        throw new Error("Session storage must not open SQLite");
      },
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
  persistence?: SessionFilePersistence,
): Promise<SessionStore> {
  const store = new SessionStore(createSdk(currentProjectId), persistence);
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

  it("uses an atomic JSON snapshot without opening the plugin database", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "stored" };
    await store.createSession(ref, 1, 3, createRerun());
    const snapshot = JSON.parse(
      await readFile(path.join(directory, "sessions-v2.json"), "utf8"),
    ) as { version: number; projects: unknown[] };
    expect(snapshot).toMatchObject({ version: 2 });
    expect(snapshot.projects).toHaveLength(1);
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
    expect(first?.nextCursor).toBe("v1:1205:1000");

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

  it("persists and retrieves 100,000 entries with complete counters and cursor coverage", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "stress" };
    const entryCount = 100_000;
    await store.createSession(ref, entryCount, 3, createRerun());
    await store.appendEntries(
      ref,
      Array.from({ length: entryCount }, (_, index) => ({
        kind: "request" as const,
        value: createSentRequest(index + 1, { parametersSent: 1 }),
      })),
    );
    await store.updateSession(ref, {
      state: EngineState.Completed,
      phase: EnginePhase.Discovery,
    });

    const restarted = await createStore();

    const seen = new Set<number>();
    let cursor: string | undefined;
    let expectedSequence = 1;
    do {
      const page = await restarted.getEntries({
        ref,
        kind: "request",
        cursor,
        limit: 1_000,
      });
      expect(page).toBeDefined();
      expect(page?.total).toBe(entryCount);
      expect(page?.snapshotMaxSequence).toBe(entryCount);
      for (const entry of page?.items ?? []) {
        expect(entry.sequence).toBe(expectedSequence);
        seen.add(entry.sequence);
        expectedSequence += 1;
      }
      cursor = page?.nextCursor;
    } while (cursor !== undefined);

    expect(seen.size).toBe(entryCount);
    expect(expectedSequence).toBe(entryCount + 1);
    await expect(restarted.getSession(ref)).resolves.toMatchObject({
      requestsSent: entryCount,
      parametersSent: entryCount,
    });
  }, 30_000);

  it("rejects a malformed pagination cursor with a typed error", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "cursor" };
    await store.createSession(ref, 1, 3, createRerun());

    await expect(
      store.getEntries({ ref, kind: "request", cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
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

  it("rolls back a multi-project delete and all revision increments when the atomic replace fails", async () => {
    let failReplace = false;
    const persistence: SessionFilePersistence = {
      readFile: async (filePath) => readFile(filePath, "utf8"),
      writeFile: async (filePath, contents) => writeFile(filePath, contents),
      replaceFile: async (from, to) => {
        if (failReplace) throw new Error("forced replace failure");
        await rename(from, to);
      },
      exists: async (filePath) => {
        try {
          await access(filePath);
          return true;
        } catch {
          return false;
        }
      },
    };
    const store = await createStore(projectA, persistence);
    const first: SessionRef = { projectId: projectA, sessionId: "keep-a" };
    const second: SessionRef = { projectId: projectB, sessionId: "fail-b" };
    await store.createSession(first, 1, 3, createRerun());
    await store.createSession(second, 1, 3, createRerun());
    const beforeA = await store.listSessions(projectA);
    const beforeB = await store.listSessions(projectB);
    failReplace = true;
    await expect(store.deleteSessions([first, second])).rejects.toThrow(
      "forced replace failure",
    );
    expect(await store.listSessions(projectA)).toMatchObject({
      revision: beforeA.revision,
      sessions: [{ ref: first }],
    });
    expect(await store.listSessions(projectB)).toMatchObject({
      revision: beforeB.revision,
      sessions: [{ ref: second }],
    });
    failReplace = false;
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

  it("migrates and preserves valid legacy descriptors, entries, and rerun data", async () => {
    const legacyPath = path.join(directory, `sessions-${projectA}.json`);
    const config = createConfig();
    const request = createRequest();
    await writeFile(
      legacyPath,
      JSON.stringify({
        version: 1,
        sessions: {
          legacy: {
            id: "legacy",
            state: EngineState.Completed,
            phase: EnginePhase.Discovery,
            totalParametersAmount: 2,
            totalLearnRequests: 3,
            parametersSent: 2,
            requestsSent: 1,
            sentRequests: [createSentRequest(1)],
            findings: [
              {
                requestId: "request-0001",
                responseStatus: 200,
                responseLength: 2,
                parameter: { name: "secret", value: "value" },
                anomaly: {
                  type: AnomalyType.StatusCode,
                  from: 404,
                  to: 200,
                },
              },
            ],
            logs: ["started", "completed"],
            rerun: { targetRequest: request, config },
          },
        },
      }),
    );

    const store = await createStore();
    const snapshot = await store.listSessions(projectA);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      ref: { projectId: projectA, sessionId: "legacy" },
      state: EngineState.Completed,
      requestsSent: 1,
      parametersSent: 2,
      findingsCount: 1,
      logsCount: 2,
      rerun: { targetRequest: request, config },
    });

    const migratedPath = `${legacyPath}.migrated`;
    await expect(readFile(migratedPath, "utf8")).resolves.toContain('"legacy"');
    const ref = { projectId: projectA, sessionId: "legacy" };
    await expect(
      store.getEntries({ ref, kind: "request" }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      store.getEntries({ ref, kind: "finding" }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(store.getEntries({ ref, kind: "log" })).resolves.toMatchObject(
      { total: 2 },
    );

    await rm(path.join(directory, "sessions-v2.json"));
    const recovered = await createStore();
    await expect(recovered.listSessions(projectA)).resolves.toMatchObject({
      sessions: [{ ref }],
    });
  });

  it("increments revisions monotonically across create, append, state, and delete", async () => {
    const store = await createStore();
    const ref: SessionRef = { projectId: projectA, sessionId: "revision" };
    const created = await store.createSession(ref, 1, 3, createRerun());
    const appended = await store.appendEntries(ref, [
      { kind: "log", value: "created" },
    ]);
    const updated = await store.updateSession(ref, {
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
    await original.updateSession(interrupted, {
      state: EngineState.Running,
      phase: EnginePhase.Discovery,
    });
    await original.createSession(completed, 10, 3, createRerun());
    await original.appendEntries(completed, [
      { kind: "request", value: createSentRequest(1) },
    ]);
    await original.updateSession(completed, {
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
