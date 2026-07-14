import {
  MiningSessionPhase,
  MiningSessionState,
  type SessionDescriptor,
} from "shared";
import { describe, expect, it } from "vitest";

import {
  getProgressLabel,
  getSessionCapabilities,
  getSessionStateMeta,
  getSessionStateTitle,
  getSessionStats,
} from "./sessionStats";

function createSession(
  overrides: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    ref: { projectId: "project-1", sessionId: "session-1" },
    state: MiningSessionState.Running,
    phase: MiningSessionPhase.Discovery,
    totalParametersAmount: 10,
    totalLearnRequests: 3,
    parametersSent: 0,
    requestsSent: 0,
    findingsCount: 0,
    logsCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("session stats", () => {
  it("counts discovery parameters and clamps progress", () => {
    const session = createSession({
      requestsSent: 2,
      parametersSent: 14,
    });

    expect(getSessionStats(session)).toMatchObject({
      requestsSent: 2,
      parametersTested: 14,
      remaining: 0,
      progressCurrent: 10,
      progressTotal: 10,
      progress: 100,
    });
  });

  it("uses learn request count while learning", () => {
    const session = createSession({
      phase: MiningSessionPhase.Learning,
      requestsSent: 1,
    });
    const stats = getSessionStats(session);

    expect(stats).toMatchObject({ progressCurrent: 1, progressTotal: 3 });
    expect(getProgressLabel(session, stats)).toBe("1 / 3 learn requests");
  });

  it("maps states and capabilities", () => {
    expect(getSessionStateMeta(MiningSessionState.Paused)).toEqual({
      label: "Paused",
      tone: "neutral",
    });
    expect(getSessionStateMeta(MiningSessionState.Timeout)).toEqual({
      label: "Timeout",
      tone: "danger",
    });
    expect(getSessionCapabilities(createSession()).canCancel).toBe(true);
    expect(
      getSessionCapabilities(
        createSession({ state: MiningSessionState.Completed }),
      ).canCancel,
    ).toBe(false);
  });

  it("describes persisted session errors for status popovers", () => {
    const session = createSession({
      state: MiningSessionState.Error,
      error: { code: "IO", message: "Connection reset" },
    });

    expect(getSessionStateMeta(session.state)).toEqual({
      label: "Errored",
      tone: "danger",
    });
    expect(getSessionStateTitle(session)).toBe("Errored: Connection reset");
  });
});
