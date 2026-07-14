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
  SessionRef,
} from "shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BackendSDK } from "../types/types";

import {
  cancelEngineSession,
  pauseEngineSession,
  pauseSessionsOutsideProject,
  startEngineSession,
  tombstoneRunningSessions,
} from "./session-manager";

interface TestState {
  runDiscoveryScan: ReturnType<typeof vi.fn>;
  store: unknown;
}

const testState = vi.hoisted<TestState>(() => ({
  runDiscoveryScan: vi.fn(),
  store: undefined,
}));

vi.mock("@paramfinder/engine", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runDiscoveryScan: testState.runDiscoveryScan };
});

vi.mock("../sessions/session-store", () => ({
  getSessionStore: () => testState.store,
}));

vi.mock("../wordlists/wordlists", () => ({
  getWordlistManager: () => ({
    getEnabledPaths: async () => ["/plugin/words.txt"],
  }),
}));

vi.mock("../util/helper", () => ({
  generateID: () => "session-1",
  readWordlist: async () => ["alpha", "secret"],
}));

vi.mock("./caido-provider", () => ({
  CaidoRequestProvider: class {},
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
};

type StoreMock = ReturnType<typeof createStore>;

const ref: SessionRef = { projectId: "project-1", sessionId: "session-1" };
let scan: Deferred<RunDiscoveryScanResult>;
let emitEngineEvent: ((event: DiscoveryEvent) => void) | undefined;
let scanSignal: AbortSignal | undefined;
let store: StoreMock;
let envelopes: SessionChangeEnvelope[];

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
    updatedAt: 1,
    rerun: { targetRequest: createRequest(), config: createConfig() },
  };
}

function createStore() {
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
    updateSession: vi.fn(
      async (_ref: SessionRef, changes: Partial<SessionDescriptor>) => {
        operations.push(`update:${changes.state ?? "counters"}`);
        session = { ...session, ...changes, updatedAt: session.updatedAt + 1 };
        revision += 1;
        return { revision, session: structuredClone(session) };
      },
    ),
    appendEntries: vi.fn(
      async (_ref: SessionRef, pending: SessionEntryInput[]) => {
        operations.push("append");
        const entries: SessionEntry[] = pending.map((entry) => {
          sequence += 1;
          return { sequence, ...entry };
        });
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
        return {
          revision,
          entries,
          session: structuredClone(session),
        };
      },
    ),
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
  store = createStore();
  testState.store = store;
  envelopes = [];
  emitEngineEvent = undefined;
  scanSignal = undefined;
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
      store.operations.push("run");
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

afterEach(() => {
  tombstoneRunningSessions([ref]);
});

describe("session manager reliability", () => {
  it("rejects invalid engine configuration before creating a session", async () => {
    const sdk = createSdk();

    await expect(
      startEngineSession(sdk, ref.projectId, createRequest(), {
        ...createConfig(),
        customValue: "not-an-integer",
        customValueType: "integer",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });

    expect(store.createNextSession).not.toHaveBeenCalled();
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
    expect(envelopes).toEqual([]);
  });

  it("rejects sub-millisecond timeouts before creating a session", async () => {
    const sdk = createSdk();

    await expect(
      startEngineSession(sdk, ref.projectId, createRequest(), {
        ...createConfig(),
        scanTimeoutSeconds: 0.0005,
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });

    expect(store.createNextSession).not.toHaveBeenCalled();
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
    expect(envelopes).toEqual([]);
  });

  it("rejects an unsupported body before creating a session", async () => {
    const sdk = createSdk();
    const request = {
      ...createRequest(),
      method: "POST",
      raw: "POST / HTTP/1.1\r\nHost: example.com\r\n\r\n",
    };

    await expect(
      startEngineSession(sdk, ref.projectId, request, {
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

    expect(store.createNextSession).not.toHaveBeenCalled();
    expect(testState.runDiscoveryScan).not.toHaveBeenCalled();
    expect(envelopes).toEqual([]);
  });

  it("terminalizes a created session when startup persistence fails", async () => {
    const sdk = createSdk();
    store.updateSession.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      startEngineSession(sdk, ref.projectId, createRequest(), createConfig()),
    ).resolves.toMatchObject({ success: false });

    expect(store.current()).toMatchObject({
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

  it("pauses a running session when another project becomes active", async () => {
    const sdk = createSdk();
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    await vi.waitFor(() =>
      expect(store.current().state).toBe(EngineState.Learning),
    );

    await expect(
      pauseSessionsOutsideProject(sdk, "project-2"),
    ).resolves.toEqual({ success: true, value: undefined });
    expect(store.current().state).toBe(EngineState.Paused);

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });

  it("publishes every entry before the terminal event with correct counters", async () => {
    const sdk = createSdk();
    await expect(
      startEngineSession(sdk, ref.projectId, createRequest(), createConfig()),
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
            requestId,
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
            requestId: "request-2",
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
      store.operations.indexOf(`update:${EngineState.Learning}`),
    ).toBeLessThan(store.operations.indexOf("run"));
    expect(store.appendEntries).toHaveBeenCalledTimes(4);
    expect(
      store.appendEntries.mock.calls.map(([_, entries]) => entries[0]?.kind),
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
    expect(store.operations.indexOf("append")).toBeLessThan(
      store.operations.lastIndexOf(`update:${EngineState.Completed}`),
    );
  });

  it("makes cancel terminal when it races a pause", async () => {
    const sdk = createSdk();
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));
    emitEngineEvent?.({
      type: "state",
      state: EngineState.Learning,
      phase: EnginePhase.Learning,
    });
    await vi.waitFor(() =>
      expect(store.current().state).toBe(EngineState.Learning),
    );

    const [pauseResult, cancelResult] = await Promise.all([
      pauseEngineSession(sdk, ref),
      cancelEngineSession(sdk, ref),
    ]);

    expect(pauseResult.success).toBe(true);
    expect(cancelResult.success).toBe(true);
    expect(store.current().state).toBe(EngineState.Canceled);
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
    const sdk = createSdk();
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    await vi.waitFor(() => expect(scanSignal).toBeDefined());
    scanSignal?.addEventListener("abort", () => {
      scan.reject(new Error("Run aborted"));
    });

    await expect(cancelEngineSession(sdk, ref)).resolves.toEqual({
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

    expect(store.current().state).toBe(EngineState.Canceled);
    expect(
      envelopes
        .flatMap((envelope) => envelope.changes)
        .filter((change) => change.type === "terminal"),
    ).toMatchObject([
      { type: "terminal", session: { state: EngineState.Canceled } },
    ]);
  });

  it("ignores stale completion after a session ID is reused", async () => {
    const sdk = createSdk();
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    const staleScan = scan;
    tombstoneRunningSessions([ref]);

    scan = deferred<RunDiscoveryScanResult>();
    emitEngineEvent = undefined;
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));
    const currentEmitter = emitEngineEvent as
      | ((event: DiscoveryEvent) => void)
      | undefined;

    staleScan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await new Promise<void>((resolve) => setImmediate(resolve));

    currentEmitter?.({ type: "log", level: "info", message: "current" });
    await vi.waitFor(() => expect(store.appendEntries).toHaveBeenCalledOnce());

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await vi.waitFor(() =>
      expect(
        envelopes
          .flatMap((envelope) => envelope.changes)
          .filter((change) => change.type === "terminal"),
      ).toHaveLength(1),
    );
  });

  it("persists an error terminal when batched progress persistence fails", async () => {
    const sdk = createSdk();
    store.appendEntries.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
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
      session: { state: EngineState.Error },
      error: {
        code: "IO",
        message: expect.stringContaining("database unavailable"),
      },
    });
  });

  it("retries a transient terminal persistence failure", async () => {
    const sdk = createSdk();
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    store.updateSession.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));

    await vi.waitFor(() =>
      expect(store.current().state).toBe(EngineState.Completed),
    );
    expect(
      store.updateSession.mock.calls.filter(
        ([, changes]) => changes.state === EngineState.Completed,
      ),
    ).toHaveLength(2);
  });

  it("keeps a session controllable after terminal persistence exhausts retries", async () => {
    const sdk = createSdk();
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    const updateSession = store.updateSession.getMockImplementation();
    store.updateSession.mockRejectedValue(new Error("database unavailable"));

    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
    await vi.waitFor(() =>
      expect(store.updateSession).toHaveBeenCalledTimes(3),
    );
    expect(store.current().state).toBe(EngineState.Learning);

    store.updateSession.mockImplementation(updateSession!);
    await expect(cancelEngineSession(sdk, ref)).resolves.toEqual({
      success: true,
      value: undefined,
    });
    expect(store.current().state).toBe(EngineState.Canceled);
  });

  it("resumes the runtime when paused-state persistence fails", async () => {
    const sdk = createSdk();
    const resumeSpy = vi.spyOn(RunControl.prototype, "resume");
    await startEngineSession(
      sdk,
      ref.projectId,
      createRequest(),
      createConfig(),
    );
    await vi.waitFor(() => expect(emitEngineEvent).toBeTypeOf("function"));
    emitEngineEvent?.({
      type: "state",
      state: EngineState.Learning,
      phase: EnginePhase.Learning,
    });
    await vi.waitFor(() =>
      expect(store.current().state).toBe(EngineState.Learning),
    );
    store.updateSession.mockImplementationOnce(async () => {
      throw new Error("database unavailable");
    });

    const result = await pauseEngineSession(sdk, ref);

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "IO",
        message: expect.stringContaining("database unavailable"),
      },
    });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(store.current().state).toBe(EngineState.Learning);
    scan.resolve(scanResult(EngineState.Completed, EnginePhase.Discovery));
  });
});
