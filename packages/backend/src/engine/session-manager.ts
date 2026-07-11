import {
  type DiscoveryEvent,
  EnginePhase,
  EngineState,
  type Finding,
  RunControl,
  runDiscoveryScan,
} from "@paramfinder/engine";
import {
  type ApiError,
  type ApiResult,
  error,
  ok,
  type ParamMinerConfig,
  type Request,
  type SentRequest,
  type SessionDescriptor,
  type SessionEntryInput,
  type SessionFinding,
  type SessionRef,
} from "shared";

import { emitSessionChanges } from "../sessions/session-events";
import { getSessionStore } from "../sessions/session-store";
import type { BackendSDK } from "../types/types";
import { getErrorMessage } from "../util/errors";
import { readWordlist } from "../util/helper";
import { getWordlistManager } from "../wordlists/wordlists";

import { CaidoRequestProvider } from "./caido-provider";
import { toEngineConfig, toRunOptions } from "./engine-mapping";

interface RunningSession {
  ref: SessionRef;
  controller: AbortController;
  runControl: RunControl;
  state: EngineState;
  phase: EnginePhase;
  stateBeforePause?: EngineState;
  eventChain: Promise<void>;
  acceptingEvents: boolean;
  finalizing: boolean;
  eventError?: ApiError;
}

const runningSessions = new Map<string, RunningSession>();
const sessionKey = (ref: SessionRef) =>
  `${ref.projectId}\u0000${ref.sessionId}`;
const terminalStates = new Set<string>([
  EngineState.Completed,
  EngineState.Error,
  EngineState.Canceled,
  EngineState.Timeout,
]);

export async function startEngineSession(
  sdk: BackendSDK,
  projectId: string,
  target: Request,
  config: ParamMinerConfig,
): Promise<ApiResult<SessionDescriptor>> {
  try {
    const words = await loadWords(config);
    if (words.length === 0) {
      return error(
        "No enabled wordlists found. Please upload a wordlist first.",
        "VALIDATION",
      );
    }

    const created = await getSessionStore().createNextSession(
      projectId,
      words.length,
      config.learnRequestsCount,
      { targetRequest: target, config },
    );
    const ref = created.session.ref;
    const controller = new AbortController();
    const runControl = new RunControl();
    const provider = new CaidoRequestProvider(sdk);
    const running: RunningSession = {
      ref,
      controller,
      runControl,
      state: EngineState.Pending,
      phase: EnginePhase.Idle,
      eventChain: Promise.resolve(),
      acceptingEvents: true,
      finalizing: false,
    };
    runningSessions.set(sessionKey(ref), running);
    emitSessionChanges(sdk, projectId, created.revision, [
      { type: "upsert", session: created.session },
    ]);
    // Finish the only startup file write before the first transport future is
    // spawned. The engine's duplicate Learning event becomes a no-op.
    const started = await persistState(
      sdk,
      ref,
      EngineState.Learning,
      EnginePhase.Learning,
      running,
    ).catch((cause: unknown) => {
      running.acceptingEvents = false;
      controller.abort();
      deleteRunningSession(ref, running);
      throw cause;
    });
    if (started === undefined) {
      deleteRunningSession(ref, running);
      return error("Session disappeared during startup.", "NOT_FOUND");
    }

    const scanPromise = runDiscoveryScan(
      {
        provider,
      },
      {
        request: target,
        words,
        engineConfig: toEngineConfig(config),
        runOptions: toRunOptions(config, {
          signal: controller.signal,
          runControl,
          onEvent: (event) => {
            const current = runningSessions.get(sessionKey(ref));
            if (current === running && running.acceptingEvents) {
              enqueueEvent(running, async () => {
                await persistDiscoveryEvent(sdk, ref, config, event, running);
              });
            }
          },
        }),
      },
    );

    scanPromise
      .then(
        async ({ summary }) => {
          const current = runningSessions.get(sessionKey(ref));
          if (current !== running || !beginFinalization(running)) return;
          await finalizeRunningSession(
            sdk,
            ref,
            running,
            summary.state,
            summary.phase,
            summary.state === EngineState.Error
              ? { code: "INTERNAL", message: summary.failureReason }
              : undefined,
          );
        },
        async (cause: unknown) => {
          const current = runningSessions.get(sessionKey(ref));
          if (current !== running || !beginFinalization(running)) return;
          await finalizeRunningSession(
            sdk,
            ref,
            running,
            EngineState.Error,
            running.phase,
            {
              code: "INTERNAL",
              message: running.eventError?.message ?? getErrorMessage(cause),
            },
          );
        },
      )
      .catch((cause: unknown) => {
        sdk.console.error(
          `[SESSIONS] Could not finalize ${ref.sessionId}: ${getErrorMessage(cause)}`,
        );
      });

    return ok(started);
  } catch (cause) {
    sdk.console.error(cause);
    return error(getErrorMessage(cause));
  }
}

export async function cancelEngineSession(
  sdk: BackendSDK,
  ref: SessionRef,
): Promise<ApiResult<void>> {
  const session = runningSessions.get(sessionKey(ref));
  if (session === undefined) {
    const stored = await getSessionStore().getSession(ref);
    return stored !== undefined && terminalStates.has(stored.state)
      ? ok(undefined)
      : error("Session is no longer running.", "NOT_FOUND");
  }
  if (!beginFinalization(session)) return ok(undefined);
  session.controller.abort();
  await finalizeRunningSession(
    sdk,
    ref,
    session,
    EngineState.Canceled,
    session.phase,
    session.eventError,
  );
  return session.eventError
    ? error(session.eventError.message, "IO")
    : ok(undefined);
}

export async function pauseEngineSession(
  sdk: BackendSDK,
  ref: SessionRef,
): Promise<ApiResult<void>> {
  const session = runningSessions.get(sessionKey(ref));
  if (session === undefined)
    return error("Session is no longer running.", "NOT_FOUND");
  if (session.state === EngineState.Paused) return ok(undefined);
  if (
    session.state !== EngineState.Pending &&
    session.state !== EngineState.Learning &&
    session.state !== EngineState.Running
  ) {
    return error(`Cannot pause a ${session.state} session.`, "CONFLICT");
  }
  session.runControl.pause();
  session.stateBeforePause = session.state;
  try {
    await drainEvents(session);
    if (session.finalizing) return ok(undefined);
    if (session.eventError) {
      rollbackPause(session);
      return error(session.eventError.message, "IO");
    }
    await persistState(sdk, ref, EngineState.Paused, session.phase, session);
    return ok(undefined);
  } catch (cause) {
    rollbackPause(session);
    return error(
      `Could not persist paused state: ${getErrorMessage(cause)}`,
      "IO",
    );
  }
}

export async function resumeEngineSession(
  sdk: BackendSDK,
  ref: SessionRef,
): Promise<ApiResult<void>> {
  const session = runningSessions.get(sessionKey(ref));
  if (session === undefined)
    return error("Session is no longer running.", "NOT_FOUND");
  if (session.state !== EngineState.Paused) {
    return error(`Cannot resume a ${session.state} session.`, "CONFLICT");
  }
  const resumedState =
    session.stateBeforePause ?? getActiveStateForPhase(session.phase);
  await drainEvents(session);
  if (session.finalizing) return ok(undefined);
  if (session.eventError) return error(session.eventError.message, "IO");
  await persistState(sdk, ref, resumedState, session.phase, session);
  session.runControl.resume();
  return ok(undefined);
}

export function tombstoneRunningSessions(refs: SessionRef[]): void {
  for (const ref of refs) {
    const running = runningSessions.get(sessionKey(ref));
    if (running !== undefined) running.acceptingEvents = false;
    running?.controller.abort();
    runningSessions.delete(sessionKey(ref));
  }
}

async function loadWords(config: ParamMinerConfig): Promise<string[]> {
  const paths = await getWordlistManager().getEnabledPaths(config.attackType);
  const words = await Promise.all(
    paths.map((wordlistPath) => readWordlist(wordlistPath)),
  );
  return [...new Set(words.flat())];
}

async function persistDiscoveryEvent(
  sdk: BackendSDK,
  ref: SessionRef,
  config: ParamMinerConfig,
  event: DiscoveryEvent,
  running: RunningSession,
): Promise<void> {
  if (!isCurrentSession(ref, running) || terminalStates.has(running.state))
    return;
  switch (event.type) {
    case "state":
    case "completed":
      if (!terminalStates.has(event.state)) {
        await persistState(sdk, ref, event.state, event.phase, running);
      }
      return;
    case "log":
      if (event.level !== "debug" || config.debug) {
        await queueEntry(
          sdk,
          ref,
          { kind: "log", value: event.message },
          running,
        );
      }
      return;
    case "request": {
      const sent = toSentRequest(event);
      await queueEntry(sdk, ref, { kind: "request", value: sent }, running);
      return;
    }
    case "finding":
      await queueEntry(
        sdk,
        ref,
        {
          kind: "finding",
          value: toSessionFinding(event.finding),
        },
        running,
      );
      return;
    case "adjustTotalParameters": {
      const updated = await getSessionStore().updateSession(ref, {
        totalParametersAmount: event.totalParametersAmount,
      });
      if (updated && isCurrentSession(ref, running))
        emitSessionChanges(sdk, ref.projectId, updated.revision, [
          { type: "upsert", session: updated.session },
        ]);
      return;
    }
    case "learnedProfile":
      return;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

async function queueEntry(
  sdk: BackendSDK,
  ref: SessionRef,
  entry: SessionEntryInput,
  running: RunningSession,
): Promise<void> {
  if (!isCurrentSession(ref, running) || terminalStates.has(running.state))
    return;
  const persisted = await getSessionStore().appendEntries(ref, [entry]);
  if (persisted === undefined || !isCurrentSession(ref, running)) return;
  emitSessionChanges(sdk, ref.projectId, persisted.revision, [
    {
      type: "entries",
      ref,
      entries: persisted.entries,
      session: persisted.session,
    },
  ]);
}

async function persistState(
  sdk: BackendSDK,
  ref: SessionRef,
  state: EngineState,
  phase: EnginePhase,
  running: RunningSession,
): Promise<SessionDescriptor | undefined> {
  if (!isCurrentSession(ref, running) || terminalStates.has(running.state))
    return;
  if (running.state === state && running.phase === phase) return;
  const updated = await getSessionStore().updateSession(ref, { state, phase });
  if (updated && isCurrentSession(ref, running)) {
    running.state = state;
    running.phase = phase;
    if (state !== EngineState.Paused) running.stateBeforePause = undefined;
    emitSessionChanges(sdk, ref.projectId, updated.revision, [
      { type: "upsert", session: updated.session },
    ]);
    return updated.session;
  }
  return undefined;
}

async function persistTerminal(
  sdk: BackendSDK,
  ref: SessionRef,
  state: EngineState,
  phase: EnginePhase,
  running: RunningSession,
  terminalError?: ApiError,
): Promise<void> {
  if (!isCurrentSession(ref, running) || !running.finalizing) return;
  const updated = await getSessionStore().updateSession(ref, {
    state,
    phase,
    error: terminalError,
  });
  if (updated && isCurrentSession(ref, running)) {
    running.state = state;
    running.phase = phase;
    running.controller.abort();
    emitSessionChanges(sdk, ref.projectId, updated.revision, [
      {
        type: "terminal",
        session: updated.session,
        error: terminalError,
      },
    ]);
  }
}

async function finalizeRunningSession(
  sdk: BackendSDK,
  ref: SessionRef,
  running: RunningSession,
  state: EngineState,
  phase: EnginePhase,
  terminalError?: ApiError,
): Promise<void> {
  try {
    await drainEvents(running);
    const finalError = running.eventError ?? terminalError;
    await persistTerminal(
      sdk,
      ref,
      running.eventError ? EngineState.Error : state,
      phase,
      running,
      finalError,
    );
  } finally {
    deleteRunningSession(ref, running);
  }
}

function beginFinalization(running: RunningSession): boolean {
  if (running.finalizing || terminalStates.has(running.state)) return false;
  running.finalizing = true;
  running.acceptingEvents = false;
  return true;
}

function isCurrentSession(ref: SessionRef, running: RunningSession): boolean {
  return runningSessions.get(sessionKey(ref)) === running;
}

function deleteRunningSession(ref: SessionRef, running: RunningSession): void {
  if (isCurrentSession(ref, running)) runningSessions.delete(sessionKey(ref));
}

function enqueueEvent(
  running: RunningSession,
  task: () => Promise<void>,
): void {
  running.eventChain = running.eventChain.then(task).catch((cause: unknown) => {
    running.eventError ??= {
      code: "IO",
      message: `Could not persist scan progress: ${getErrorMessage(cause)}`,
    };
    running.acceptingEvents = false;
    running.controller.abort();
  });
}

async function drainEvents(running: RunningSession): Promise<void> {
  await running.eventChain;
}

function getActiveStateForPhase(phase: EnginePhase): EngineState {
  if (phase === EnginePhase.Learning) return EngineState.Learning;
  if (phase === EnginePhase.Discovery) return EngineState.Running;
  return EngineState.Pending;
}

function rollbackPause(session: RunningSession): void {
  if (
    !session.controller.signal.aborted &&
    !terminalStates.has(session.state)
  ) {
    session.runControl.resume();
  }
  session.stateBeforePause = undefined;
}

function toSentRequest(
  event: Extract<DiscoveryEvent, { type: "request" }>,
): SentRequest {
  return {
    parametersSent: event.parametersSent,
    parametersTested: event.parametersTested,
    context: event.context,
    requestId: event.requestResponse.request.id,
    responseStatus: event.requestResponse.response.status,
    responseTime: event.requestResponse.response.time,
    responseLength: event.requestResponse.response.length ?? 0,
  };
}

function toSessionFinding(finding: Finding): SessionFinding {
  return {
    requestId: finding.requestResponse.request.id,
    responseStatus: finding.requestResponse.response.status,
    responseLength: finding.requestResponse.response.length ?? 0,
    parameter: finding.parameter,
    anomaly: finding.anomaly,
  };
}
