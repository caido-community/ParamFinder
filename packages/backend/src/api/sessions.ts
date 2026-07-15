import {
  type ApiResult,
  type CursorPage,
  error,
  ok,
  projectIdSchema,
  type ProjectSessionSnapshot,
  type SessionEntriesQuery,
  sessionEntriesQuerySchema,
  type SessionEntry,
  type SessionRef,
  sessionRefsSchema,
} from "shared";

import type { MiningService } from "../services/mining";
import { InvalidCursorError, type SessionsService } from "../services/sessions";
import type { BackendSDK } from "../types";

export function createSessionHandlers(
  sessions: SessionsService,
  mining: MiningService,
) {
  const listSessions = async (
    _sdk: BackendSDK,
    projectId: string,
  ): Promise<ApiResult<ProjectSessionSnapshot>> => {
    const input = projectIdSchema.safeParse(projectId);
    if (!input.success) return error("Invalid project ID.", "VALIDATION");
    return ok(await sessions.listSessions(input.data));
  };

  const getSessionEntries = async (
    _sdk: BackendSDK,
    query: SessionEntriesQuery,
  ): Promise<ApiResult<CursorPage<SessionEntry>>> => {
    const parsed = sessionEntriesQuerySchema.safeParse(query);
    if (!parsed.success) {
      return error("Invalid session entry query.", "VALIDATION", {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }

    try {
      const page = await sessions.getEntries(parsed.data);
      return page === undefined
        ? error("Session not found.", "NOT_FOUND")
        : ok(page);
    } catch (cause) {
      if (cause instanceof InvalidCursorError) {
        return error(cause.message, "VALIDATION");
      }
      throw cause;
    }
  };

  const deleteSessions = async (
    sdk: BackendSDK,
    refs: SessionRef[],
  ): Promise<ApiResult<void>> => {
    const input = sessionRefsSchema.safeParse(refs);
    if (!input.success) {
      return error("Invalid session deletion request.", "VALIDATION");
    }
    await mining.deleteSessions(input.data);
    return ok(undefined);
  };

  const getCurrentProjectId = async (
    sdk: BackendSDK,
  ): Promise<ApiResult<string | undefined>> => {
    const project = await sdk.projects.getCurrent();
    return ok(project?.getId());
  };

  return {
    deleteSessions,
    getCurrentProjectId,
    getSessionEntries,
    listSessions,
  };
}
