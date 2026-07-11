import {
  type ApiResult,
  type CursorPage,
  error,
  ok,
  type ProjectSessionSnapshot,
  type SessionEntriesQuery,
  sessionEntriesQuerySchema,
  type SessionEntry,
  type SessionRef,
  sessionRefSchema,
} from "shared";

import { tombstoneRunningSessions } from "../engine/session-manager";
import { emitSessionChanges } from "../sessions/session-events";
import { getSessionStore, InvalidCursorError } from "../sessions/session-store";
import type { BackendSDK } from "../types/types";
import { getErrorMessage } from "../util/errors";

export async function listSessions(
  _sdk: BackendSDK,
  projectId: string,
): Promise<ApiResult<ProjectSessionSnapshot>> {
  if (typeof projectId !== "string" || projectId.length === 0) {
    return error("Invalid project ID.", "VALIDATION");
  }
  try {
    return ok(await getSessionStore().listSessions(projectId));
  } catch (cause) {
    return error(getErrorMessage(cause), "IO");
  }
}

export async function getSessionEntries(
  sdk: BackendSDK,
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
    return error(getErrorMessage(cause), "IO");
  }
}

export async function deleteSessions(
  sdk: BackendSDK,
  refs: SessionRef[],
): Promise<ApiResult<void>> {
  if (!Array.isArray(refs) || refs.length > 10_000) {
    return error("Invalid session deletion request.", "VALIDATION");
  }
  const parsedRefs = refs.map((ref) => sessionRefSchema.safeParse(ref));
  if (parsedRefs.some((result) => !result.success)) {
    return error("Invalid session reference.", "VALIDATION");
  }
  const validRefs = parsedRefs.flatMap((result) =>
    result.success ? [result.data] : [],
  );
  try {
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
  } catch (cause) {
    return error(getErrorMessage(cause), "IO");
  }
}

export async function getCurrentProjectId(
  _: BackendSDK,
): Promise<ApiResult<string | undefined>> {
  try {
    return ok(await getSessionStore().getCurrentProjectId());
  } catch (cause) {
    return error(getErrorMessage(cause), "INTERNAL");
  }
}
