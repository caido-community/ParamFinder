import { createPinia, setActivePinia } from "pinia";
import {
  error,
  MiningSessionPhase,
  MiningSessionState,
  ok,
  type ParamMinerConfig,
  type ProjectSessionSnapshot,
  type Request,
  type RequestResponse,
  type SessionChangeEnvelope,
  type SessionDescriptor,
} from "shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionsStore } from "./sessions.store";
import { useSessionViewStore } from "./sessionView.store";

import type { FrontendSDK } from "@/types";

const sdkHolder = vi.hoisted(() => ({
  current: undefined as FrontendSDK | undefined,
}));
const requestLoader = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/plugins/sdk", () => ({
  useSDK: () => sdkHolder.current,
}));
vi.mock("../lib/loadRequestResponse", () => ({
  loadRequestResponse: requestLoader.load,
}));

function descriptor(projectId: string, sessionId: string): SessionDescriptor {
  return {
    ref: { projectId, sessionId },
    state: MiningSessionState.Pending,
    phase: MiningSessionPhase.Idle,
    totalParametersAmount: 10,
    totalLearnRequests: 3,
    parametersSent: 0,
    requestsSent: 0,
    findingsCount: 0,
    logsCount: 0,
    createdAt: 1,
  };
}

function snapshot(
  projectId: string,
  revision: number,
  sessions: SessionDescriptor[],
): ProjectSessionSnapshot {
  return { projectId, revision, sessions };
}

function upsertEnvelope(
  projectId: string,
  revision: number,
  session: SessionDescriptor,
): SessionChangeEnvelope {
  return {
    projectId,
    revision,
    changes: [{ type: "upsert", session }],
  };
}

function createSDK(overrides: Record<string, unknown> = {}): FrontendSDK {
  const backend = {
    getCurrentProjectId: vi.fn(async () => ok<string | undefined>("a")),
    listSessions: vi.fn(async () => ok(snapshot("a", 1, []))),
    getSessionEntries: vi.fn(async () =>
      ok({ items: [], snapshotMaxSequence: 0 }),
    ),
    pauseSession: vi.fn(async () => ok(undefined)),
    resumeSession: vi.fn(async () => ok(undefined)),
    cancelSession: vi.fn(async () => ok(undefined)),
    deleteSessions: vi.fn(async () => ok(undefined)),
    startMining: vi.fn(),
    ...overrides,
  };
  return {
    backend,
    window: { showToast: vi.fn() },
  } as unknown as FrontendSDK;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("sessions store reliability", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    requestLoader.load.mockReset();
  });

  it("buffers events before project discovery and replays revisions after the snapshot", async () => {
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, []))),
    });
    const store = useSessionsStore();
    store.acceptEnvelope(upsertEnvelope("a", 2, descriptor("a", "buffered")));

    expect((await store.initialize()).success).toBe(true);
    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "buffered",
    ]);
  });

  it("does not let stale project discovery overwrite a project change", async () => {
    const currentProject =
      deferred<ReturnType<typeof ok<string | undefined>>>();
    sdkHolder.current = createSDK({
      getCurrentProjectId: vi.fn(() => currentProject.promise),
      listSessions: vi.fn(async (projectId: string) =>
        ok(
          snapshot(projectId, 1, [
            descriptor(projectId, `${projectId}-session`),
          ]),
        ),
      ),
    });
    const store = useSessionsStore();

    const initializing = store.initialize();
    await store.reloadForProject("b");
    currentProject.resolve(ok("a"));
    await initializing;

    expect(store.currentProjectId).toBe("b");
    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "b-session",
    ]);
  });

  it("retries a failed hydration when session events are buffered", async () => {
    const buffered = descriptor("a", "buffered-after-failure");
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce(error("temporary snapshot failure"))
      .mockResolvedValueOnce(ok(snapshot("a", 1, [])));
    sdkHolder.current = createSDK({ listSessions });
    const store = useSessionsStore();
    store.acceptEnvelope(upsertEnvelope("a", 2, buffered));

    const result = await store.initialize();

    expect(result).toEqual(error("temporary snapshot failure"));
    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(store.list.map((session) => session.ref.sessionId)).toEqual([
        "buffered-after-failure",
      ]),
    );
  });

  it("keeps session tabs oldest-first so new sessions append", async () => {
    const first = { ...descriptor("a", "2"), createdAt: 1 };
    const second = { ...descriptor("a", "10"), createdAt: 2 };
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [first]))),
    });
    const store = useSessionsStore();

    await store.initialize();
    store.acceptEnvelope(upsertEnvelope("a", 2, second));

    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "2",
      "10",
    ]);
  });

  it("uses ascending numeric session IDs when timestamps match", async () => {
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () =>
        ok(snapshot("a", 1, [descriptor("a", "10"), descriptor("a", "2")])),
      ),
    });
    const store = useSessionsStore();

    await store.initialize();

    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "2",
      "10",
    ]);
  });

  it("keeps a reordered tab list and appends new sessions", async () => {
    const first = { ...descriptor("a", "first"), createdAt: 1 };
    const second = { ...descriptor("a", "second"), createdAt: 2 };
    const third = { ...descriptor("a", "third"), createdAt: 3 };
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [first, second]))),
    });
    const store = useSessionsStore();
    const viewStore = useSessionViewStore();
    await store.initialize();

    viewStore.moveSessionTab(["first", "second"], "second", "first", "before");
    store.acceptEnvelope(upsertEnvelope("a", 2, third));

    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "second",
      "first",
      "third",
    ]);
  });

  it("reuses entry caches when switching between sessions", async () => {
    const first = descriptor("a", "first");
    const second = descriptor("a", "second");
    const getSessionEntries = vi.fn(
      async (query: { ref: { sessionId: string }; kind: string }) =>
        ok({
          items:
            query.kind === "log"
              ? [
                  {
                    sequence: 1,
                    kind: "log" as const,
                    value: `${query.ref.sessionId}-log`,
                  },
                ]
              : [],
          snapshotMaxSequence: query.kind === "log" ? 1 : 0,
        }),
    );
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [first, second]))),
      getSessionEntries,
    });
    const store = useSessionsStore();

    await store.initialize();
    expect(store.activeSession?.logs).toEqual(["first-log"]);

    store.setActiveSession("second");
    await vi.waitFor(() =>
      expect(store.activeSession?.logs).toEqual(["second-log"]),
    );
    expect(getSessionEntries).toHaveBeenCalledTimes(6);

    store.setActiveSession("first");
    expect(store.activeSession?.logs).toEqual(["first-log"]);
    await Promise.resolve();
    expect(getSessionEntries).toHaveBeenCalledTimes(6);
  });

  it("finishes loading a session after switching away", async () => {
    const first = descriptor("a", "first");
    const second = descriptor("a", "second");
    const refresh = deferred<
      ReturnType<
        typeof ok<{
          items: Array<{ sequence: number; kind: "log"; value: string }>;
          snapshotMaxSequence: number;
        }>
      >
    >();
    let refreshing = false;
    const getSessionEntries = vi.fn(
      async (query: { ref: { sessionId: string }; kind: string }) => {
        if (
          refreshing &&
          query.ref.sessionId === "first" &&
          query.kind === "log"
        ) {
          return refresh.promise;
        }
        return ok({ items: [], snapshotMaxSequence: 0 });
      },
    );
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [first, second]))),
      getSessionEntries,
    });
    const store = useSessionsStore();
    await store.initialize();
    refreshing = true;

    const loading = store.loadEntries("log", {
      reset: true,
      sort: { field: "sequence", direction: "asc" },
    });
    store.setActiveSession("second");
    refresh.resolve(
      ok({
        items: [{ sequence: 1, kind: "log", value: "loaded" }],
        snapshotMaxSequence: 1,
      }),
    );
    await loading;
    refreshing = false;

    store.setActiveSession("first");
    expect(store.activeSession?.logs).toEqual(["loaded"]);
  });

  it("adds live requests and findings to the active tables", async () => {
    const session = descriptor("a", "live");
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [session]))),
    });
    const store = useSessionsStore();
    await store.initialize();

    store.acceptEnvelope({
      projectId: "a",
      revision: 2,
      changes: [
        {
          type: "entries",
          ref: session.ref,
          session: { ...session, requestsSent: 1, findingsCount: 1 },
          entries: [
            {
              sequence: 1,
              kind: "request",
              value: {
                requestId: "request-1",
                responseStatus: 200,
                responseTime: 12,
                responseLength: 42,
                parametersSent: 1,
                context: "discovery",
              },
            },
            {
              sequence: 2,
              kind: "finding",
              value: {
                requestId: "request-1",
                responseStatus: 200,
                responseLength: 42,
                parameter: { name: "secret", value: "value" },
                anomaly: { type: "status-code", from: 404, to: 200 },
              },
            },
          ],
        },
      ],
    });

    expect(store.activeSession?.sentRequests).toHaveLength(1);
    expect(store.activeSession?.findings).toHaveLength(1);
    expect(store.activeSession?.sentRequests[0]?.sequence).toBe(1);
    expect(store.activeSession?.findings[0]?.sequence).toBe(2);

    store.acceptEnvelope({
      projectId: "a",
      revision: 3,
      changes: [
        {
          type: "entries",
          ref: session.ref,
          session: { ...session, requestsSent: 1, findingsCount: 2 },
          entries: [
            {
              sequence: 3,
              kind: "finding",
              value: {
                requestId: "request-2",
                responseStatus: 200,
                responseLength: 43,
                parameter: { name: "second", value: "value" },
                anomaly: { type: "status-code", from: 404, to: 200 },
              },
            },
          ],
        },
      ],
    });

    expect(store.activeDescriptor?.findingsCount).toBe(2);
    expect(store.activeSession?.findings).toHaveLength(2);
  });

  it("selects a newly announced session", async () => {
    const oldSession = descriptor("a", "old");
    const getSessionEntries = vi.fn(async () =>
      ok({ items: [], snapshotMaxSequence: 0 }),
    );
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [oldSession]))),
      getSessionEntries,
    });
    const store = useSessionsStore();
    const viewStore = useSessionViewStore();
    await store.initialize();
    getSessionEntries.mockClear();

    store.acceptEnvelope(
      upsertEnvelope("a", 2, descriptor("a", "new-session")),
    );

    expect(viewStore.activeSessionId).toBe("new-session");
    expect(getSessionEntries).not.toHaveBeenCalled();
    expect(store.activeEntryState("request")?.entries).toEqual([]);
    expect(store.activeEntryState("finding")?.entries).toEqual([]);
    expect(store.activeEntryState("log")?.entries).toEqual([]);
  });

  it("does not reload a fresh session when the start response follows its event", async () => {
    const newSession = descriptor("a", "new-session");
    const start = deferred<ReturnType<typeof ok<SessionDescriptor>>>();
    const getSessionEntries = vi.fn(async () =>
      ok({ items: [], snapshotMaxSequence: 0 }),
    );
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, []))),
      getSessionEntries,
      startMining: vi.fn(async () => await start.promise),
    });
    const store = useSessionsStore();
    const viewStore = useSessionViewStore();
    await store.initialize();
    getSessionEntries.mockClear();

    const starting = store.startSession({} as Request, {} as ParamMinerConfig);
    store.acceptEnvelope(upsertEnvelope("a", 2, newSession));
    start.resolve(ok(newSession));
    await starting;

    expect(viewStore.activeSessionId).toBe("new-session");
    expect(getSessionEntries).not.toHaveBeenCalled();
  });

  it("keeps existing rows visible while refreshing a query", async () => {
    const session = descriptor("a", "refreshing");
    const refresh = deferred<
      ReturnType<
        typeof ok<{
          items: Array<{
            sequence: number;
            kind: "request";
            value: {
              requestId: string;
              responseStatus: number;
              responseTime: number;
              responseLength: number;
              parametersSent: number;
              context: "discovery";
            };
          }>;
          snapshotMaxSequence: number;
        }>
      >
    >();
    let refreshing = false;
    const firstRequest = {
      sequence: 1,
      kind: "request" as const,
      value: {
        requestId: "request-1",
        responseStatus: 200,
        responseTime: 12,
        responseLength: 42,
        parametersSent: 1,
        context: "discovery" as const,
      },
    };
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [session]))),
      getSessionEntries: vi.fn(async (query: { kind: string }) =>
        query.kind === "request"
          ? refreshing
            ? refresh.promise
            : ok({
                items: [firstRequest],
                snapshotMaxSequence: 1,
              })
          : ok({ items: [], snapshotMaxSequence: 0 }),
      ),
    });
    const store = useSessionsStore();
    await store.initialize();
    refreshing = true;

    const loading = store.loadEntries("request", {
      reset: true,
      sort: { field: "sequence", direction: "asc" },
    });

    expect(store.activeSession?.sentRequests).toHaveLength(1);
    expect(store.activeEntryState("request")?.loading).toBe(true);
    refresh.resolve(ok({ items: [firstRequest], snapshotMaxSequence: 1 }));
    await loading;
    expect(store.activeSession?.sentRequests).toHaveLength(1);
  });

  it("does not overwrite a live finding with an older in-flight page", async () => {
    const session = descriptor("a", "in-flight");
    const findingPage = deferred<
      ReturnType<
        typeof ok<{
          items: [];
          snapshotMaxSequence: number;
        }>
      >
    >();
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [session]))),
      getSessionEntries: vi.fn(async (query: { kind: string }) =>
        query.kind === "finding"
          ? findingPage.promise
          : ok({ items: [], snapshotMaxSequence: 0 }),
      ),
    });
    const store = useSessionsStore();
    const initializing = store.initialize();
    await vi.waitFor(() => {
      expect(store.activeEntryState("finding")?.loading).toBe(true);
    });

    store.acceptEnvelope({
      projectId: "a",
      revision: 2,
      changes: [
        {
          type: "entries",
          ref: session.ref,
          session: { ...session, findingsCount: 1 },
          entries: [
            {
              sequence: 1,
              kind: "finding",
              value: {
                requestId: "request-1",
                responseStatus: 200,
                responseLength: 42,
                parameter: { name: "live", value: "value" },
                anomaly: { type: "status-code", from: 404, to: 200 },
              },
            },
          ],
        },
      ],
    });
    expect(store.activeSession?.findings).toHaveLength(1);

    findingPage.resolve(ok({ items: [], snapshotMaxSequence: 0 }));
    await initializing;

    expect(store.activeDescriptor?.findingsCount).toBe(1);
    expect(
      store.activeSession?.findings.map((finding) => finding.parameter.name),
    ).toEqual(["live"]);
  });

  it("refetches authoritative state when an event revision has a gap", async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce(ok(snapshot("a", 1, [])))
      .mockResolvedValueOnce(
        ok(snapshot("a", 3, [descriptor("a", "from-refetch")])),
      );
    sdkHolder.current = createSDK({ listSessions });
    const store = useSessionsStore();
    await store.initialize();

    store.acceptEnvelope(upsertEnvelope("a", 3, descriptor("a", "gap-event")));

    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(store.list[0]?.ref.sessionId).toBe("from-refetch"),
    );
  });

  it("ignores stale project loads and non-current project events", async () => {
    const first = deferred<ReturnType<typeof ok<ProjectSessionSnapshot>>>();
    const listSessions = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        ok(snapshot("b", 1, [descriptor("b", "b-session")])),
      );
    sdkHolder.current = createSDK({ listSessions });
    const store = useSessionsStore();

    const loadA = store.reloadForProject("a");
    const loadB = store.reloadForProject("b");
    await loadB;
    first.resolve(ok(snapshot("a", 1, [descriptor("a", "a-session")])));
    await loadA;
    store.acceptEnvelope(upsertEnvelope("a", 2, descriptor("a", "ignored")));

    expect(store.currentProjectId).toBe("b");
    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "b-session",
    ]);
  });

  it("loads the project named by each project-change event", async () => {
    const listSessions = vi.fn(async (projectId: "a" | "b") =>
      ok(
        snapshot(
          projectId,
          1,
          projectId === "a" ? [descriptor("a", "a-session")] : [],
        ),
      ),
    );
    sdkHolder.current = createSDK({ listSessions });
    const store = useSessionsStore();

    await store.reloadForProject("a");
    await store.reloadForProject("b");
    expect(store.list).toEqual([]);
    await store.reloadForProject("a");

    expect(listSessions.mock.calls.map(([projectId]) => projectId)).toEqual([
      "a",
      "b",
      "a",
    ]);
    expect(store.currentProjectId).toBe("a");
    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "a-session",
    ]);
  });

  it("discards request details after the selection changes", async () => {
    const response = deferred<ReturnType<typeof ok<RequestResponse>>>();
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () =>
        ok(snapshot("a", 1, [descriptor("a", "session")])),
      ),
    });
    requestLoader.load.mockReturnValue(response.promise);
    const store = useSessionsStore();
    const viewStore = useSessionViewStore();
    await store.initialize();
    viewStore.setSelectedRequest("request-1");

    const loading = store.loadRequestDetails("request-1");
    viewStore.setSelectedRequest("request-2");
    response.resolve(
      ok({
        request: {
          id: "request-1",
          host: "example.com",
          port: 443,
          url: "https://example.com/",
          path: "/",
          query: "",
          method: "GET",
          headers: {},
          body: "",
          tls: true,
          raw: "GET / HTTP/1.1\r\n\r\n",
          context: "discovery",
        },
        response: {
          status: 200,
          headers: {},
          body: "",
          time: 1,
          length: 0,
        },
      }),
    );
    await loading;

    expect(viewStore.getRequestDetailState("request-1")).toBeUndefined();
  });

  it("clears stale request-detail loading during same-project hydration", async () => {
    const response = deferred<ReturnType<typeof ok<RequestResponse>>>();
    const session = descriptor("a", "session");
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [session]))),
    });
    requestLoader.load.mockReturnValue(response.promise);
    const store = useSessionsStore();
    const viewStore = useSessionViewStore();
    await store.initialize();
    viewStore.setSelectedRequest("request-1");
    const loading = store.loadRequestDetails("request-1");

    await store.reloadForProject("a");
    expect(viewStore.getRequestDetailState("request-1")).toBeUndefined();

    response.resolve(
      ok({
        request: {
          id: "request-1",
          host: "example.com",
          port: 443,
          url: "https://example.com/",
          path: "/",
          query: "",
          method: "GET",
          headers: {},
          body: "",
          tls: true,
          raw: "GET / HTTP/1.1\r\n\r\n",
          context: "discovery",
        },
        response: {
          status: 200,
          headers: {},
          body: "",
          time: 1,
          length: 0,
        },
      }),
    );
    await loading;

    expect(viewStore.getRequestDetailState("request-1")).toBeUndefined();
  });

  it("clears action loading during same-project hydration", async () => {
    const paused = deferred<ReturnType<typeof ok<void>>>();
    const session = descriptor("a", "session");
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [session]))),
      pauseSession: vi.fn(() => paused.promise),
    });
    const store = useSessionsStore();
    await store.initialize();

    const pausing = store.pauseActive();
    expect(store.activeActionLoading).toBe("pause");
    await store.reloadForProject("a");
    expect(store.activeActionLoading).toBeUndefined();

    paused.resolve(ok(undefined));
    await pausing;
    expect(store.activeActionLoading).toBeUndefined();
  });

  it("exports every cursor page beyond 1,000 entries", async () => {
    const session = descriptor("a", "large");
    const getSessionEntries = vi.fn(
      async (query: { kind: string; limit: number; cursor?: string }) => {
        if (query.kind !== "log" || query.limit !== 1_000) {
          return ok({ items: [], snapshotMaxSequence: 0 });
        }
        const start = query.cursor === undefined ? 1 : 1_001;
        const count = query.cursor === undefined ? 1_000 : 200;
        return ok({
          items: Array.from({ length: count }, (_, index) => ({
            sequence: start + index,
            kind: "log" as const,
            value: `log-${start + index}`,
          })),
          nextCursor: query.cursor === undefined ? "page-2" : undefined,
          snapshotMaxSequence: 1_200,
        });
      },
    );
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [session]))),
      getSessionEntries,
    });
    const store = useSessionsStore();
    await store.initialize();

    const result = await store.exportEntries("log");

    expect(result.success && result.value).toHaveLength(1_200);
    expect(getSessionEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1_000, cursor: "page-2" }),
    );
  });

  it("applies bulk deletion only after the atomic backend call succeeds", async () => {
    const deletion = deferred<ReturnType<typeof ok<void>>>();
    const deleteSessions = vi.fn((_refs: unknown[]) => deletion.promise);
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () =>
        ok(
          snapshot("a", 1, [
            descriptor("a", "keep"),
            descriptor("a", "remove-1"),
            descriptor("a", "remove-2"),
          ]),
        ),
      ),
      deleteSessions,
    });
    const store = useSessionsStore();
    await store.initialize();

    const deleting = store.deleteOtherSessions("keep");
    expect(store.list).toHaveLength(3);
    expect(deleteSessions).toHaveBeenCalledTimes(1);
    expect(deleteSessions.mock.calls[0]?.[0]).toHaveLength(2);
    deletion.resolve(ok(undefined));
    await deleting;

    expect(store.list.map((session) => session.ref.sessionId)).toEqual([
      "keep",
    ]);
  });

  it("shows one toast for a current-project terminal error event", async () => {
    const session = descriptor("a", "failed");
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 1, [session]))),
    });
    const store = useSessionsStore();
    await store.initialize();
    const envelope: SessionChangeEnvelope = {
      projectId: "a",
      revision: 2,
      changes: [
        {
          type: "terminal",
          session: {
            ...session,
            state: MiningSessionState.Error,
            error: { code: "INTERNAL", message: "scan failed" },
          },
        },
      ],
    };

    store.acceptEnvelope(envelope);
    store.acceptEnvelope(envelope);

    expect(store.activeDescriptor?.error?.message).toBe("scan failed");
    expect(sdkHolder.current?.window.showToast).toHaveBeenCalledTimes(1);
    expect(sdkHolder.current?.window.showToast).toHaveBeenCalledWith(
      "scan failed",
      { variant: "error", duration: 10_000 },
    );
  });

  it("preserves persisted terminal errors without toasting during hydration", async () => {
    const failed = {
      ...descriptor("a", "persisted-failure"),
      state: MiningSessionState.Error,
      error: { code: "IO" as const, message: "persisted failure" },
    };
    sdkHolder.current = createSDK({
      listSessions: vi.fn(async () => ok(snapshot("a", 4, [failed]))),
    });
    const store = useSessionsStore();

    await store.initialize();

    expect(store.activeDescriptor?.error?.message).toBe("persisted failure");
    expect(sdkHolder.current?.window.showToast).not.toHaveBeenCalled();
  });
});
