import {
  type DiscoveryEvent,
  EnginePhase,
  EngineState,
  type Finding,
  type RunDiscoveryScanResult,
} from "@paramfinder/engine";
import {
  type NonTerminalSessionLifecycle,
  nonTerminalSessionLifecycleSchema,
  type ParamMinerConfig,
  type SentRequest,
  type SessionChange,
  type SessionDescriptor,
  type SessionEntryInput,
  type SessionFinding,
  type TerminalSessionLifecycle,
} from "shared";

import {
  type RunningSession,
  type RunningSessionsStore,
  setPauseOwner,
} from "../stores/running-sessions";
import type { BackendSDK } from "../types";
import { getErrorMessage } from "../util";

import type { SessionsService } from "./sessions";

const TERMINAL_PERSIST_ATTEMPTS = 2;
const terminalStates = new Set<EngineState>([
  EngineState.Completed,
  EngineState.Error,
  EngineState.Canceled,
  EngineState.Timeout,
]);

export class MiningEvents {
  constructor(
    private readonly sdk: BackendSDK,
    private readonly sessions: SessionsService,
    private readonly runningSessions: RunningSessionsStore,
  ) {}

  publish(projectId: string, revision: number, changes: SessionChange[]): void {
    this.sdk.api.send("paramfinder:session_change", {
      projectId,
      revision,
      changes,
    });
  }

  enqueue(
    running: RunningSession,
    config: ParamMinerConfig,
    event: DiscoveryEvent,
  ): void {
    if (!this.runningSessions.isCurrent(running) || !running.acceptingEvents) {
      return;
    }

    if (event.type === "state" && event.state === EngineState.Paused) {
      setPauseOwner(running, "external");
    }

    running.eventChain = running.eventChain
      .then(async () => this.persistDiscoveryEvent(running, config, event))
      .catch((cause: unknown) => {
        running.eventError ??= {
          code: "IO",
          message: `Could not persist scan progress: ${getErrorMessage(cause)}`,
        };
        running.acceptingEvents = false;
        running.controller.abort();
      });
  }

  async drain(running: RunningSession): Promise<void> {
    await running.eventChain;
  }

  beginFinalization(running: RunningSession): boolean {
    if (
      running.terminalPersistence.kind === "claimed" ||
      running.terminalPersistence.kind === "persisting" ||
      terminalStates.has(running.state)
    ) {
      return false;
    }

    running.terminalPersistence = { kind: "claimed" };
    running.acceptingEvents = false;
    return true;
  }

  isFinalizing(running: RunningSession): boolean {
    return (
      running.terminalPersistence.kind === "claimed" ||
      running.terminalPersistence.kind === "persisting"
    );
  }

  async persistState(
    running: RunningSession,
    lifecycle: NonTerminalSessionLifecycle,
  ): Promise<SessionDescriptor | undefined> {
    if (
      !this.runningSessions.isCurrent(running) ||
      terminalStates.has(running.state)
    ) {
      return;
    }

    if (
      running.state === lifecycle.state &&
      running.phase === lifecycle.phase
    ) {
      return;
    }

    const updated = await this.sessions.transitionSession(
      running.ref,
      lifecycle,
    );

    if (updated !== undefined && this.runningSessions.isCurrent(running)) {
      running.state = lifecycle.state;
      running.phase = lifecycle.phase;

      this.publish(running.ref.projectId, updated.revision, [
        { type: "upsert", session: updated.session },
      ]);

      return updated.session;
    }

    return undefined;
  }

  finalize(
    running: RunningSession,
    lifecycle: TerminalSessionLifecycle,
  ): Promise<void> {
    const completion = this.persistFinalState(running, lifecycle);
    running.terminalPersistence = { kind: "persisting", completion };

    return completion;
  }

  private async persistFinalState(
    running: RunningSession,
    lifecycle: TerminalSessionLifecycle,
  ): Promise<void> {
    let finalLifecycle = lifecycle;

    try {
      await this.drain(running);

      if (running.eventError !== undefined) {
        finalLifecycle = {
          state: EngineState.Error,
          phase: lifecycle.phase,
          error: running.eventError,
        };
      }

      await this.persistTerminalWithRetry(running, finalLifecycle);
      this.runningSessions.delete(running);
    } catch (cause) {
      running.terminalPersistence = {
        kind: "failed",
        lifecycle: finalLifecycle,
      };
      throw cause;
    }
  }

  async finalizeStartupFailure(
    running: RunningSession,
    cause: unknown,
  ): Promise<void> {
    if (!this.beginFinalization(running)) {
      return;
    }

    try {
      await this.finalize(running, {
        state: EngineState.Error,
        phase: running.phase,
        error: { code: "INTERNAL", message: getErrorMessage(cause) },
      });
    } catch (finalizeCause) {
      this.sdk.console.error(
        `[SESSIONS] Could not finalize failed startup ${running.ref.sessionId}: ${getErrorMessage(finalizeCause)}`,
      );
    }
  }

  activeLifecycleForPhase(phase: EnginePhase): NonTerminalSessionLifecycle {
    switch (phase) {
      case EnginePhase.Learning:
        return { state: EngineState.Learning, phase };
      case EnginePhase.Discovery:
        return { state: EngineState.Running, phase };
      case EnginePhase.Idle:
        return { state: EngineState.Pending, phase };
    }
  }

  terminalLifecycle(
    summary: RunDiscoveryScanResult["summary"],
  ): TerminalSessionLifecycle {
    switch (summary.state) {
      case EngineState.Completed:
        return { state: summary.state, phase: summary.phase };
      case EngineState.Canceled:
        return { state: summary.state, phase: summary.phase };
      case EngineState.Timeout:
        return { state: summary.state, phase: summary.phase };
      case EngineState.Error:
        return {
          state: summary.state,
          phase: summary.phase,
          error: { code: "INTERNAL", message: summary.failureReason },
        };
    }
  }

  isTerminal(state: EngineState): boolean {
    return terminalStates.has(state);
  }

  private async persistDiscoveryEvent(
    running: RunningSession,
    config: ParamMinerConfig,
    event: DiscoveryEvent,
  ): Promise<void> {
    if (
      !this.runningSessions.isCurrent(running) ||
      terminalStates.has(running.state)
    ) {
      return;
    }

    switch (event.type) {
      case "state":
      case "completed":
        if (!terminalStates.has(event.state)) {
          await this.persistState(
            running,
            nonTerminalSessionLifecycleSchema.parse({
              state: event.state,
              phase: event.phase,
            }),
          );
        }
        return;
      case "log":
        if (event.level !== "debug" || config.debug) {
          await this.persistEntry(running, {
            kind: "log",
            value: event.message,
          });
        }
        return;
      case "request":
        await this.persistEntry(running, {
          kind: "request",
          value: toSentRequest(event),
        });
        return;
      case "finding":
        await this.persistEntry(running, {
          kind: "finding",
          value: toSessionFinding(event.finding),
        });
        return;
      case "adjustTotalParameters": {
        const updated = await this.sessions.setTotalParametersAmount(
          running.ref,
          event.totalParametersAmount,
        );

        if (updated !== undefined && this.runningSessions.isCurrent(running)) {
          this.publish(running.ref.projectId, updated.revision, [
            { type: "upsert", session: updated.session },
          ]);
        }
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

  private async persistEntry(
    running: RunningSession,
    entry: SessionEntryInput,
  ): Promise<void> {
    if (
      !this.runningSessions.isCurrent(running) ||
      terminalStates.has(running.state)
    ) {
      return;
    }

    const persisted = await this.sessions.appendEntries(running.ref, [entry]);

    if (persisted === undefined || !this.runningSessions.isCurrent(running)) {
      return;
    }

    this.publish(running.ref.projectId, persisted.revision, [
      {
        type: "entries",
        ref: running.ref,
        entries: persisted.entries,
        session: persisted.session,
      },
    ]);
  }

  private async persistTerminalWithRetry(
    running: RunningSession,
    lifecycle: TerminalSessionLifecycle,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < TERMINAL_PERSIST_ATTEMPTS; attempt += 1) {
      try {
        await this.persistTerminal(running, lifecycle);
        return;
      } catch (cause) {
        lastError = cause;
      }
    }

    throw lastError;
  }

  private async persistTerminal(
    running: RunningSession,
    lifecycle: TerminalSessionLifecycle,
  ): Promise<void> {
    if (
      !this.runningSessions.isCurrent(running) ||
      running.terminalPersistence.kind !== "persisting"
    ) {
      return;
    }

    const updated = await this.sessions.transitionSession(
      running.ref,
      lifecycle,
    );

    if (updated !== undefined && this.runningSessions.isCurrent(running)) {
      running.state = lifecycle.state;
      running.phase = lifecycle.phase;
      running.controller.abort();

      try {
        this.publish(running.ref.projectId, updated.revision, [
          { type: "terminal", session: updated.session },
        ]);
      } catch (cause) {
        this.sdk.console.error(
          `[SESSIONS] Could not publish terminal state for ${running.ref.sessionId}: ${getErrorMessage(cause)}`,
        );
      }
    }
  }
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
    responseLength: event.requestResponse.response.length,
  };
}

function toSessionFinding(finding: Finding): SessionFinding {
  return {
    requestId: finding.requestResponse.request.id,
    responseStatus: finding.requestResponse.response.status,
    responseLength: finding.requestResponse.response.length,
    parameter: finding.parameter,
    anomaly: finding.anomaly,
  };
}
