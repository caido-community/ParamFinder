import {
  type ApiResult,
  error,
  type ParamMinerConfig,
  paramMinerConfigSchema,
  type Request,
  requestSchema,
  type SessionDescriptor,
  type SessionRef,
  sessionRefSchema,
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
  const targetResult = requestSchema.safeParse(target);
  const configResult = paramMinerConfigSchema.safeParse(config);
  if (!targetResult.success || !configResult.success) {
    return error("Invalid scan target or configuration.", "VALIDATION", {
      target: targetResult.success
        ? []
        : targetResult.error.issues.map((issue) => issue.message),
      config: configResult.success
        ? []
        : configResult.error.issues.map((issue) => issue.message),
    });
  }
  return startEngineSession(
    sdk,
    project.getId(),
    targetResult.data,
    configResult.data,
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
