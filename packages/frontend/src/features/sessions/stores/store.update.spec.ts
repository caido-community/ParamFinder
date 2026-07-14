import {
  MiningSessionPhase,
  MiningSessionState,
  type SessionDescriptor,
} from "shared";
import { describe, expect, it } from "vitest";

import { createEntryCache } from "./sessionEntryCache";
import { cacheKey, initialModel } from "./store.model";
import { update } from "./store.update";

const descriptor = (sessionId: string): SessionDescriptor => ({
  ref: { projectId: "project", sessionId },
  state: MiningSessionState.Pending,
  phase: MiningSessionPhase.Idle,
  totalParametersAmount: 0,
  totalLearnRequests: 0,
  parametersSent: 0,
  requestsSent: 0,
  findingsCount: 0,
  logsCount: 0,
  createdAt: 1,
  updatedAt: 1,
});

describe("sessions update", () => {
  it("resets project state and applies only its matching hydration", () => {
    const loading = update(
      {
        ...initialModel,
        currentProjectId: "old",
        sessions: { old: descriptor("old") },
        revision: 4,
      },
      { type: "PROJECT_LOAD_STARTED", projectId: "project" },
    );
    expect(loading).toMatchObject({
      currentProjectId: "project",
      generation: 1,
      hydrated: false,
      sessions: {},
      revision: 0,
    });

    const hydrated = update(loading, {
      type: "PROJECT_LOAD_SUCCESS",
      generation: 1,
      snapshot: {
        version: 2,
        projectId: "project",
        revision: 7,
        sessions: [descriptor("hydrated")],
      },
    });
    expect(hydrated).toMatchObject({
      hydrated: true,
      revision: 7,
    });

    expect(
      update(hydrated, { type: "PROJECT_LOAD_FINISHED", generation: 0 }),
    ).toBe(hydrated);
  });

  it("clears transient work when reloading the same project", () => {
    const loading = update(
      {
        ...initialModel,
        currentProjectId: "project",
        sessions: { active: descriptor("active") },
        actionLoading: { active: "pause" },
      },
      { type: "PROJECT_LOAD_STARTED", projectId: "project" },
    );

    expect(loading.sessions).toHaveProperty("active");
    expect(loading.actionLoading).toEqual({});
  });

  it("drops entry caches when applying an authoritative snapshot", () => {
    const session = descriptor("active");
    const key = cacheKey(session.ref, "log");
    const model = {
      ...initialModel,
      currentProjectId: "project",
      generation: 1,
      sessions: { active: session },
      caches: {
        [key]: {
          ...createEntryCache({ field: "sequence", direction: "asc" }),
          loading: true,
          stale: false,
        },
      },
    };

    const hydrated = update(model, {
      type: "PROJECT_LOAD_SUCCESS",
      generation: 1,
      snapshot: {
        version: 2,
        projectId: "project",
        revision: 2,
        sessions: [session],
      },
    });

    expect(hydrated.caches).toEqual({});
  });

  it("applies only the next project revision", () => {
    const model = {
      ...initialModel,
      currentProjectId: "project",
      hydrated: true,
      revision: 1,
    };
    const gap = update(model, {
      type: "APPLY_ENVELOPE",
      envelope: {
        version: 1,
        projectId: "project",
        revision: 3,
        changes: [{ type: "upsert", session: descriptor("gap") }],
      },
    });
    expect(gap).toBe(model);

    const next = update(model, {
      type: "APPLY_ENVELOPE",
      envelope: {
        version: 1,
        projectId: "project",
        revision: 2,
        changes: [{ type: "upsert", session: descriptor("next") }],
      },
    });
    expect(next.revision).toBe(2);
    expect(next.sessions).toHaveProperty("next");
  });

  it("removes descriptors and their cached entries", () => {
    const session = descriptor("active");
    const initialized = update(
      {
        ...initialModel,
        currentProjectId: "project",
        sessions: { active: session },
      },
      { type: "INITIALIZE_ENTRY_CACHES", ref: session.ref },
    );

    const next = update(initialized, {
      type: "REMOVE_DESCRIPTORS",
      refs: [session.ref],
    });
    expect(next.sessions).toEqual({});
    expect(next.caches).toEqual({});
  });

  it("transitions entry loading, success, and failure by request ID", () => {
    const session = descriptor("active");
    const key = cacheKey(session.ref, "log");
    const cache = {
      ...createEntryCache({ field: "sequence", direction: "asc" }),
      loading: true,
      requestId: 2,
    };
    const loading = update(
      { ...initialModel, sessions: { active: session } },
      { type: "ENTRY_LOAD_STARTED", key, cache },
    );
    const stale = update(loading, {
      type: "ENTRY_LOAD_FAILED",
      key,
      requestId: 1,
      error: "stale",
    });
    expect(stale).toBe(loading);

    const loaded = update(loading, {
      type: "ENTRY_LOAD_SUCCEEDED",
      key,
      requestId: 2,
      replace: true,
      page: {
        items: [{ sequence: 1, kind: "log", value: "loaded" }],
        total: 1,
        snapshotMaxSequence: 1,
      },
    });
    expect(loaded.caches[key]?.entries).toHaveLength(1);
    expect(loaded.caches[key]?.loading).toBe(false);

    const failed = update(
      {
        ...loaded,
        caches: { ...loaded.caches, [key]: { ...cache, requestId: 3 } },
      },
      { type: "ENTRY_LOAD_FAILED", key, requestId: 3, error: "failed" },
    );
    expect(failed.caches[key]).toMatchObject({
      loading: false,
      error: "failed",
    });
  });

  it("initializes all entry caches without replacing existing state", () => {
    const session = descriptor("active");
    const initialized = update(initialModel, {
      type: "INITIALIZE_ENTRY_CACHES",
      ref: session.ref,
    });
    const repeated = update(initialized, {
      type: "INITIALIZE_ENTRY_CACHES",
      ref: session.ref,
    });

    expect(Object.keys(initialized.caches)).toHaveLength(3);
    expect(repeated.caches).toEqual(initialized.caches);
  });

  it("locks one action per session until the matching completion", () => {
    const started = update(initialModel, {
      type: "ACTION_STARTED",
      sessionId: "session",
      action: "pause",
    });
    const duplicate = update(started, {
      type: "ACTION_STARTED",
      sessionId: "session",
      action: "delete",
    });
    expect(duplicate).toBe(started);

    const stale = update(started, {
      type: "ACTION_FINISHED",
      sessionId: "session",
      action: "pause",
      generation: 1,
    });
    expect(stale).toBe(started);

    const finished = update(started, {
      type: "ACTION_FINISHED",
      sessionId: "session",
      action: "pause",
      generation: 0,
    });
    expect(finished.actionLoading).toEqual({});
  });
});
