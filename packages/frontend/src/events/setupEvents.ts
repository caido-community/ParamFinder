import type { SessionChangeEnvelope } from "shared";

import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import type { FrontendSDK } from "@/types";

export function setupEvents(
  sdk: FrontendSDK,
  onSessionChange?: (envelope: SessionChangeEnvelope) => void,
): void {
  const sessions = useSessionsStore();

  // Register this before the initial snapshot request. The store buffers project
  // revisions until hydration finishes, preventing events from falling into the gap.
  sdk.backend.onEvent("paramfinder:session_change", (envelope) => {
    sessions.acceptEnvelope(envelope);
    onSessionChange?.(envelope);
  });
}
