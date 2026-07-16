import { defineStore, storeToRefs } from "pinia";
import {
  type ApiResult,
  compareSessionIds,
  error,
  ok,
  type ParamMinerConfig,
  type Request,
  type SentRequest,
  type Sequenced,
  type SessionChangeEnvelope,
  type SessionDescriptor,
  type SessionEntriesQuery,
  type SessionEntry,
  type SessionEntryKind,
  type SessionEntrySort,
  type SessionEntryValue,
  type SessionFinding,
  type SessionRef,
} from "shared";
import { computed, ref } from "vue";

import { loadRequestResponse } from "../lib/loadRequestResponse";

import {
  appendEntries,
  appendPage,
  createEntryCache,
  replacePage,
  type SessionEntryCache,
} from "./sessionEntryCache";
import { useSessionViewStore } from "./sessionView.store";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

const PAGE_SIZE = 250;
const LIVE_ENTRY_SORT = { field: "sequence", direction: "asc" } as const;
const ENTRY_KINDS: SessionEntryKind[] = ["request", "finding", "log"];

type SessionAction = "pause" | "resume" | "cancel" | "rerun";

function cacheKey(ref: SessionRef, kind: SessionEntryKind) {
  return `${ref.projectId}\u0000${ref.sessionId}\u0000${kind}`;
}

function entryValues(
  entries: SessionEntry[],
  kind: "request",
): Sequenced<SentRequest>[];
function entryValues(
  entries: SessionEntry[],
  kind: "finding",
): Sequenced<SessionFinding>[];
function entryValues(entries: SessionEntry[], kind: "log"): string[];
function entryValues(
  entries: SessionEntry[],
  kind: SessionEntryKind,
): Array<SessionEntryValue | Sequenced<SentRequest | SessionFinding>> {
  switch (kind) {
    case "request":
      return entries.flatMap((entry) =>
        entry.kind === kind
          ? [{ ...entry.value, sequence: entry.sequence }]
          : [],
      );
    case "finding":
      return entries.flatMap((entry) =>
        entry.kind === kind
          ? [{ ...entry.value, sequence: entry.sequence }]
          : [],
      );
    case "log":
      return entries.flatMap((entry) =>
        entry.kind === kind ? [entry.value] : [],
      );
  }
}

export const useSessionsStore = defineStore("sessions", () => {
  const sdk = useSDK();
  const viewStore = useSessionViewStore();
  const { activeSessionId, selectedRequestId, sessionTabOrder } =
    storeToRefs(viewStore);

  const sessions = ref<Record<string, SessionDescriptor>>({});
  const caches = ref<Record<string, SessionEntryCache>>({});
  const currentProjectId = ref<string>();
  const revision = ref(0);
  const hydrated = ref(false);
  const noProjectSelected = ref(false);
  const actionLoading = ref<Record<string, SessionAction>>({});
  const generation = ref(0);

  let pendingEnvelopes: SessionChangeEnvelope[] = [];
  let reloadQueued = false;
  let projectLoadIntent = 0;

  const list = computed(() => {
    const chronological = Object.values(sessions.value).sort(
      (left, right) =>
        left.createdAt - right.createdAt ||
        compareSessionIds(left.ref.sessionId, right.ref.sessionId),
    );
    if (sessionTabOrder.value.length === 0) {
      return chronological;
    }

    const byId = new Map(
      chronological.map((session) => [session.ref.sessionId, session]),
    );
    const ordered = sessionTabOrder.value.flatMap((id) => {
      const session = byId.get(id);
      byId.delete(id);
      return session === undefined ? [] : [session];
    });
    return [...ordered, ...byId.values()];
  });

  const activeDescriptor = computed(() =>
    activeSessionId.value === undefined
      ? undefined
      : sessions.value[activeSessionId.value],
  );

  const getCache = (descriptor: SessionDescriptor, kind: SessionEntryKind) =>
    caches.value[cacheKey(descriptor.ref, kind)];

  const activeSession = computed(() => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) return undefined;

    return {
      ...descriptor,
      sentRequests: entryValues(
        getCache(descriptor, "request")?.entries ?? [],
        "request",
      ),
      findings: entryValues(
        getCache(descriptor, "finding")?.entries ?? [],
        "finding",
      ),
      logs: entryValues(getCache(descriptor, "log")?.entries ?? [], "log"),
    };
  });

  const activeActionLoading = computed(() =>
    activeSessionId.value === undefined
      ? undefined
      : actionLoading.value[activeSessionId.value],
  );

  const activeEntryState = (kind: SessionEntryKind) => {
    const descriptor = activeDescriptor.value;
    return descriptor === undefined ? undefined : getCache(descriptor, kind);
  };

  const callBackend = async <T>(
    request: () => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> => {
    try {
      return await request();
    } catch (cause: unknown) {
      return error(toErrorMessage(cause));
    }
  };

  const runInBackground = (
    task: Promise<ApiResult<void> | void>,
    errorPrefix: string,
  ) => {
    task
      .then((result) => {
        if (result !== undefined && !result.success) {
          sdk.window.showToast(`${errorPrefix}: ${result.error.message}`, {
            variant: "error",
            duration: 10_000,
          });
        }
      })
      .catch((cause: unknown) => {
        sdk.window.showToast(`${errorPrefix}: ${toErrorMessage(cause)}`, {
          variant: "error",
          duration: 10_000,
        });
      });
  };

  const initializeEntryCaches = (ref: SessionRef) => {
    const nextCaches = { ...caches.value };
    for (const kind of ENTRY_KINDS) {
      const key = cacheKey(ref, kind);
      nextCaches[key] ??= createEntryCache(LIVE_ENTRY_SORT);
    }
    caches.value = nextCaches;
  };

  const replaceDescriptor = (descriptor: SessionDescriptor) => {
    if (descriptor.ref.projectId !== currentProjectId.value) return;

    sessions.value = {
      ...sessions.value,
      [descriptor.ref.sessionId]: descriptor,
    };
  };

  const removeSessionData = (refs: SessionRef[]) => {
    const nextSessions = { ...sessions.value };
    const nextCaches = { ...caches.value };
    for (const ref of refs) {
      if (ref.projectId !== currentProjectId.value) continue;

      delete nextSessions[ref.sessionId];
      for (const kind of ENTRY_KINDS) {
        delete nextCaches[cacheKey(ref, kind)];
      }
    }
    sessions.value = nextSessions;
    caches.value = nextCaches;
  };

  const removeDescriptors = (refs: SessionRef[]) => {
    const activeRemoved = refs.some(
      (ref) => ref.sessionId === activeSessionId.value,
    );
    removeSessionData(refs);
    if (activeRemoved) {
      setActiveSession(list.value[0]?.ref.sessionId);
    }
  };

  const applyEnvelope = (envelope: SessionChangeEnvelope): boolean => {
    if (
      envelope.projectId !== currentProjectId.value ||
      envelope.revision <= revision.value
    ) {
      return true;
    }
    if (envelope.revision !== revision.value + 1) {
      return false;
    }

    let refreshTerminal = false;
    let activeDeleted = false;
    let newDescriptor: SessionDescriptor | undefined;
    const terminalErrors: string[] = [];
    const previousSessions = sessions.value;
    let nextSessions = previousSessions;
    let nextCaches = caches.value;

    for (const change of envelope.changes) {
      switch (change.type) {
        case "upsert":
          if (previousSessions[change.session.ref.sessionId] === undefined) {
            newDescriptor = change.session;
          }
          nextSessions = {
            ...nextSessions,
            [change.session.ref.sessionId]: change.session,
          };
          break;
        case "terminal":
          if (change.session.error !== undefined) {
            terminalErrors.push(change.session.error.message);
          }
          refreshTerminal ||=
            change.session.ref.sessionId === activeSessionId.value;
          nextSessions = {
            ...nextSessions,
            [change.session.ref.sessionId]: change.session,
          };
          break;
        case "entries": {
          const entriesByKind = new Map<SessionEntryKind, SessionEntry[]>();
          for (const entry of change.entries) {
            const entries = entriesByKind.get(entry.kind) ?? [];
            entries.push(entry);
            entriesByKind.set(entry.kind, entries);
          }

          for (const [kind, entries] of entriesByKind) {
            const key = cacheKey(change.ref, kind);
            const cache = nextCaches[key];
            if (cache !== undefined) {
              nextCaches = {
                ...nextCaches,
                [key]: appendEntries(cache, entries),
              };
            }
          }
          nextSessions = {
            ...nextSessions,
            [change.session.ref.sessionId]: change.session,
          };
          break;
        }
        case "delete": {
          activeDeleted ||= change.refs.some(
            (ref) => ref.sessionId === activeSessionId.value,
          );
          nextSessions = { ...nextSessions };
          nextCaches = { ...nextCaches };
          for (const ref of change.refs) {
            if (ref.projectId !== currentProjectId.value) continue;

            delete nextSessions[ref.sessionId];
            for (const kind of ENTRY_KINDS) {
              delete nextCaches[cacheKey(ref, kind)];
            }
          }
          break;
        }
      }
    }

    sessions.value = nextSessions;
    caches.value = nextCaches;
    revision.value = envelope.revision;
    for (const message of terminalErrors) {
      sdk.window.showToast(message, {
        variant: "error",
        duration: 10_000,
      });
    }
    if (activeDeleted) {
      setActiveSession(list.value[0]?.ref.sessionId);
    } else if (newDescriptor !== undefined) {
      setActiveSession(newDescriptor.ref.sessionId, { loadEntries: false });
    }
    if (refreshTerminal) {
      runInBackground(
        refreshStaleEntries(),
        "Failed to refresh session entries",
      );
    }
    return true;
  };

  const queueReload = () => {
    if (reloadQueued) return;

    reloadQueued = true;
    queueMicrotask(() => {
      reloadQueued = false;
      runInBackground(
        hydrateProject(currentProjectId.value),
        "Failed to reload sessions",
      );
    });
  };

  const acceptEnvelope = (envelope: SessionChangeEnvelope) => {
    if (!hydrated.value) {
      pendingEnvelopes.push(envelope);
      return;
    }
    if (
      envelope.projectId === currentProjectId.value &&
      !applyEnvelope(envelope)
    ) {
      queueReload();
    }
  };

  const startProjectLoad = (projectId: string | undefined) => {
    const projectChanged = projectId !== currentProjectId.value;
    currentProjectId.value = projectId;
    generation.value += 1;
    hydrated.value = false;
    noProjectSelected.value = projectId === undefined;
    actionLoading.value = {};
    if (projectChanged) {
      sessions.value = {};
      caches.value = {};
      revision.value = 0;
    }
    return generation.value;
  };

  const finishProjectLoad = (token: number) => {
    if (token === generation.value) {
      hydrated.value = true;
    }
  };

  async function hydrateProject(
    projectId: string | undefined,
    retryBufferedFailure = false,
  ): Promise<ApiResult<void>> {
    const previousActiveSessionId = activeSessionId.value;
    const projectChanged = projectId !== currentProjectId.value;
    const token = startProjectLoad(projectId);
    viewStore.clearRequestDetail();
    if (projectChanged) {
      viewStore.resetSessionTabOrder();
      viewStore.setActiveSession(undefined);
    }
    pendingEnvelopes = pendingEnvelopes.filter(
      (envelope) => envelope.projectId === projectId,
    );

    if (projectId === undefined) {
      finishProjectLoad(token);
      return ok(undefined);
    }

    try {
      const result = await sdk.backend.listSessions(projectId);
      if (token !== generation.value || projectId !== currentProjectId.value) {
        return ok(undefined);
      }
      if (!result.success) {
        finishProjectLoad(token);
        if (
          retryBufferedFailure &&
          pendingEnvelopes.some(
            (envelope) => envelope.projectId === currentProjectId.value,
          )
        ) {
          queueReload();
        }
        return result;
      }
      if (result.value.projectId !== projectId) {
        finishProjectLoad(token);
        return error(
          "Session snapshot belongs to a stale project.",
          "CONFLICT",
        );
      }

      sessions.value = Object.fromEntries(
        result.value.sessions.map((session) => [
          session.ref.sessionId,
          session,
        ]),
      );
      caches.value = {};
      revision.value = result.value.revision;
      hydrated.value = true;

      const nextActiveSessionId =
        previousActiveSessionId !== undefined &&
        sessions.value[previousActiveSessionId] !== undefined
          ? previousActiveSessionId
          : result.value.sessions[0]?.ref.sessionId;
      if (nextActiveSessionId !== activeSessionId.value) {
        viewStore.setActiveSession(nextActiveSessionId);
      }
      const active =
        nextActiveSessionId === undefined
          ? undefined
          : sessions.value[nextActiveSessionId];
      if (active !== undefined) {
        initializeEntryCaches(active.ref);
      }

      const buffered = pendingEnvelopes
        .filter((envelope) => envelope.revision > revision.value)
        .sort((left, right) => left.revision - right.revision);
      pendingEnvelopes = [];
      for (const envelope of buffered) {
        if (!applyEnvelope(envelope)) {
          queueReload();
          break;
        }
      }
      await loadActiveEntries(true);
      return ok(undefined);
    } catch (cause: unknown) {
      finishProjectLoad(token);
      return error(toErrorMessage(cause));
    }
  }

  const initialize = async (): Promise<ApiResult<void>> => {
    const intent = ++projectLoadIntent;
    const result = await callBackend(() => sdk.backend.getCurrentProjectId());
    if (!result.success) return result;
    if (intent !== projectLoadIntent) return ok(undefined);

    return hydrateProject(result.value, true);
  };

  const reloadForProject = (projectId: string | undefined) => {
    projectLoadIntent += 1;
    return hydrateProject(projectId, true);
  };

  const loadRequestDetails = async (requestId: string) => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) return;

    const current = viewStore.requestDetail;
    if (
      current.kind !== "idle" &&
      current.requestId === requestId &&
      (current.kind === "loading" || current.kind === "success")
    ) {
      return;
    }

    const token = generation.value;
    const sessionId = descriptor.ref.sessionId;
    viewStore.startRequestDetail(requestId);

    try {
      const result = await loadRequestResponse(sdk, requestId);
      if (
        token !== generation.value ||
        activeSessionId.value !== sessionId ||
        selectedRequestId.value !== requestId
      ) {
        return;
      }
      if (result.success) {
        viewStore.completeRequestDetail(requestId, result.value);
      } else {
        viewStore.failRequestDetail(requestId, result.error.message);
      }
    } catch (error: unknown) {
      if (
        token === generation.value &&
        activeSessionId.value === sessionId &&
        selectedRequestId.value === requestId
      ) {
        viewStore.failRequestDetail(requestId, toErrorMessage(error));
      }
    }
  };

  const loadEntries = async (
    kind: SessionEntryKind,
    options: { reset?: boolean; sort?: SessionEntrySort; filter?: string } = {},
  ): Promise<ApiResult<void>> => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) return ok(undefined);

    const token = generation.value;
    const key = cacheKey(descriptor.ref, kind);
    const previous = caches.value[key];
    const shouldReset =
      options.reset === true ||
      (previous?.stale === true && previous.nextCursor === undefined);
    const current = shouldReset ? undefined : previous;
    if (
      (current?.loading && options.reset !== true) ||
      (!options.reset &&
        current !== undefined &&
        current.nextCursor === undefined)
    ) {
      return ok(undefined);
    }

    const loading = {
      ...(previous ?? createEntryCache(options.sort, options.filter)),
      sort: options.sort ?? current?.sort,
      filter: options.filter ?? current?.filter,
      loading: true,
      requestId: (previous?.requestId ?? 0) + 1,
    };
    caches.value = { ...caches.value, [key]: loading };

    try {
      const result = await sdk.backend.getSessionEntries({
        ref: descriptor.ref,
        kind,
        cursor: current?.nextCursor,
        limit: PAGE_SIZE,
        sort: options.sort ?? current?.sort,
        filter: options.filter ?? current?.filter,
      });
      if (
        token !== generation.value ||
        descriptor.ref.projectId !== currentProjectId.value ||
        caches.value[key]?.requestId !== loading.requestId
      ) {
        return ok(undefined);
      }

      const latest = caches.value[key];
      if (latest === undefined) return ok(undefined);

      if (!result.success) {
        caches.value = {
          ...caches.value,
          [key]: { ...latest, loading: false },
        };
        sdk.window.showToast(
          `Failed to load session ${kind} entries: ${result.error.message}`,
          { variant: "error", duration: 10_000 },
        );
        return result;
      }

      caches.value = {
        ...caches.value,
        [key]: shouldReset
          ? replacePage(latest, result.value)
          : appendPage(latest, result.value),
      };
      return ok(undefined);
    } catch (cause: unknown) {
      const message = toErrorMessage(cause);
      if (
        token === generation.value &&
        descriptor.ref.projectId === currentProjectId.value &&
        caches.value[key]?.requestId === loading.requestId
      ) {
        const latest = caches.value[key];
        if (latest !== undefined) {
          caches.value = {
            ...caches.value,
            [key]: { ...latest, loading: false },
          };
        }
        sdk.window.showToast(
          `Failed to load session ${kind} entries: ${message}`,
          { variant: "error", duration: 10_000 },
        );
      }
      return error(message);
    }
  };

  async function loadActiveEntries(force = false) {
    const loads: Promise<ApiResult<void>>[] = [];
    for (const kind of ENTRY_KINDS) {
      const state = activeEntryState(kind);
      if (
        (!force && state?.loading === true) ||
        (!force && state !== undefined && state.stale !== true)
      ) {
        continue;
      }
      loads.push(
        loadEntries(kind, {
          reset: state !== undefined,
          sort: state?.sort ?? LIVE_ENTRY_SORT,
          filter: state?.filter,
        }),
      );
    }
    await Promise.all(loads);
  }

  async function refreshStaleEntries() {
    const loads: Promise<ApiResult<void>>[] = [];
    for (const kind of ENTRY_KINDS) {
      const state = activeEntryState(kind);
      if (state?.stale === true) {
        loads.push(
          loadEntries(kind, {
            reset: true,
            sort: state.sort,
            filter: state.filter,
          }),
        );
      }
    }
    await Promise.all(loads);
  }

  async function exportEntries(
    kind: "request",
  ): Promise<ApiResult<SentRequest[]>>;
  async function exportEntries(
    kind: "finding",
  ): Promise<ApiResult<SessionFinding[]>>;
  async function exportEntries(kind: "log"): Promise<ApiResult<string[]>>;
  async function exportEntries(
    kind: SessionEntryKind,
  ): Promise<ApiResult<SessionEntryValue[]>> {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) return ok([]);

    const token = generation.value;
    const sessionId = descriptor.ref.sessionId;
    const values: SessionEntryValue[] = [];
    let cursor: string | undefined;
    do {
      const query: SessionEntriesQuery = {
        ref: descriptor.ref,
        kind,
        cursor,
        limit: 1_000,
        sort: LIVE_ENTRY_SORT,
      };
      const result = await callBackend(() =>
        sdk.backend.getSessionEntries(query),
      );
      if (token !== generation.value || activeSessionId.value !== sessionId) {
        return error(
          "The active project or session changed during export.",
          "CONFLICT",
        );
      }
      if (!result.success) return result;

      switch (kind) {
        case "request":
          values.push(...entryValues(result.value.items, kind));
          break;
        case "finding":
          values.push(...entryValues(result.value.items, kind));
          break;
        case "log":
          values.push(...entryValues(result.value.items, kind));
          break;
      }
      cursor = result.value.nextCursor;
    } while (cursor !== undefined);
    return ok(values);
  }

  function setActiveSession(
    id: string | undefined,
    options: { loadEntries?: boolean } = {},
  ) {
    const descriptor = id === undefined ? undefined : sessions.value[id];
    viewStore.setActiveSession(descriptor?.ref.sessionId);
    if (descriptor !== undefined && options.loadEntries === false) {
      initializeEntryCaches(descriptor.ref);
    }
    if (options.loadEntries !== false) {
      runInBackground(loadActiveEntries(), "Failed to load session entries");
    }
  }

  const selectStartedSession = (descriptor: SessionDescriptor) => {
    const alreadyActive = activeSessionId.value === descriptor.ref.sessionId;
    replaceDescriptor(descriptor);
    if (!alreadyActive) {
      const hasEntries =
        descriptor.requestsSent > 0 ||
        descriptor.findingsCount > 0 ||
        descriptor.logsCount > 0;
      setActiveSession(descriptor.ref.sessionId, { loadEntries: hasEntries });
    }
  };

  const runAction = async (
    action: SessionAction,
    request: (ref: SessionRef) => Promise<ApiResult<void>>,
  ): Promise<ApiResult<void>> => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) return ok(undefined);

    const id = descriptor.ref.sessionId;
    const token = generation.value;
    if (actionLoading.value[id] !== undefined) {
      return error(
        "Another action is already in progress for this session.",
        "CONFLICT",
      );
    }

    actionLoading.value = { ...actionLoading.value, [id]: action };
    try {
      const result = await callBackend(() => request(descriptor.ref));
      return result.success ? ok(undefined) : result;
    } finally {
      if (token === generation.value && actionLoading.value[id] === action) {
        const nextActions = { ...actionLoading.value };
        delete nextActions[id];
        actionLoading.value = nextActions;
      }
    }
  };

  const pauseActive = () =>
    runAction("pause", (ref) => sdk.backend.pauseSession(ref));
  const resumeActive = () =>
    runAction("resume", (ref) => sdk.backend.resumeSession(ref));
  const cancelActive = () =>
    runAction("cancel", (ref) => sdk.backend.cancelSession(ref));

  const rerunActive = async (): Promise<ApiResult<void>> => {
    const descriptor = activeDescriptor.value;
    const token = generation.value;
    if (descriptor === undefined || descriptor.rerun === undefined) {
      return error("This session cannot be rerun.", "VALIDATION");
    }
    const rerun = descriptor.rerun;
    const projectId = descriptor.ref.projectId;

    return runAction("rerun", async () => {
      const result = await sdk.backend.startMining(
        rerun.targetRequest,
        rerun.config,
      );
      if (!result.success) return result;

      if (token === generation.value && currentProjectId.value === projectId) {
        selectStartedSession(result.value);
      }
      return ok(undefined);
    });
  };

  const startSession = async (
    request: Request,
    config: ParamMinerConfig,
  ): Promise<ApiResult<SessionDescriptor>> => {
    const token = generation.value;
    try {
      const result = await sdk.backend.startMining(request, config);
      if (
        result.success &&
        token === generation.value &&
        result.value.ref.projectId === currentProjectId.value
      ) {
        selectStartedSession(result.value);
      }
      return result;
    } catch (cause: unknown) {
      return error(toErrorMessage(cause));
    }
  };

  const deleteSession = async (id: string): Promise<ApiResult<void>> => {
    const descriptor = sessions.value[id];
    const token = generation.value;
    if (descriptor === undefined) return ok(undefined);

    const result = await callBackend(() =>
      sdk.backend.deleteSessions([descriptor.ref]),
    );
    if (result.success && token === generation.value) {
      removeDescriptors([descriptor.ref]);
      return ok(undefined);
    }
    return result;
  };

  const deleteActive = async (): Promise<ApiResult<void>> => {
    const id = activeSessionId.value;
    return id === undefined ? ok(undefined) : deleteSession(id);
  };

  const deleteOtherSessions = async (
    keepId: string,
  ): Promise<ApiResult<void>> => {
    const token = generation.value;
    const refs = Object.values(sessions.value)
      .filter((session) => session.ref.sessionId !== keepId)
      .map((session) => session.ref);
    if (refs.length === 0) return ok(undefined);

    const result = await callBackend(() => sdk.backend.deleteSessions(refs));
    if (result.success && token === generation.value) {
      removeDescriptors(refs);
      setActiveSession(keepId);
      return ok(undefined);
    }
    return result;
  };

  return {
    activeActionLoading,
    noProjectSelected,
    hydrated,
    currentProjectId,
    list,
    activeSession,
    activeDescriptor,
    activeEntryState,
    loadRequestDetails,
    acceptEnvelope,
    setActiveSession,
    loadEntries,
    exportEntries,
    startSession,
    pauseActive,
    resumeActive,
    cancelActive,
    rerunActive,
    deleteSession,
    deleteActive,
    deleteOtherSessions,
    initialize,
    reloadForProject,
  };
});
