import {
  type ApiResult,
  error,
  type ParamMinerConfig,
  type Request,
  type SessionEntriesQuery,
  type SessionRef,
} from "shared";

import { toErrorMessage } from "@/shared/utils/backend";
import type { FrontendSDK } from "@/types";

export async function readCurrentProject(sdk: FrontendSDK) {
  try {
    return await sdk.backend.getCurrentProjectId();
  } catch (cause: unknown) {
    return error(toErrorMessage(cause));
  }
}

export async function readSessionSnapshot(sdk: FrontendSDK, projectId: string) {
  try {
    return await sdk.backend.listSessions(projectId);
  } catch (cause: unknown) {
    return error(toErrorMessage(cause));
  }
}

async function call<T>(request: () => Promise<ApiResult<T>>) {
  try {
    return await request();
  } catch (cause: unknown) {
    return error(toErrorMessage(cause));
  }
}

export const readSessionEntries = (
  sdk: FrontendSDK,
  query: SessionEntriesQuery,
) => call(() => sdk.backend.getSessionEntries(query));

export const pauseSession = (sdk: FrontendSDK, ref: SessionRef) =>
  call(() => sdk.backend.pauseSession(ref));

export const resumeSession = (sdk: FrontendSDK, ref: SessionRef) =>
  call(() => sdk.backend.resumeSession(ref));

export const cancelSession = (sdk: FrontendSDK, ref: SessionRef) =>
  call(() => sdk.backend.cancelSession(ref));

export const startMining = (
  sdk: FrontendSDK,
  request: Request,
  config: ParamMinerConfig,
) => call(() => sdk.backend.startMining(request, config));

export const deleteSessions = (sdk: FrontendSDK, refs: SessionRef[]) =>
  call(() => sdk.backend.deleteSessions(refs));
