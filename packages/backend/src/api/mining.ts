import {
  type ApiResult,
  error,
  type ParamMinerConfig,
  type Request,
  type SessionDescriptor,
  type SessionRef,
  sessionRefSchema,
  startMiningInputSchema,
} from "shared";

import {
  cancelEngineSession,
  pauseEngineSession,
  resumeEngineSession,
  startEngineSession,
} from "../engine/session-manager";
import type { BackendSDK } from "../types/types";

export async function startMining(
  sdk: BackendSDK,
  target: Request,
  config: ParamMinerConfig,
): Promise<ApiResult<SessionDescriptor>> {
  const project = await sdk.projects.getCurrent();
  if (project === undefined) {
    return error(
      "No project selected. Select a project before running ParamFinder.",
      "NO_PROJECT",
    );
  }

  const input = startMiningInputSchema.safeParse({ target, config });
  if (!input.success) {
    return error("Invalid scan target or configuration.", "VALIDATION", {
      issues: input.error.issues.map((issue) => issue.message),
    });
  }

  return startEngineSession(
    sdk,
    project.getId(),
    input.data.target,
    input.data.config,
  );
}

// Thrown errors are caught and reported by the `afterReady` wrapper in index.ts,
// so these handlers only need to validate the ref and forward to the engine.
function withSessionRef(
  handler: (sdk: BackendSDK, ref: SessionRef) => Promise<ApiResult<void>>,
): (sdk: BackendSDK, ref: SessionRef) => Promise<ApiResult<void>> {
  return async (sdk, ref) => {
    const parsed = sessionRefSchema.safeParse(ref);
    if (!parsed.success) {
      return error("Invalid session reference.", "VALIDATION");
    }

    return handler(sdk, parsed.data);
  };
}

export const cancelSession = withSessionRef(cancelEngineSession);
export const pauseSession = withSessionRef(pauseEngineSession);
export const resumeSession = withSessionRef(resumeEngineSession);
