import {
  type EnginePhase,
  type EngineState,
  type RunControl,
} from "@paramfinder/engine";
import type { ApiError, SessionRef, TerminalSessionLifecycle } from "shared";

export type TerminalPersistence =
  | { kind: "pending" }
  | { kind: "claimed" }
  | { kind: "persisting"; completion: Promise<void> }
  | {
      kind: "failed";
      lifecycle: TerminalSessionLifecycle;
    };

export type PauseOwnership =
  | { kind: "none" }
  | { kind: "project" }
  | { kind: "external" };

export interface RunningSession {
  ref: SessionRef;
  controller: AbortController;
  runControl: RunControl;
  state: EngineState;
  phase: EnginePhase;
  eventChain: Promise<void>;
  acceptingEvents: boolean;
  pauseOwnership: PauseOwnership;
  terminalPersistence: TerminalPersistence;
  eventError?: ApiError;
}

export function setPauseOwner(
  session: RunningSession,
  kind: PauseOwnership["kind"],
): PauseOwnership {
  const ownership = { kind };
  session.pauseOwnership = ownership;
  return ownership;
}

export class RunningSessionsStore {
  private readonly sessions = new Map<string, RunningSession>();

  get(ref: SessionRef): RunningSession | undefined {
    return this.sessions.get(key(ref));
  }

  set(session: RunningSession): void {
    this.sessions.set(key(session.ref), session);
  }

  values(): RunningSession[] {
    return [...this.sessions.values()];
  }

  isCurrent(session: RunningSession): boolean {
    return this.get(session.ref) === session;
  }

  delete(session: RunningSession): void {
    if (this.isCurrent(session)) this.sessions.delete(key(session.ref));
  }

  tombstone(refs: SessionRef[]): void {
    for (const ref of refs) {
      const session = this.get(ref);
      if (session === undefined) continue;

      session.acceptingEvents = false;
      session.controller.abort();
      this.sessions.delete(key(ref));
    }
  }
}

function key(ref: SessionRef): string {
  return `${ref.projectId}\u0000${ref.sessionId}`;
}
