import type { SessionChange, SessionChangeEnvelope } from "shared";

import type { BackendSDK } from "../types/types";

export function emitSessionChanges(
  sdk: BackendSDK,
  projectId: string,
  revision: number,
  changes: SessionChange[],
): void {
  const envelope: SessionChangeEnvelope = {
    version: 1,
    projectId,
    revision,
    changes,
  };
  sdk.api.send("paramfinder:session_change", envelope);
}
