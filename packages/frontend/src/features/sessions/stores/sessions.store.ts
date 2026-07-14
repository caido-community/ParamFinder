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
import { computed, readonly, ref } from "vue";

import { loadRequestResponse } from "../lib/loadRequestResponse";

import { createEntryCache } from "./sessionEntryCache";
import { useSessionViewStore } from "./sessionView.store";
import {
  cancelSession,
  deleteSessions,
  pauseSession,
  readCurrentProject,
  readSessionEntries,
  readSessionSnapshot,
  resumeSession,
  startMining,
} from "./store.effects";
import {
  cacheKey,
  initialModel,
  type SessionAction,
  type SessionsModel,
  type SessionView,
} from "./store.model";
import { type SessionsMessage, update as updateModel } from "./store.update";

import { useSDK } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";

const PAGE_SIZE = 250;
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
  const model = ref<SessionsModel>({
    ...initialModel,
    sessions: {},
    caches: {},
    actionLoading: {},
  });

  const sessions = computed(() => model.value.sessions);
  const caches = computed(() => model.value.caches);
  const currentProjectId = computed(() => model.value.currentProjectId);
  const revision = computed(() => model.value.revision);
  const hydrated = computed(() => model.value.hydrated);
  const noProjectSelected = computed(() => model.value.noProjectSelected);
  const actionLoading = computed(() => model.value.actionLoading);
  const generation = computed(() => model.value.generation);

  const dispatch = (message: SessionsMessage) => {
    model.value = updateModel(model.value, message);
  };

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
    dispatch({ type: "UPSERT_DESCRIPTOR", descriptor });
  };

  const removeDescriptors = (refs: SessionRef[]) => {
    const activeRemoved = refs.some(
      (ref) => ref.sessionId === activeSessionId.value,
    );
    dispatch({ type: "REMOVE_DESCRIPTORS", refs });
    if (activeRemoved) {
      const nextId = list.value[0]?.ref.sessionId;
      setActiveSession(nextId);
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
    for (const change of envelope.changes) {
      if (
        change.type === "upsert" &&
        sessions.value[change.session.ref.sessionId] === undefined
      ) {
        newDescriptor = change.session;
      }
      if (change.type === "terminal") {
        const terminalError = change.session.error;
        if (terminalError !== undefined) {
          sdk.window.showToast(terminalError.message, {
            variant: "error",
            duration: 10_000,
          });
        }
        refreshTerminal =
          refreshTerminal ||
          change.session.ref.sessionId === activeSessionId.value;
      }
      if (change.type === "delete") {
        activeDeleted = change.refs.some(
          (ref) => ref.sessionId === activeSessionId.value,
        );
      }
    }
    dispatch({ type: "APPLY_ENVELOPE", envelope });
    if (activeDeleted) {
      const nextId = list.value[0]?.ref.sessionId;
      setActiveSession(nextId);
    } else if (newDescriptor !== undefined) {
      setActiveSession(newDescriptor.ref.sessionId, { loadEntries: false });
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
    retryBufferedFailure = false,
  ): Promise<ApiResult<void>> => {
    const previousActiveSessionId = activeSessionId.value;
    const projectChanged = projectId !== currentProjectId.value;
    dispatch({ type: "PROJECT_LOAD_STARTED", projectId });
    viewStore.clearRequestDetails();
    if (projectChanged) {
      viewStore.resetSessionTabOrder();
      viewStore.setActiveSession(undefined);
    }
    const token = generation.value;
    pendingEnvelopes = pendingEnvelopes.filter(
      (envelope) => envelope.projectId === projectId,
    );

    if (projectId === undefined) {
      dispatch({ type: "PROJECT_LOAD_FINISHED", generation: token });
      return ok(undefined);
    }

    try {
      const result = await readSessionSnapshot(sdk, projectId);
      if (token !== generation.value || projectId !== currentProjectId.value) {
        return ok(undefined);
      }
      if (!result.success) {
        dispatch({ type: "PROJECT_LOAD_FINISHED", generation: token });
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
        dispatch({ type: "PROJECT_LOAD_FINISHED", generation: token });
        return error(
          "Session snapshot belongs to a stale project.",
          "CONFLICT",
        );
      }

      dispatch({
        type: "PROJECT_LOAD_SUCCESS",
        generation: token,
        snapshot: result.value,
      });

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
        dispatch({ type: "INITIALIZE_ENTRY_CACHES", ref: active.ref });
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
    } catch (err: unknown) {
      dispatch({ type: "PROJECT_LOAD_FINISHED", generation: token });
      return error(toErrorMessage(err));
    }
  };

  const initialize = async (): Promise<ApiResult<void>> => {
    const intent = ++projectLoadIntent;
    const result = await readCurrentProject(sdk);
    if (!result.success) {
      return result;
    }
    if (intent !== projectLoadIntent) {
      return ok(undefined);
    }
    return hydrateProject(result.value, true);
  };

  const reloadForProject = (projectId: string | undefined) => {
    projectLoadIntent++;
    return hydrateProject(projectId, true);
  };

  const loadRequestDetails = async (requestId: string): Promise<void> => {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) return;
    const current = viewStore.getRequestDetailState(requestId);
    if (current?.status === "loading" || current?.status === "success") return;

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
    } catch (err: unknown) {
      if (
        token === generation.value &&
        activeSessionId.value === sessionId &&
        selectedRequestId.value === requestId
      ) {
        viewStore.failRequestDetail(requestId, toErrorMessage(err));
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
    dispatch({ type: "ENTRY_LOAD_STARTED", key, cache: loading });

    try {
      const result = await readSessionEntries(sdk, {
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
      if (!result.success) {
        dispatch({
          type: "ENTRY_LOAD_FAILED",
          key,
          requestId: loading.requestId,
          error: result.error.message,
        });
        sdk.window.showToast(
          `Failed to load session ${kind} entries: ${result.error.message}`,
          { variant: "error", duration: 10_000 },
        );
        return result;
      }
      dispatch({
        type: "ENTRY_LOAD_SUCCEEDED",
        key,
        requestId: loading.requestId,
        page: result.value,
        replace: shouldReset,
      });
      return ok(undefined);
    } catch (err: unknown) {
      const message = toErrorMessage(err);
      if (
        token === generation.value &&
        descriptor.ref.projectId === currentProjectId.value &&
        caches.value[key]?.requestId === loading.requestId
      ) {
        dispatch({
          type: "ENTRY_LOAD_FAILED",
          key,
          requestId: loading.requestId,
          error: message,
        });
        sdk.window.showToast(
          `Failed to load session ${kind} entries: ${message}`,
          { variant: "error", duration: 10_000 },
        );
      }
      return error(message);
    }
  };

  async function loadActiveEntries(force = false): Promise<void> {
    const kinds: SessionEntryKind[] = ["request", "finding", "log"];
    await Promise.all(
      kinds.map(async (kind) => {
        const state = activeEntryState(kind);
        if (
          (!force && state?.loading === true) ||
          (!force && state !== undefined && state.stale !== true)
        ) {
          return;
        }
        await loadEntries(kind, {
          reset: state !== undefined,
          sort: state?.sort ?? { field: "sequence", direction: "asc" },
          filter: state?.filter,
        });
      }),
    );
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
  ): Promise<ApiResult<SessionEntryValue[]>> {
    const descriptor = activeDescriptor.value;
    if (descriptor === undefined) {
      return ok([]);
    }
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
        sort: { field: "sequence", direction: "asc" },
      };
      const result = await readSessionEntries(sdk, query);
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
    const descriptor = id === undefined ? undefined : sessions.value[id];
    viewStore.setActiveSession(descriptor?.ref.sessionId);
    if (descriptor !== undefined && options.loadEntries === false) {
      dispatch({ type: "INITIALIZE_ENTRY_CACHES", ref: descriptor.ref });
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
    dispatch({ type: "ACTION_STARTED", sessionId: id, action });
    try {
      const result = await request(descriptor.ref);
      return result.success ? ok(undefined) : result;
    } catch (err: unknown) {
      return error(toErrorMessage(err));
    } finally {
      dispatch({
        type: "ACTION_FINISHED",
        sessionId: id,
        action,
        generation: token,
      });
    }
  };

  const pauseActive = () => runAction("pause", (ref) => pauseSession(sdk, ref));
  const resumeActive = () =>
    runAction("resume", (ref) => resumeSession(sdk, ref));
  const cancelActive = () =>
    runAction("cancel", (ref) => cancelSession(sdk, ref));

  const rerunActive = async (): Promise<ApiResult<void>> => {
    const descriptor = activeDescriptor.value;
    const token = generation.value;
    if (descriptor?.rerun === undefined) {
      return error("This session cannot be rerun.", "VALIDATION");
    }
    return runAction("rerun", async () => {
      const result = await startMining(
        sdk,
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
      const result = await startMining(sdk, request, config);
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
    const result = await deleteSessions(sdk, [descriptor.ref]);
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
    const result = await deleteSessions(sdk, refs);
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
    state: readonly(model),
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
    deleteOtherSessions,
    initialize,
    reloadForProject,
  };
});
