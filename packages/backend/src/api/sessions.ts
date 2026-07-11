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

import { tombstoneRunningSessions } from "../engine/session-manager";
import { emitSessionChanges } from "../sessions/session-events";
import { getSessionStore, InvalidCursorError } from "../sessions/session-store";
import type { BackendSDK } from "../types/types";

export async function listSessions(
  _sdk: BackendSDK,
  projectId: string,
): Promise<ApiResult<ProjectSessionSnapshot>> {
  const input = projectIdSchema.safeParse(projectId);
  if (!input.success) {
    return error("Invalid project ID.", "VALIDATION");
  }

  return ok(await getSessionStore().listSessions(input.data));
}

export async function getSessionEntries(
  _sdk: BackendSDK,
  query: SessionEntriesQuery,
): Promise<ApiResult<CursorPage<SessionEntry>>> {
  const parsed = sessionEntriesQuerySchema.safeParse(query);
  if (!parsed.success) {
    return error("Invalid session entry query.", "VALIDATION", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  try {
    const page = await getSessionStore().getEntries(parsed.data);
    return page === undefined
      ? error("Session not found.", "NOT_FOUND")
      : ok(page);
  } catch (cause) {
    if (cause instanceof InvalidCursorError) {
      return error(cause.message, "VALIDATION");
    }
    throw cause;
  }
}

export async function deleteSessions(
  sdk: BackendSDK,
  refs: SessionRef[],
): Promise<ApiResult<void>> {
  const input = sessionRefsSchema.safeParse(refs);
  if (!input.success) {
    return error("Invalid session deletion request.", "VALIDATION");
  }

  const validRefs = input.data;

  const revisions = await getSessionStore().deleteSessions(validRefs);
  tombstoneRunningSessions(validRefs);

  for (const [projectId, revision] of revisions) {
    emitSessionChanges(sdk, projectId, revision, [
      {
        type: "delete",
        refs: validRefs.filter((ref) => ref.projectId === projectId),
      },
    ]);
  }

  return ok(undefined);
}

export async function getCurrentProjectId(
  _: BackendSDK,
): Promise<ApiResult<string | undefined>> {
  return ok(await getSessionStore().getCurrentProjectId());
}
