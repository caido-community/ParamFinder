import { describe, expect, it, vi } from "vitest";

import type { MiningService } from "../services/mining";
import { InvalidCursorError, type SessionsService } from "../services/sessions";
import type { BackendSDK } from "../types";

import { createSessionHandlers } from "./sessions";

const getEntries = vi.fn();
const listStoredSessions = vi.fn();
const deleteStoredSessions = vi.fn();
const sessions = {
  getEntries,
  listSessions: listStoredSessions,
} as unknown as SessionsService;
const mining = {
  deleteSessions: deleteStoredSessions,
} as unknown as MiningService;
const handlers = createSessionHandlers(sessions, mining);
const sdk = {} as BackendSDK;

describe("session API validation", () => {
  it("lists sessions for the explicitly requested project", async () => {
    listStoredSessions.mockResolvedValueOnce({
      projectId: "project-a",
      revision: 0,
      sessions: [],
    });

    const result = await handlers.listSessions(sdk, "project-a");

    expect(result.success).toBe(true);
    expect(listStoredSessions).toHaveBeenCalledWith("project-a");
  });

  it("rejects an invalid project ID", async () => {
    const result = await handlers.listSessions(sdk, "");
    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
  });

  it("rejects page sizes over the transport maximum", async () => {
    const result = await handlers.getSessionEntries(sdk, {
      ref: { projectId: "project", sessionId: "session" },
      kind: "request",
      limit: 1_001,
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
  });

  it("classifies an invalid cursor as a validation error", async () => {
    getEntries.mockRejectedValueOnce(new InvalidCursorError("bad cursor"));
    const result = await handlers.getSessionEntries(sdk, {
      ref: { projectId: "project", sessionId: "session" },
      kind: "request",
      cursor: "broken",
    });
    expect(result).toEqual({
      success: false,
      error: {
        code: "VALIDATION",
        details: undefined,
        message: "bad cursor",
      },
    });
  });

  it("rejects invalid deletion references", async () => {
    const result = await handlers.deleteSessions(sdk, [
      { projectId: "", sessionId: "session" },
    ]);
    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
    expect(deleteStoredSessions).not.toHaveBeenCalled();
  });
});
