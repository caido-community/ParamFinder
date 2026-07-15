import {
  AnomalyType,
  type DiscoveryEvent,
  EnginePhase,
  EngineState,
  RunControl,
  type RunDiscoveryScanResult,
} from "@paramfinder/engine";
import type {
  ParamMinerConfig,
  Request,
  SessionChangeEnvelope,
  SessionDescriptor,
  SessionEntry,
  SessionEntryInput,
  SessionLifecycle,
  SessionRef,
} from "shared";
import { sessionDescriptorSchema } from "shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RunningSessionsStore } from "../stores/running-sessions";
import type { BackendSDK } from "../types";

import { MiningService } from "./mining";
import type { SessionsService } from "./sessions";
import type { WordlistsService } from "./wordlists";

const testState = vi.hoisted(() => ({ runDiscoveryScan: vi.fn() }));

vi.mock("@paramfinder/engine", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runDiscoveryScan: testState.runDiscoveryScan };
});

vi.mock("../engine/caido-provider", () => ({
  CaidoRequestProvider: class {},
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
};

type SessionsMock = ReturnType<typeof createSessions>;

const ref: SessionRef = { projectId: "project-1", sessionId: "session-1" };
let scan: Deferred<RunDiscoveryScanResult>;
let emitEngineEvent: ((event: DiscoveryEvent) => void) | undefined;
let scanSignal: AbortSignal | undefined;
let sessions: SessionsMock;
let envelopes: SessionChangeEnvelope[];
let runningSessions: RunningSessionsStore;
let service: MiningService;
let currentProjectId: string | undefined;
let loadEnabledWords: ReturnType<typeof vi.fn>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

function createDescriptor(): SessionDescriptor {
  return {
    ref,
    state: EngineState.Pending,
    phase: EnginePhase.Idle,
    totalParametersAmount: 2,
    totalLearnRequests: 3,
    parametersSent: 0,
    requestsSent: 0,
    findingsCount: 0,
    logsCount: 0,
    createdAt: 1,
    rerun: { targetRequest: createRequest(), config: createConfig() },
  };
}

function createSessions() {
  let revision = 0;
  let sequence = 0;
  let session = createDescriptor();
  const operations: string[] = [];

  return {
    operations,
    current: () => session,
    createNextSession: vi.fn(async () => {
      operations.push("create");
      revision += 1;
      return { revision, session: structuredClone(session) };
    }),
    getSession: vi.fn(async () => structuredClone(session)),
    transitionSession: vi.fn(
      async (_ref: SessionRef, lifecycle: SessionLifecycle) => {
        operations.push(`update:${lifecycle.state}`);
        session = sessionDescriptorSchema.parse({ ...session, ...lifecycle });
        revision += 1;
        return { revision, session: structuredClone(session) };
      },
    ),
    setTotalParametersAmount: vi.fn(
      async (_ref: SessionRef, totalParametersAmount: number) => {
        operations.push("update:counters");
        session = { ...session, totalParametersAmount };
        revision += 1;
        return { revision, session: structuredClone(session) };
      },
    ),
    appendEntries: vi.fn(
      async (_ref: SessionRef, pending: SessionEntryInput[]) => {
        operations.push("append");
        const entries: SessionEntry[] = pending.map((entry) => ({
          sequence: (sequence += 1),
          ...entry,
        }));
        for (const entry of pending) {
          if (entry.kind === "request") {
            session.requestsSent += 1;
            session.parametersSent += entry.value.parametersSent;
          } else if (entry.kind === "finding") {
            session.findingsCount += 1;
          } else {
            session.logsCount += 1;
          }
        }
        revision += 1;
        return { revision, entries, session: structuredClone(session) };
      },
    ),
    deleteSessions: vi.fn(async (refs: SessionRef[]) => {
      operations.push("delete");
      return new Map(
        [...new Set(refs.map((candidate) => candidate.projectId))].map(
          (projectId) => [projectId, (revision += 1)],
        ),
      );
    }),
  };
}

function createSdk(): BackendSDK {
  return {
    api: {
      send: (_event: string, envelope: SessionChangeEnvelope) => {
        envelopes.push(envelope);
      },
    },
    console,
    projects: {
      getCurrent: vi.fn(async () => {
        const projectId = currentProjectId;
        return projectId === undefined ? undefined : { getId: () => projectId };
      }),
    },
  } as unknown as BackendSDK;
}

function scanResult(
  state: EngineState,
  phase: EnginePhase,
): RunDiscoveryScanResult {
  return {
    result: {
      state,
      phase,
      findings: [],
      totalParametersAmount: 2,
    } as RunDiscoveryScanResult["result"],
    summary: {
      state,
      phase,
      findings: [],
      totalParametersAmount: 2,
      requestsSent: 0,
      parametersSent: 0,
      findingsCount: 0,
    } as RunDiscoveryScanResult["summary"],
  };
}

beforeEach(() => {
  scan = deferred<RunDiscoveryScanResult>();
  sessions = createSessions();
  envelopes = [];
  emitEngineEvent = undefined;
  scanSignal = undefined;
  currentProjectId = ref.projectId;
  loadEnabledWords = vi.fn(async () => ["alpha", "secret"]);
  runningSessions = new RunningSessionsStore();
  service = new MiningService(
    createSdk(),
    sessions as unknown as SessionsService,
    {
      loadEnabledWords,
    } as unknown as WordlistsService,
    runningSessions,
    currentProjectId,
  );
  testState.runDiscoveryScan.mockReset();
  testState.runDiscoveryScan.mockImplementation(
    async (
      _dependencies: unknown,
      input: {
        runOptions?: {
          signal?: AbortSignal;
          onEvent?: (event: DiscoveryEvent) => void;
        };
      },
    ) => {
      sessions.operations.push("run");
      scanSignal = input.runOptions?.signal;
      emitEngineEvent = input.runOptions?.onEvent;
      emitEngineEvent?.({
        type: "state",
        state: EngineState.Learning,
        phase: EnginePhase.Learning,
      });
      return await scan.promise;
    },
  );
});

describe("MiningService", () => {
  it("rejects invalid engine configuration before creating a session", async () => {
    await expect(
      service.start(ref.projectId, createRequest(), {
        ...createConfig(),
        customValue: "not-an-integer",
        customValueType: "integer",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });

    expect(sessions.createNextSession).not.toHaveBeenCalled();
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
    expect(envelopes).toEqual([]);
  });

  it("rejects sub-millisecond timeouts before creating a session", async () => {
    await expect(
      service.start(ref.projectId, createRequest(), {
        ...createConfig(),
        scanTimeoutSeconds: 0.0005,
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });

    expect(sessions.createNextSession).not.toHaveBeenCalled();
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
  });

  it("rejects an unsupported body before creating a session", async () => {
    const request = {
      ...createRequest(),
      method: "POST",
      raw: "POST / HTTP/1.1\r\nHost: example.com\r\n\r\n",
    };

    await expect(
      service.start(ref.projectId, request, {
        ...createConfig(),
        attackType: "body",
      }),
    ).resolves.toEqual({
      success: false,
      error: {
        code: "VALIDATION",
        message: "Unsupported body type for mutation: text",
      },
    });

    expect(sessions.createNextSession).not.toHaveBeenCalled();
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
  });

  it("terminalizes a created session when startup persistence fails", async () => {
    sessions.transitionSession.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      service.start(ref.projectId, createRequest(), createConfig()),
    ).resolves.toMatchObject({ success: false });

    expect(sessions.current()).toMatchObject({
      state: EngineState.Error,
      phase: EnginePhase.Idle,
      error: { message: "database unavailable" },
    });
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
    expect(envelopes.flatMap((envelope) => envelope.changes)).toContainEqual(
      expect.objectContaining({
        type: "terminal",
        session: expect.objectContaining({ state: EngineState.Error }),
      }),
    );
  });

  it("does not create a session when the project changes while loading words", async () => {
    const words = deferred<string[]>();
    loadEnabledWords.mockReturnValueOnce(words.promise);

    const started = service.start(
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    await vi.waitFor(() => expect(loadEnabledWords).toHaveBeenCalledOnce());

    currentProjectId = "project-2";
    await service.pauseOutsideProject(currentProjectId);
    words.resolve(["alpha", "secret"]);

    await expect(started).resolves.toMatchObject({
      success: false,
      error: { code: "CONFLICT" },
    });
    expect(sessions.createNextSession).not.toHaveBeenCalled();
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
  });

  it("starts against the current project when the project event cache lags", async () => {
    service = new MiningService(
      createSdk(),
      sessions as unknown as SessionsService,
      {
        loadEnabledWords,
      } as unknown as WordlistsService,
      runningSessions,
      "previous-project",
    );

    await expect(
      service.start(ref.projectId, createRequest(), createConfig()),
    ).resolves.toMatchObject({ success: true });
    expect(testState.runDiscoveryScan).toHaveBeenCalledOnce();

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("cancels startup when the project changes during session creation", async () => {
    const creation = deferred<void>();
    const createSession = sessions.createNextSession.getMockImplementation();
    sessions.createNextSession.mockImplementationOnce(async () => {
      await creation.promise;
      return createSession!();
    });

    const started = service.start(
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    await vi.waitFor(() =>
      expect(sessions.createNextSession).toHaveBeenCalledOnce(),
    );

    currentProjectId = "project-2";
    await service.pauseOutsideProject(currentProjectId);
    creation.resolve();

    await expect(started).resolves.toMatchObject({
      success: false,
      error: { code: "CONFLICT" },
    });
    expect(sessions.current().state).toBe(EngineState.Canceled);
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
  });

  it("pauses a running session when another project becomes active", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());
    await vi.waitFor(() =>
      expect(sessions.current().state).toBe(EngineState.Learning),
    );

    await expect(service.pauseOutsideProject("project-2")).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(sessions.current().state).toBe(EngineState.Paused);

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("rolls back a stale project pause when its project becomes active", async () => {
    const resume = vi.spyOn(RunControl.prototype, "resume");
    await service.start(ref.projectId, createRequest(), createConfig());

    const pausePersistence = deferred<void>();
    const transitionSession =
      sessions.transitionSession.getMockImplementation();
    sessions.transitionSession.mockImplementationOnce(
      async (sessionRef, lifecycle) => {
        await pausePersistence.promise;
        return transitionSession!(sessionRef, lifecycle);
      },
    );

    currentProjectId = "project-2";
    const pausing = service.pauseOutsideProject(currentProjectId);
    await vi.waitFor(() =>
      expect(sessions.transitionSession).toHaveBeenLastCalledWith(
        ref,
        expect.objectContaining({ state: EngineState.Paused }),
      ),
    );

    currentProjectId = ref.projectId;
    await service.pauseOutsideProject(currentProjectId);
    pausePersistence.resolve();

    await expect(pausing).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(sessions.current().state).toBe(EngineState.Learning);
    expect(resume).toHaveBeenCalledOnce();

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("does not roll back a concurrent manual pause", async () => {
    const resume = vi.spyOn(RunControl.prototype, "resume");
    await service.start(ref.projectId, createRequest(), createConfig());

    const pausePersistence = deferred<void>();
    const rollbackPersistence = deferred<void>();
    let transitionIndex = 0;
    const transitionSession =
      sessions.transitionSession.getMockImplementation();
    sessions.transitionSession.mockImplementation(
      async (sessionRef, lifecycle) => {
        const persistence =
          transitionIndex === 0 ? pausePersistence : rollbackPersistence;
        transitionIndex += 1;
        await persistence.promise;
        return transitionSession!(sessionRef, lifecycle);
      },
    );

    currentProjectId = "project-2";
    const projectPause = service.pauseOutsideProject(currentProjectId);
    await vi.waitFor(() =>
      expect(sessions.transitionSession).toHaveBeenLastCalledWith(
        ref,
        expect.objectContaining({ state: EngineState.Paused }),
      ),
    );

    currentProjectId = ref.projectId;
    await service.pauseOutsideProject(currentProjectId);
    pausePersistence.resolve();
    await vi.waitFor(() =>
      expect(sessions.transitionSession).toHaveBeenLastCalledWith(
        ref,
        expect.objectContaining({ state: EngineState.Learning }),
      ),
    );

    const manualPause = service.pause(ref);
    rollbackPersistence.resolve();

    await expect(projectPause).resolves.toEqual({
      success: true,
      value: undefined,
    });
    await expect(manualPause).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(sessions.current().state).toBe(EngineState.Paused);
    expect(resume).not.toHaveBeenCalled();

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("keeps persistence paused when pause races resume", async () => {
    const resumeControl = vi.spyOn(RunControl.prototype, "resume");
    await service.start(ref.projectId, createRequest(), createConfig());
    await service.pause(ref);

    const resumePersistence = deferred<void>();
    const transitionSession =
      sessions.transitionSession.getMockImplementation();
    sessions.transitionSession.mockImplementationOnce(
      async (sessionRef, lifecycle) => {
        await resumePersistence.promise;
        return transitionSession!(sessionRef, lifecycle);
      },
    );

    const resuming = service.resume(ref);
    await vi.waitFor(() =>
      expect(sessions.transitionSession).toHaveBeenLastCalledWith(
        ref,
        expect.objectContaining({ state: EngineState.Learning }),
      ),
    );

    const pausing = service.pause(ref);
    resumePersistence.resolve();

    await expect(resuming).resolves.toEqual({
      success: true,
      value: undefined,
    });
    await expect(pausing).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(sessions.current().state).toBe(EngineState.Paused);
    expect(resumeControl).not.toHaveBeenCalled();

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("reconciles repeated project changes during pause persistence", async () => {
    const resume = vi.spyOn(RunControl.prototype, "resume");
    await service.start(ref.projectId, createRequest(), createConfig());

    const transitions = Array.from({ length: 4 }, () => deferred<void>());
    let transitionIndex = 0;
    const transitionSession =
      sessions.transitionSession.getMockImplementation();
    sessions.transitionSession.mockImplementation(
      async (sessionRef, lifecycle) => {
        const transition = transitions[transitionIndex];
        transitionIndex += 1;
        await transition?.promise;
        return transitionSession!(sessionRef, lifecycle);
      },
    );

    currentProjectId = "project-2";
    const pausing = service.pauseOutsideProject(currentProjectId);
    await vi.waitFor(() =>
      expect(
        sessions.transitionSession.mock.calls.filter(
          ([, lifecycle]) => lifecycle.state === EngineState.Paused,
        ),
      ).toHaveLength(1),
    );

    currentProjectId = ref.projectId;
    await service.pauseOutsideProject(currentProjectId);
    transitions[0]?.resolve();
    await vi.waitFor(() =>
      expect(
        sessions.transitionSession.mock.calls.filter(
          ([, lifecycle]) => lifecycle.state === EngineState.Learning,
        ),
      ).toHaveLength(2),
    );

    currentProjectId = "project-2";
    await service.pauseOutsideProject(currentProjectId);
    transitions[1]?.resolve();
    await vi.waitFor(() =>
      expect(
        sessions.transitionSession.mock.calls.filter(
          ([, lifecycle]) => lifecycle.state === EngineState.Paused,
        ),
      ).toHaveLength(2),
    );

    currentProjectId = ref.projectId;
    await service.pauseOutsideProject(currentProjectId);
    transitions[2]?.resolve();
    await vi.waitFor(() =>
      expect(
        sessions.transitionSession.mock.calls.filter(
          ([, lifecycle]) => lifecycle.state === EngineState.Learning,
        ),
      ).toHaveLength(3),
    );

    transitions[3]?.resolve();

    await expect(pausing).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(sessions.current().state).toBe(EngineState.Learning);
    expect(resume).toHaveBeenCalledOnce();

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("publishes every entry before the terminal event with correct counters", async () => {
    await expect(
      service.start(ref.projectId, createRequest(), createConfig()),
    ).resolves.toMatchObject({ success: true });
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));

    emitEngineEvent?.({
      type: "state",
      state: EngineState.Learning,
      phase: EnginePhase.Learning,
    });
    for (const [requestId, parametersSent] of [
      ["request-1", 3],
      ["request-2", 2],
    ] as const) {
      emitEngineEvent?.({
        type: "request",
        parametersSent,
        parametersTested: parametersSent,
        context: "discovery",
        requestResponse: {
          request: { ...createRequest(), id: requestId },
          response: {
            status: 200,
            headers: {},
            body: "",
            time: 10,
            length: 20,
          },
        },
      });
    }
    emitEngineEvent?.({
      type: "finding",
      finding: {
        requestResponse: {
          request: { ...createRequest(), id: "request-2" },
          response: {
            status: 200,
            headers: {},
            body: "",
            time: 10,
            length: 20,
          },
        },
        parameter: { name: "secret", value: "value" },
        anomaly: { type: AnomalyType.StatusCode, from: 404, to: 200 },
      },
    });
    emitEngineEvent?.({ type: "log", level: "info", message: "finished" });
    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));

    await vi.waitFor(() =>
      expect(
        envelopes.some((envelope) =>
          envelope.changes.some((change) => change.type === "terminal"),
        ),
      ).toBe(true),
    );

    expect(
      sessions.operations.indexOf(`update:${EngineState.Learning}`),
    ).toBeLessThan(sessions.operations.indexOf("run"));
    expect(sessions.appendEntries).toHaveBeenCalledTimes(4);
    expect(
      sessions.appendEntries.mock.calls.map(([, entries]) => entries[0]?.kind),
    ).toEqual(["request", "request", "finding", "log"]);
    const changes = envelopes.flatMap((envelope) => envelope.changes);
    const entriesChanges = changes.filter(
      (change) => change.type === "entries",
    );
    const entriesIndex = changes.findLastIndex(
      (change) => change.type === "entries",
    );
    const terminalIndex = changes.findIndex(
      (change) => change.type === "terminal",
    );
    expect(entriesIndex).toBeGreaterThan(-1);
    expect(terminalIndex).toBeGreaterThan(entriesIndex);
    expect(entriesChanges).toHaveLength(4);
    expect(changes[entriesIndex]).toMatchObject({
      type: "entries",
      session: {
        requestsSent: 2,
        parametersSent: 5,
        findingsCount: 1,
        logsCount: 1,
      },
    });
    expect(changes[terminalIndex]).toMatchObject({
      type: "terminal",
      session: { state: EngineState.Completed },
    });
    expect(sessions.operations.indexOf("append")).toBeLessThan(
      sessions.operations.lastIndexOf(`update:${EngineState.Completed}`),
    );
  });

  it("makes cancel terminal when it races a pause", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));
    emitEngineEvent?.({
      type: "state",
      state: EngineState.Learning,
      phase: EnginePhase.Learning,
    });
    await vi.waitFor(() =>
      expect(sessions.current().state).toBe(EngineState.Learning),
    );

    const [pauseResult, cancelResult] = await Promise.all([
      service.pause(ref),
      service.cancel(ref),
    ]);

    expect(pauseResult.success).toBe(true);
    expect(cancelResult.success).toBe(true);
    expect(sessions.current().state).toBe(EngineState.Canceled);
    const terminalIndex = envelopes.findIndex((envelope) =>
      envelope.changes.some((change) => change.type === "terminal"),
    );
    expect(terminalIndex).toBeGreaterThan(-1);
    expect(
      envelopes
        .slice(terminalIndex + 1)
        .some((envelope) =>
          envelope.changes.some(
            (change) =>
              change.type === "upsert" &&
              change.session.state === EngineState.Paused,
          ),
        ),
    ).toBe(false);

    scan.resolve(scanResult(EngineState.Canceled, EnginePhase.Learning));
  });

  it("claims cancellation before an abort rejection can persist an error", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());
    await vi.waitFor(() => expect(scanSignal).toBeDefined());
    scanSignal?.addEventListener("abort", () => {
      scan.reject(new Error("Run aborted"));
    });

    await expect(service.cancel(ref)).resolves.toEqual({
      success: true,
      value: undefined,
    });
    await vi.waitFor(() =>
      expect(
        envelopes
          .flatMap((envelope) => envelope.changes)
          .filter((change) => change.type === "terminal"),
      ).toHaveLength(1),
    );

    expect(sessions.current().state).toBe(EngineState.Canceled);
    expect(
      envelopes
        .flatMap((envelope) => envelope.changes)
        .filter((change) => change.type === "terminal"),
    ).toMatchObject([
      { type: "terminal", session: { state: EngineState.Canceled } },
    ]);
  });

  it("ignores stale completion after a session ID is reused", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());
    const staleScan = scan;
    runningSessions.tombstone([ref]);

    scan = deferred<RunDiscoveryScanResult>();
    emitEngineEvent = undefined;
    await service.start(ref.projectId, createRequest(), createConfig());
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));
    const currentEmitter = emitEngineEvent as
      | ((event: DiscoveryEvent) => void)
      | undefined;

    staleScan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await new Promise<void>((resolve) => setImmediate(resolve));

    currentEmitter?.({ type: "log", level: "info", message: "current" });
    await vi.waitFor(() =>
      expect(sessions.appendEntries).toHaveBeenCalledOnce(),
    );

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await vi.waitFor(() =>
      expect(
        envelopes
          .flatMap((envelope) => envelope.changes)
          .filter((change) => change.type === "terminal"),
      ).toHaveLength(1),
    );
  });

  it("persists an error terminal when progress persistence fails", async () => {
    sessions.appendEntries.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await service.start(ref.projectId, createRequest(), createConfig());
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));

    emitEngineEvent?.({ type: "log", level: "info", message: "queued" });
    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));

    await vi.waitFor(() =>
      expect(
        envelopes.some((envelope) =>
          envelope.changes.some(
            (change) =>
              change.type === "terminal" &&
              change.session.state === EngineState.Error,
          ),
        ),
      ).toBe(true),
    );
    const terminal = envelopes
      .flatMap((envelope) => envelope.changes)
      .find((change) => change.type === "terminal");
    expect(terminal).toMatchObject({
      type: "terminal",
      session: {
        state: EngineState.Error,
        error: {
          code: "IO",
          message: expect.stringContaining("database unavailable"),
        },
      },
    });
  });

  it("retries a transient terminal persistence failure", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());
    sessions.transitionSession.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));

    await vi.waitFor(() =>
      expect(sessions.current().state).toBe(EngineState.Completed),
    );
    expect(
      sessions.transitionSession.mock.calls.filter(
        ([, changes]) => changes.state === EngineState.Completed,
      ),
    ).toHaveLength(2);
  });

  it("only allows terminal retry after terminal persistence exhausts retries", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());
    await service.pause(ref);

    const transitionSession =
      sessions.transitionSession.getMockImplementation();
    sessions.transitionSession.mockRejectedValue(
      new Error("database unavailable"),
    );

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await vi.waitFor(() =>
      expect(
        sessions.transitionSession.mock.calls.filter(
          ([, lifecycle]) => lifecycle.state === EngineState.Completed,
        ),
      ).toHaveLength(2),
    );
    expect(sessions.current().state).toBe(EngineState.Paused);

    await expect(service.pause(ref)).resolves.toMatchObject({
      success: false,
      error: { code: "CONFLICT" },
    });
    await expect(service.resume(ref)).resolves.toMatchObject({
      success: false,
      error: { code: "CONFLICT" },
    });

    sessions.transitionSession.mockImplementation(transitionSession!);
    await expect(service.cancel(ref)).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(sessions.current().state).toBe(EngineState.Completed);
  });

  it("waits for in-flight terminal persistence before completing cancel", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());

    const terminalPersistence = deferred<void>();
    const transitionSession =
      sessions.transitionSession.getMockImplementation();
    sessions.transitionSession.mockImplementation(
      async (sessionRef, lifecycle) => {
        if (lifecycle.state === EngineState.Completed) {
          await terminalPersistence.promise;
          throw new Error("database unavailable");
        }

        return transitionSession!(sessionRef, lifecycle);
      },
    );

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await vi.waitFor(() =>
      expect(
        sessions.transitionSession.mock.calls.filter(
          ([, lifecycle]) => lifecycle.state === EngineState.Completed,
        ),
      ).toHaveLength(1),
    );

    const canceling = service.cancel(ref);
    let cancelSettled = false;
    void canceling.then(
      () => {
        cancelSettled = true;
      },
      () => {
        cancelSettled = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cancelSettled).toBe(false);

    terminalPersistence.resolve();
    await expect(canceling).rejects.toThrow("database unavailable");
    expect(
      sessions.transitionSession.mock.calls.filter(
        ([, lifecycle]) => lifecycle.state === EngineState.Completed,
      ),
    ).toHaveLength(2);

    sessions.transitionSession.mockImplementation(transitionSession!);
    await expect(service.cancel(ref)).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(sessions.current().state).toBe(EngineState.Completed);
  });

  it("resumes the runtime when paused-state persistence fails", async () => {
    const resumeSpy = vi.spyOn(RunControl.prototype, "resume");
    await service.start(ref.projectId, createRequest(), createConfig());
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));
    emitEngineEvent?.({
      type: "state",
      state: EngineState.Learning,
      phase: EnginePhase.Learning,
    });
    await vi.waitFor(() =>
      expect(sessions.current().state).toBe(EngineState.Learning),
    );
    sessions.transitionSession.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    const result = await service.pause(ref);

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "IO",
        message: expect.stringContaining("database unavailable"),
      },
    });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(sessions.current().state).toBe(EngineState.Learning);
    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("tombstones deleted runs before a late completion can write", async () => {
    await service.start(ref.projectId, createRequest(), createConfig());
    const transitionsBeforeDelete =
      sessions.transitionSession.mock.calls.length;

    await service.deleteSessions([ref]);
    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(scanSignal?.aborted).toBe(true);
    expect(sessions.deleteSessions).toHaveBeenCalledWith([ref]);
    expect(sessions.transitionSession).toHaveBeenCalledTimes(
      transitionsBeforeDelete,
    );
    expect(envelopes.flatMap((envelope) => envelope.changes)).toContainEqual({
      type: "delete",
      refs: [ref],
    });
  });
});
