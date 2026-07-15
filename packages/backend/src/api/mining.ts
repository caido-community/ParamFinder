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

import type { MiningService } from "../services/mining";
import type { BackendSDK } from "../types";

export function createMiningHandlers(mining: MiningService) {
  const startMining = async (
    sdk: BackendSDK,
    target: Request,
    config: ParamMinerConfig,
  ): Promise<ApiResult<SessionDescriptor>> => {
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

    return mining.start(project.getId(), input.data.target, input.data.config);
  };

  const runSessionAction = async (
    ref: SessionRef,
    action: (ref: SessionRef) => Promise<ApiResult<void>>,
  ): Promise<ApiResult<void>> => {
    const parsed = sessionRefSchema.safeParse(ref);
    if (!parsed.success) {
      return error("Invalid session reference.", "VALIDATION");
    }

    return action(parsed.data);
  };

  const cancelSession = (_sdk: BackendSDK, ref: SessionRef) =>
    runSessionAction(ref, (validRef) => mining.cancel(validRef));

  const pauseSession = (_sdk: BackendSDK, ref: SessionRef) =>
    runSessionAction(ref, (validRef) => mining.pause(validRef));

  const resumeSession = (_sdk: BackendSDK, ref: SessionRef) =>
    runSessionAction(ref, (validRef) => mining.resume(validRef));

  return { cancelSession, pauseSession, resumeSession, startMining };
}
