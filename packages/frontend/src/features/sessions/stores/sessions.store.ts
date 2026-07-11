import { defineStore } from "pinia";
import {
  type ApiResult,
  compareSessionIds,
  error,
  ok,
  type ParamMinerConfig,
  type Request,
  type RequestResponse,
  type SentRequest,
  type SessionChangeEnvelope,
  type SessionDescriptor,
  type SessionEntriesQuery,
  type SessionEntry,
  type SessionEntryKind,
  type SessionEntrySort,
  type SessionFinding,
  type SessionRef,
} from "shared";
import { computed, ref, shallowRef } from "vue";

import { loadRequestResponse } from "../lib/loadRequestResponse";

import {
  appendEntries,
  appendPage,
  createEntryCache,
  replacePage,
  type SessionEntryCache,
} from "./sessionEntryCache";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

export type SessionRequestsTab = "requests" | "findings";
export type SessionAction = "pause" | "resume" | "cancel" | "delete" | "rerun";

export type RequestDetailState = {
  response?: RequestResponse;
  error?: string;
  loading: boolean;
};

export type SessionView = SessionDescriptor & {
  id: string;
  sentRequests: SentRequest[];
  findings: SessionFinding[];
  logs: string[];
};

const PAGE_SIZE = 250;
const LIVE_ENTRY_SORT = { field: "sequence", direction: "asc" } as const;
const ENTRY_KINDS: SessionEntryKind[] = ["request", "finding", "log"];

function cacheKey(ref: SessionRef, kind: SessionEntryKind): string {
  return `${ref.projectId}\u0000${ref.sessionId}\u0000${kind}`;
}

function entryValues(entries: SessionEntry[], kind: "request"): SentRequest[];
function entryValues(
  entries: SessionEntry[],
  kind: "finding",
): SessionFinding[];
function entryValues(entries: SessionEntry[], kind: "log"): string[];
function entryValues(
  entries: SessionEntry[],
  kind: SessionEntryKind,
): Array<SessionEntry["value"]> {
  switch (kind) {
    case "request":
      return entries.flatMap((entry) =>
        entry.kind === kind ? [entry.value] : [],
      );
    case "finding":
      return entries.flatMap((entry) =>
        entry.kind === kind ? [entry.value] : [],
      );
    case "log":
      return entries.flatMap((entry) =>
        entry.kind === kind ? [entry.value] : [],
      );
  }
}

export const useSessionsStore = defineStore("sessions", () => {
  const sdk = useSDK();

  const sessions = shallowRef<Record<string, SessionDescriptor>>({});
  const caches = shallowRef<Record<string, SessionEntryCache>>({});
  const currentProjectId = ref<string>();
  const revision = ref(0);
  const hydrated = ref(false);
  const noProjectSelected = ref(false);
  const activeSessionId = ref<string>();
  const selectedRequestId = ref<string>();
  const selectedFindingKey = ref<string>();
  const requestsTab = ref<SessionRequestsTab>("findings");
  const actionLoading = ref<Record<string, SessionAction>>({});
  const requestDetails = shallowRef<Record<string, RequestDetailState>>({});
  const generation = ref(0);

  let pendingEnvelopes: SessionChangeEnvelope[] = [];
  let reloadQueued = false;

  const list = computed(() =>
    Object.values(sessions.value).sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        compareSessionIds(right.ref.sessionId, left.ref.sessionId),
    ),
  );

  const activeDescriptor = computed(() =>
    activeSessionId.value === undefined
      ? undefined
      : sessions.value[activeSessionId.value],
  );

  const getCache = (descriptor: SessionDescriptor, kind: SessionEntryKind) =>
    caches.value[cacheKey(descriptor.ref, kind)];

  const activeSession = computed<SessionView | undefined>(() => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) {
      return undefined;
    }
    return {
      ...descriptor,
      id: descriptor.ref.sessionId,
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

  const replaceDescriptor = (descriptor: SessionDescriptor) => {
    if (descriptor.ref.projectId !== currentProjectId.value) {
      return;
    }
    sessions.value = {
      ...sessions.value,
      [descriptor.ref.sessionId]: descriptor,
    };
  };

  const removeDescriptors = (refs: SessionRef[]) => {
    const next = { ...sessions.value };
    let changed = false;
    for (const ref of refs) {
      if (
        ref.projectId === currentProjectId.value &&
        next[ref.sessionId] !== undefined
      ) {
        delete next[ref.sessionId];
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    sessions.value = next;
    if (
      activeSessionId.value !== undefined &&
      next[activeSessionId.value] === undefined
    ) {
      activeSessionId.value = Object.keys(next)[0];
      selectedRequestId.value = undefined;
      selectedFindingKey.value = undefined;
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
    let newSessionId: string | undefined;
    const cacheUpdates = new Map<string, SessionEntryCache>();
    for (const change of envelope.changes) {
      switch (change.type) {
        case "upsert": {
          if (sessions.value[change.session.ref.sessionId] === undefined) {
            newSessionId = change.session.ref.sessionId;
          }
          replaceDescriptor(change.session);
          break;
        }
        case "terminal": {
          replaceDescriptor(change.session);
          const terminalError = change.error ?? change.session.error;
          if (terminalError !== undefined) {
            sdk.window.showToast(terminalError.message, {
              variant: "error",
              duration: 10_000,
            });
          }
          refreshTerminal =
            refreshTerminal ||
            change.session.ref.sessionId === activeSessionId.value;
          break;
        }
        case "entries": {
          replaceDescriptor(change.session);
          const entriesByKind = new Map<SessionEntryKind, SessionEntry[]>();
          for (const entry of change.entries) {
            const entries = entriesByKind.get(entry.kind) ?? [];
            entries.push(entry);
            entriesByKind.set(entry.kind, entries);
          }
          for (const [kind, entries] of entriesByKind) {
            const key = cacheKey(change.ref, kind);
            const current = cacheUpdates.get(key) ?? caches.value[key];
            if (current !== undefined) {
              cacheUpdates.set(key, appendEntries(current, entries));
            }
          }
          break;
        }
        case "delete":
          removeDescriptors(change.refs);
          break;
      }
    }
    if (cacheUpdates.size > 0) {
      caches.value = {
        ...caches.value,
        ...Object.fromEntries(cacheUpdates),
      };
    }
    revision.value = envelope.revision;
    if (newSessionId !== undefined) {
      setActiveSession(newSessionId, { loadEntries: false });
    }
    if (refreshTerminal) {
      void refreshStaleEntries();
    }
    return true;
  };

  const queueReload = () => {
    if (reloadQueued) {
      return;
    }
    reloadQueued = true;
    void Promise.resolve().then(async () => {
      reloadQueued = false;
      await hydrateProject(currentProjectId.value);
    });
  };

  const acceptEnvelope = (envelope: SessionChangeEnvelope) => {
    if (!hydrated.value) {
      pendingEnvelopes.push(envelope);
      return;
    }
    if (envelope.projectId !== currentProjectId.value) {
      return;
    }
    if (!applyEnvelope(envelope)) {
      queueReload();
    }
  };

  const hydrateProject = async (
    projectId: string | undefined,
  ): Promise<ApiResult<void>> => {
    const token = ++generation.value;
    const projectChanged = projectId !== currentProjectId.value;
    const previousActiveSessionId = activeSessionId.value;
    currentProjectId.value = projectId;
    hydrated.value = false;
    noProjectSelected.value = projectId === undefined;
    if (projectChanged) {
      sessions.value = {};
      caches.value = {};
      activeSessionId.value = undefined;
      selectedRequestId.value = undefined;
      selectedFindingKey.value = undefined;
      actionLoading.value = {};
      requestDetails.value = {};
    }
    if (projectChanged) {
      revision.value = 0;
    }
    pendingEnvelopes = pendingEnvelopes.filter(
      (envelope) => envelope.projectId === projectId,
    );

    if (projectId === undefined) {
      hydrated.value = true;
      return ok(undefined);
    }

    try {
      const result = await sdk.backend.listSessions(projectId);
      if (token !== generation.value || projectId !== currentProjectId.value) {
        return ok(undefined);
      }
      if (!result.success) {
        hydrated.value = true;
        return result;
      }
      if (result.value.projectId !== projectId) {
        hydrated.value = true;
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
      revision.value = result.value.revision;
      activeSessionId.value =
        previousActiveSessionId !== undefined &&
        sessions.value[previousActiveSessionId] !== undefined
          ? previousActiveSessionId
          : result.value.sessions[0]?.ref.sessionId;
      hydrated.value = true;

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
      await loadActiveEntries();
      return ok(undefined);
    } catch (err: unknown) {
      if (token === generation.value) {
        hydrated.value = true;
      }
      return error(toErrorMessage(err));
    }
  };

  const initialize = async (): Promise<ApiResult<void>> => {
    const result = await sdk.backend.getCurrentProjectId();
    if (!result.success) {
      return result;
    }
    return hydrateProject(result.value);
  };

  const reloadForProject = (projectId: string | undefined) =>
    hydrateProject(projectId);

  const getRequestDetailState = (requestId: string | undefined) =>
    requestId === undefined ? undefined : requestDetails.value[requestId];

  const loadRequestDetails = async (requestId: string): Promise<void> => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) return;
    const current = requestDetails.value[requestId];
    if (current?.loading || current?.response !== undefined) return;

    const token = generation.value;
    const sessionId = descriptor.ref.sessionId;
    requestDetails.value = {
      ...requestDetails.value,
      [requestId]: { loading: true },
    };

    try {
      const result = await loadRequestResponse(sdk, requestId);
      if (
        token !== generation.value ||
        activeSessionId.value !== sessionId ||
        selectedRequestId.value !== requestId
      ) {
        return;
      }
      requestDetails.value = {
        ...requestDetails.value,
        [requestId]: result.success
          ? { loading: false, response: result.value }
          : { loading: false, error: result.error.message },
      };
    } catch (err: unknown) {
      if (
        token === generation.value &&
        activeSessionId.value === sessionId &&
        selectedRequestId.value === requestId
      ) {
        requestDetails.value = {
          ...requestDetails.value,
          [requestId]: { loading: false, error: toErrorMessage(err) },
        };
      }
    }
  };

  const loadEntries = async (
    kind: SessionEntryKind,
    options: { reset?: boolean; sort?: SessionEntrySort; filter?: string } = {},
  ): Promise<ApiResult<void>> => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) {
      return ok(undefined);
    }
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
      error: undefined,
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
        activeSessionId.value !== descriptor.ref.sessionId ||
        caches.value[key]?.requestId !== loading.requestId
      ) {
        return ok(undefined);
      }
      if (!result.success) {
        const latest = caches.value[key];
        if (latest === undefined) {
          return result;
        }
        caches.value = {
          ...caches.value,
          [key]: {
            ...latest,
            loading: false,
            error: result.error.message,
          },
        };
        sdk.window.showToast(
          `Failed to load session ${kind} entries: ${result.error.message}`,
          { variant: "error", duration: 10_000 },
        );
        return result;
      }
      const latest = caches.value[key];
      if (latest === undefined) {
        return ok(undefined);
      }
      caches.value = {
        ...caches.value,
        [key]: shouldReset
          ? replacePage(latest, result.value)
          : appendPage(latest, result.value),
      };
      return ok(undefined);
    } catch (err: unknown) {
      const message = toErrorMessage(err);
      if (
        token === generation.value &&
        descriptor.ref.projectId === currentProjectId.value &&
        activeSessionId.value === descriptor.ref.sessionId &&
        caches.value[key]?.requestId === loading.requestId
      ) {
        const latest = caches.value[key];
        if (latest === undefined) {
          return error(message);
        }
        caches.value = {
          ...caches.value,
          [key]: { ...latest, loading: false, error: message },
        };
        sdk.window.showToast(
          `Failed to load session ${kind} entries: ${message}`,
          { variant: "error", duration: 10_000 },
        );
      }
      return error(message);
    }
  };

  async function loadActiveEntries(): Promise<void> {
    await Promise.all([
      loadEntries("request", {
        reset: true,
        sort: { field: "sequence", direction: "asc" },
      }),
      loadEntries("finding", {
        reset: true,
        sort: { field: "sequence", direction: "asc" },
      }),
      loadEntries("log", {
        reset: true,
        sort: { field: "sequence", direction: "asc" },
      }),
    ]);
  }

  async function refreshStaleEntries(): Promise<void> {
    const kinds: SessionEntryKind[] = ["request", "finding", "log"];
    await Promise.all(
      kinds.map(async (kind) => {
        const state = activeEntryState(kind);
        if (state?.stale === true) {
          await loadEntries(kind, {
            reset: true,
            sort: state.sort,
            filter: state.filter,
          });
        }
      }),
    );
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
  ): Promise<ApiResult<Array<SessionEntry["value"]>>> {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) {
      return ok([]);
    }
    const token = generation.value;
    const sessionId = descriptor.ref.sessionId;
    const values: Array<SessionEntry["value"]> = [];
    let cursor: string | undefined;
    do {
      const query: SessionEntriesQuery = {
        ref: descriptor.ref,
        kind,
        cursor,
        limit: 1_000,
        sort: { field: "sequence", direction: "asc" },
      };
      const result = await sdk.backend.getSessionEntries(query);
      if (token !== generation.value || activeSessionId.value !== sessionId) {
        return error(
          "The active project or session changed during export.",
          "CONFLICT",
        );
      }
      if (!result.success) {
        return result;
      }
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

  const setActiveSession = (
    id: string | undefined,
    options: { loadEntries?: boolean } = {},
  ) => {
    activeSessionId.value = id;
    selectedRequestId.value = undefined;
    selectedFindingKey.value = undefined;
    requestDetails.value = {};
    const descriptor = id === undefined ? undefined : sessions.value[id];
    if (descriptor !== undefined) {
      const prefix = `${descriptor.ref.projectId}\u0000${descriptor.ref.sessionId}\u0000`;
      const retained = Object.fromEntries(
        Object.entries(caches.value).filter(([key]) => key.startsWith(prefix)),
      );
      if (options.loadEntries === false) {
        for (const kind of ENTRY_KINDS) {
          const key = cacheKey(descriptor.ref, kind);
          retained[key] ??= createEntryCache(LIVE_ENTRY_SORT);
        }
      }
      caches.value = retained;
    } else {
      caches.value = {};
    }
    if (options.loadEntries !== false) {
      void loadActiveEntries();
    }
  };

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

  const setSelectedRequest = (id: string | undefined) => {
    selectedRequestId.value = id;
    selectedFindingKey.value = undefined;
    requestDetails.value = {};
  };

  const setSelectedFinding = (requestId: string, findingKey: string) => {
    selectedRequestId.value = requestId;
    selectedFindingKey.value = findingKey;
    requestDetails.value = {};
  };

  const setRequestsTab = (tab: SessionRequestsTab) => {
    requestsTab.value = tab;
  };

  const openFinding = (requestId: string, findingKey: string) => {
    setRequestsTab("findings");
    setSelectedFinding(requestId, findingKey);
  };

  const isBusy = (id: string) => actionLoading.value[id] !== undefined;

  const runAction = async (
    action: SessionAction,
    request: (ref: SessionRef) => Promise<ApiResult<void>>,
  ): Promise<ApiResult<void>> => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) {
      return ok(undefined);
    }
    const id = descriptor.ref.sessionId;
    const token = generation.value;
    if (isBusy(id)) {
      return error(
        "Another action is already in progress for this session.",
        "CONFLICT",
      );
    }
    actionLoading.value = { ...actionLoading.value, [id]: action };
    try {
      const result = await request(descriptor.ref);
      return result.success ? ok(undefined) : result;
    } catch (err: unknown) {
      return error(toErrorMessage(err));
    } finally {
      if (token === generation.value && actionLoading.value[id] === action) {
        const next = { ...actionLoading.value };
        delete next[id];
        actionLoading.value = next;
      }
    }
  };

  const pauseActive = () => runAction("pause", sdk.backend.pauseSession);
  const resumeActive = () => runAction("resume", sdk.backend.resumeSession);
  const cancelActive = () => runAction("cancel", sdk.backend.cancelSession);

  const rerunActive = async (): Promise<ApiResult<void>> => {
    const descriptor = activeDescriptor.value;
    const token = generation.value;
    if (descriptor?.rerun === undefined) {
      return error("This session cannot be rerun.", "VALIDATION");
    }
    return runAction("rerun", async () => {
      const result = await sdk.backend.startMining(
        descriptor.rerun!.targetRequest,
        descriptor.rerun!.config,
      );
      if (result.success) {
        if (
          token === generation.value &&
          currentProjectId.value === descriptor.ref.projectId
        ) {
          selectStartedSession(result.value);
        }
        return ok(undefined);
      }
      return result;
    });
  };

  const startSession = async (
    request: Request,
    config: ParamMinerConfig,
  ): Promise<ApiResult<SessionDescriptor>> => {
    const token = generation.value;
    try {
      const result = await sdk.backend.startMining(request, config);
      if (!result.success) {
        return result;
      }
      if (
        token === generation.value &&
        result.value.ref.projectId === currentProjectId.value
      ) {
        selectStartedSession(result.value);
      }
      return result;
    } catch (err: unknown) {
      return error(toErrorMessage(err));
    }
  };

  const deleteSession = async (id: string): Promise<ApiResult<void>> => {
    const descriptor = sessions.value[id];
    const token = generation.value;
    if (descriptor === undefined) {
      return ok(undefined);
    }
    const result = await sdk.backend.deleteSessions([descriptor.ref]);
    if (result.success) {
      if (token === generation.value) {
        removeDescriptors([descriptor.ref]);
      }
      return ok(undefined);
    }
    return result;
  };

  const deleteOtherSessions = async (
    keepId: string,
  ): Promise<ApiResult<void>> => {
    const token = generation.value;
    const refs = Object.values(sessions.value)
      .filter((session) => session.ref.sessionId !== keepId)
      .map((session) => session.ref);
    if (refs.length === 0) {
      return ok(undefined);
    }
    const result = await sdk.backend.deleteSessions(refs);
    if (result.success) {
      if (token === generation.value) {
        removeDescriptors(refs);
        setActiveSession(keepId);
      }
      return ok(undefined);
    }
    return result;
  };

  return {
    activeSessionId,
    selectedRequestId,
    selectedFindingKey,
    requestsTab,
    activeActionLoading,
    noProjectSelected,
    currentProjectId,
    list,
    activeSession,
    activeDescriptor,
    activeEntryState,
    getRequestDetailState,
    loadRequestDetails,
    acceptEnvelope,
    setActiveSession,
    setSelectedRequest,
    setSelectedFinding,
    setRequestsTab,
    openFinding,
    loadEntries,
    exportEntries,
    startSession,
    pauseActive,
    resumeActive,
    cancelActive,
    rerunActive,
    deleteSession,
    deleteOtherSessions,
    initialize,
    reloadForProject,
  };
});
