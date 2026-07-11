import { describe, expect, it, vi } from "vitest";

import { InvalidCursorError } from "../sessions/session-store";
import type { BackendSDK } from "../types/types";

import { deleteSessions, getSessionEntries, listSessions } from "./sessions";

const getEntries = vi.fn();
const listStoredSessions = vi.fn();

vi.mock("../engine/session-manager", () => ({
  tombstoneRunningSessions: vi.fn(),
}));

vi.mock("../sessions/session-store", () => ({
  InvalidCursorError: class InvalidCursorError extends Error {},
  getSessionStore: () => ({
    getEntries,
    listSessions: listStoredSessions,
  }),
}));

const sdk = {} as BackendSDK;

describe("session API validation", () => {
  it("lists sessions for the explicitly requested project", async () => {
    listStoredSessions.mockResolvedValueOnce({
      version: 2,
      projectId: "project-a",
      revision: 0,
      sessions: [],
    });

    const result = await listSessions(sdk, "project-a");

    expect(result.success).toBe(true);
    expect(listStoredSessions).toHaveBeenCalledWith("project-a");
  });

  it("rejects an invalid project ID", async () => {
    const result = await listSessions(sdk, "");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("VALIDATION");
  });

  it("rejects page sizes over the transport maximum", async () => {
    const result = await getSessionEntries(sdk, {
      ref: { projectId: "project", sessionId: "session" },
      kind: "request",
      limit: 1_001,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("VALIDATION");
  });

  it("classifies an invalid cursor from the store as a validation error", async () => {
    getEntries.mockRejectedValueOnce(new InvalidCursorError("bad cursor"));
    const result = await getSessionEntries(sdk, {
      ref: { projectId: "project", sessionId: "session" },
      kind: "request",
      cursor: "broken",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toBe("bad cursor");
    }
  });

  it("rejects invalid deletion references", async () => {
    const result = await deleteSessions(sdk, [
      { projectId: "", sessionId: "session" },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("VALIDATION");
  });
});
