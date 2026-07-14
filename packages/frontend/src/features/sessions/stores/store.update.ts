import type {
  CursorPage,
  ProjectSessionSnapshot,
  SessionChangeEnvelope,
  SessionDescriptor,
  SessionEntry,
  SessionEntryKind,
  SessionRef,
} from "shared";

import {
  appendEntries,
  appendPage,
  createEntryCache,
  replacePage,
  type SessionEntryCache,
} from "./sessionEntryCache";
import {
  cacheKey,
  type SessionAction,
  type SessionsModel,
} from "./store.model";

const LIVE_ENTRY_SORT = { field: "sequence", direction: "asc" } as const;
const ENTRY_KINDS: SessionEntryKind[] = ["request", "finding", "log"];

export type SessionsMessage =
  | { type: "PROJECT_LOAD_STARTED"; projectId?: string }
  | {
      type: "PROJECT_LOAD_SUCCESS";
      generation: number;
      snapshot: ProjectSessionSnapshot;
    }
  | { type: "PROJECT_LOAD_FINISHED"; generation: number }
  | { type: "APPLY_ENVELOPE"; envelope: SessionChangeEnvelope }
  | { type: "UPSERT_DESCRIPTOR"; descriptor: SessionDescriptor }
  | { type: "REMOVE_DESCRIPTORS"; refs: SessionRef[] }
  | { type: "INITIALIZE_ENTRY_CACHES"; ref: SessionRef }
  | { type: "ENTRY_LOAD_STARTED"; key: string; cache: SessionEntryCache }
  | {
      type: "ENTRY_LOAD_SUCCEEDED";
      key: string;
      requestId: number;
      page: CursorPage<SessionEntry>;
      replace: boolean;
    }
  | {
      type: "ENTRY_LOAD_FAILED";
      key: string;
      requestId: number;
      error: string;
    }
  | {
      type: "ACTION_STARTED";
      sessionId: string;
      action: SessionAction;
    }
  | {
      type: "ACTION_FINISHED";
      sessionId: string;
      action: SessionAction;
      generation: number;
    };

function startProjectLoad(
  model: SessionsModel,
  projectId?: string,
): SessionsModel {
  const projectChanged = projectId !== model.currentProjectId;
  return {
    ...model,
    currentProjectId: projectId,
    generation: model.generation + 1,
    hydrated: false,
    noProjectSelected: projectId === undefined,
    actionLoading: {},
    ...(projectChanged
      ? {
          sessions: {},
          caches: {},
          revision: 0,
        }
      : {}),
  };
}

function completeProjectLoad(
  model: SessionsModel,
  generation: number,
  snapshot: ProjectSessionSnapshot,
): SessionsModel {
  if (
    generation !== model.generation ||
    snapshot.projectId !== model.currentProjectId
  ) {
    return model;
  }
  const sessions = Object.fromEntries(
    snapshot.sessions.map((session) => [session.ref.sessionId, session]),
  );
  const sessionIds = new Set(Object.keys(sessions));
  const caches = Object.fromEntries(
    Object.entries(model.caches).filter(([key]) => {
      const [projectId, sessionId] = key.split("\u0000");
      return (
        projectId === snapshot.projectId && sessionIds.has(sessionId ?? "")
      );
    }),
  );
  return {
    ...model,
    sessions,
    caches,
    revision: snapshot.revision,
    hydrated: true,
  };
}

function initializeEntryCaches(
  model: SessionsModel,
  ref: SessionRef,
): SessionsModel {
  const caches = { ...model.caches };
  for (const kind of ENTRY_KINDS) {
    const key = cacheKey(ref, kind);
    caches[key] ??= createEntryCache(LIVE_ENTRY_SORT);
  }
  return {
    ...model,
    caches,
  };
}

function finishEntryLoad(
  model: SessionsModel,
  message: Extract<SessionsMessage, { type: "ENTRY_LOAD_SUCCEEDED" }>,
) {
  const cache = model.caches[message.key];
  if (cache?.requestId !== message.requestId) return model;
  return {
    ...model,
    caches: {
      ...model.caches,
      [message.key]: message.replace
        ? replacePage(cache, message.page)
        : appendPage(cache, message.page),
    },
  };
}

function removeDescriptors(model: SessionsModel, refs: SessionRef[]) {
  const sessions = { ...model.sessions };
  const caches = { ...model.caches };
  for (const ref of refs) {
    if (ref.projectId === model.currentProjectId) {
      delete sessions[ref.sessionId];
      for (const kind of ENTRY_KINDS) {
        delete caches[cacheKey(ref, kind)];
      }
    }
  }
  return { ...model, sessions, caches };
}

function applyEnvelope(model: SessionsModel, envelope: SessionChangeEnvelope) {
  if (
    envelope.projectId !== model.currentProjectId ||
    envelope.revision <= model.revision ||
    envelope.revision !== model.revision + 1
  ) {
    return model;
  }

  let next = model;
  for (const change of envelope.changes) {
    switch (change.type) {
      case "upsert": {
        next = {
          ...next,
          sessions: {
            ...next.sessions,
            [change.session.ref.sessionId]: change.session,
          },
        };
        break;
      }
      case "terminal":
        next = {
          ...next,
          sessions: {
            ...next.sessions,
            [change.session.ref.sessionId]: change.session,
          },
        };
        break;
      case "entries": {
        const byKind = new Map<SessionEntryKind, SessionEntry[]>();
        for (const entry of change.entries) {
          const entries = byKind.get(entry.kind) ?? [];
          entries.push(entry);
          byKind.set(entry.kind, entries);
        }
        let caches = next.caches;
        for (const [kind, entries] of byKind) {
          const key = cacheKey(change.ref, kind);
          const cache = caches[key];
          if (cache !== undefined) {
            caches = { ...caches, [key]: appendEntries(cache, entries) };
          }
        }
        next = {
          ...next,
          sessions: {
            ...next.sessions,
            [change.session.ref.sessionId]: change.session,
          },
          caches,
        };
        break;
      }
      case "delete":
        next = removeDescriptors(next, change.refs);
        break;
    }
  }
  return { ...next, revision: envelope.revision };
}

export function update(
  model: SessionsModel,
  message: SessionsMessage,
): SessionsModel {
  switch (message.type) {
    case "PROJECT_LOAD_STARTED":
      return startProjectLoad(model, message.projectId);
    case "PROJECT_LOAD_SUCCESS":
      return completeProjectLoad(model, message.generation, message.snapshot);
    case "PROJECT_LOAD_FINISHED":
      return message.generation === model.generation
        ? { ...model, hydrated: true }
        : model;
    case "APPLY_ENVELOPE":
      return applyEnvelope(model, message.envelope);
    case "UPSERT_DESCRIPTOR":
      if (message.descriptor.ref.projectId !== model.currentProjectId)
        return model;
      return {
        ...model,
        sessions: {
          ...model.sessions,
          [message.descriptor.ref.sessionId]: message.descriptor,
        },
      };
    case "REMOVE_DESCRIPTORS":
      return removeDescriptors(model, message.refs);
    case "INITIALIZE_ENTRY_CACHES":
      return initializeEntryCaches(model, message.ref);
    case "ENTRY_LOAD_STARTED":
      return {
        ...model,
        caches: { ...model.caches, [message.key]: message.cache },
      };
    case "ENTRY_LOAD_SUCCEEDED":
      return finishEntryLoad(model, message);
    case "ENTRY_LOAD_FAILED": {
      const cache = model.caches[message.key];
      if (cache?.requestId !== message.requestId) return model;
      return {
        ...model,
        caches: {
          ...model.caches,
          [message.key]: { ...cache, loading: false, error: message.error },
        },
      };
    }
    case "ACTION_STARTED":
      if (model.actionLoading[message.sessionId] !== undefined) return model;
      return {
        ...model,
        actionLoading: {
          ...model.actionLoading,
          [message.sessionId]: message.action,
        },
      };
    case "ACTION_FINISHED": {
      if (
        message.generation !== model.generation ||
        model.actionLoading[message.sessionId] !== message.action
      ) {
        return model;
      }
      const actionLoading = { ...model.actionLoading };
      delete actionLoading[message.sessionId];
      return { ...model, actionLoading };
    }
  }
}
