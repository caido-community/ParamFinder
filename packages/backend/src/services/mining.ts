import {
  EngineError,
  EnginePhase,
  EngineState,
  RunControl,
  runDiscoveryScan,
  validateMutationTarget,
} from "@paramfinder/engine";
import {
  type ApiResult,
  error,
  ok,
  type ParamMinerConfig,
  type Request,
  type SessionDescriptor,
  type SessionRef,
} from "shared";

import { CaidoRequestProvider, toEngineConfig, toRunOptions } from "../engine";
import {
  type PauseOwnership,
  type RunningSession,
  type RunningSessionsStore,
  setPauseOwner,
} from "../stores/running-sessions";
import type { BackendSDK } from "../types";
import { getErrorMessage } from "../util";

import { MiningEvents } from "./mining-events";
import type { SessionsService } from "./sessions";
import { DEFAULT_REQUEST_TIMEOUT_SECONDS } from "./settings";
import type { WordlistsService } from "./wordlists";

export class MiningService {
  private readonly events: MiningEvents;
  private readonly pauseOperations = new WeakMap<
    RunningSession,
    Promise<void>
  >();
  private readonly projectPauses = new WeakMap<
    RunningSession,
    Promise<ApiResult<void>>
  >();
  private projectGeneration = 0;

  constructor(
    private readonly sdk: BackendSDK,
    private readonly sessions: SessionsService,
    private readonly wordlists: WordlistsService,
    private readonly runningSessions: RunningSessionsStore,
    private activeProjectId: string | undefined,
  ) {
    this.events = new MiningEvents(sdk, sessions, runningSessions);
  }

  async start(
    projectId: string,
    target: Request,
    config: ParamMinerConfig,
  ): Promise<ApiResult<SessionDescriptor>> {
    try {
      validateMutationTarget({
        baseRequest: target,
        attackType: config.attackType,
        customValueType: config.customValueType,
        jsonBodyPath: config.jsonBodyPath,
      });

      const engineConfig = toEngineConfig(config);
      const baseRunOptions = toRunOptions(
        config,
        DEFAULT_REQUEST_TIMEOUT_SECONDS,
      );
      const words = await this.wordlists.loadEnabledWords(config.attackType);

      if (words.length === 0) {
        return error(
          "No enabled wordlists found. Please upload a wordlist first.",
          "VALIDATION",
        );
      }

      if (!(await this.isProjectActive(projectId))) {
        return projectChangedError();
      }

      const created = await this.sessions.createNextSession(
        projectId,
        words.length,
        config.learnRequestsCount,
        { targetRequest: target, config },
      );

      const controller = new AbortController();
      const runControl = new RunControl();
      const running: RunningSession = {
        ref: created.session.ref,
        controller,
        runControl,
        state: EngineState.Pending,
        phase: EnginePhase.Idle,
        eventChain: Promise.resolve(),
        acceptingEvents: true,
        pauseOwnership: { kind: "none" },
        terminalPersistence: { kind: "pending" },
      };

      this.runningSessions.set(running);

      let started: SessionDescriptor | undefined;
      let scanPromise: ReturnType<typeof runDiscoveryScan>;
      try {
        this.events.publish(projectId, created.revision, [
          { type: "upsert", session: created.session },
        ]);

        if (!(await this.isProjectActive(projectId))) {
          return this.stopStartupAfterProjectChange(running);
        }

        // Finish startup persistence before the engine can spawn transport work.
        started = await this.events.persistState(running, {
          state: EngineState.Learning,
          phase: EnginePhase.Learning,
        });
        if (started === undefined) {
          this.runningSessions.delete(running);
          return error("Session disappeared during startup.", "NOT_FOUND");
        }

        if (!(await this.isProjectActive(projectId))) {
          return this.stopStartupAfterProjectChange(running);
        }

        const provider = new CaidoRequestProvider(this.sdk);
        scanPromise = runDiscoveryScan(
          { provider },
          {
            request: target,
            words,
            engineConfig,
            runOptions: {
              ...baseRunOptions,
              signal: controller.signal,
              runControl: running.runControl,
              onEvent: (event) => this.events.enqueue(running, config, event),
            },
          },
        );
      } catch (cause) {
        controller.abort();
        await this.events.finalizeStartupFailure(running, cause);
        throw cause;
      }

      scanPromise
        .then(
          async ({ summary }) => {
            if (
              !this.runningSessions.isCurrent(running) ||
              !this.events.beginFinalization(running)
            ) {
              return;
            }

            await this.events.finalize(
              running,
              this.events.terminalLifecycle(summary),
            );
          },
          async (cause: unknown) => {
            if (
              !this.runningSessions.isCurrent(running) ||
              !this.events.beginFinalization(running)
            ) {
              return;
            }

            await this.events.finalize(running, {
              state: EngineState.Error,
              phase: running.phase,
              error: {
                code: "INTERNAL",
                message: running.eventError?.message ?? getErrorMessage(cause),
              },
            });
          },
        )
        .catch((cause: unknown) => {
          this.sdk.console.error(
            `[SESSIONS] Could not finalize ${running.ref.sessionId}: ${getErrorMessage(cause)}`,
          );
        });

      return ok(started);
    } catch (cause) {
      if (cause instanceof EngineError) {
        return error(cause.message, "VALIDATION");
      }

      this.sdk.console.error(cause);
      return error(getErrorMessage(cause));
    }
  }

  async cancel(ref: SessionRef): Promise<ApiResult<void>> {
    const running = this.runningSessions.get(ref);

    if (running === undefined) {
      const stored = await this.sessions.getSession(ref);
      if (stored !== undefined && this.events.isTerminal(stored.state)) {
        return ok(undefined);
      }

      return error("Session is no longer running.", "NOT_FOUND");
    }

    const terminalPersistence = running.terminalPersistence;

    if (!this.events.beginFinalization(running)) {
      if (terminalPersistence.kind === "persisting") {
        await terminalPersistence.completion;
      }

      return ok(undefined);
    }

    running.controller.abort();

    const terminalLifecycle =
      terminalPersistence.kind === "failed"
        ? terminalPersistence.lifecycle
        : running.eventError === undefined
          ? { state: EngineState.Canceled, phase: running.phase }
          : {
              state: EngineState.Error,
              phase: running.phase,
              error: running.eventError,
            };

    await this.events.finalize(running, terminalLifecycle);

    if (running.eventError !== undefined) {
      return error(running.eventError.message, "IO");
    }

    return ok(undefined);
  }

  async pause(ref: SessionRef): Promise<ApiResult<void>> {
    const running = this.runningSessions.get(ref);

    if (running === undefined) {
      return error("Session is no longer running.", "NOT_FOUND");
    }

    if (terminalPersistenceFailed(running)) {
      return terminalPersistenceError();
    }

    if (
      running.state !== EngineState.Pending &&
      running.state !== EngineState.Learning &&
      running.state !== EngineState.Running &&
      running.state !== EngineState.Paused
    ) {
      return error(`Cannot pause a ${running.state} session.`, "CONFLICT");
    }

    const pauseOwnership = setPauseOwner(running, "external");
    return this.queuePause(running, () =>
      this.pauseRunning(running, pauseOwnership),
    );
  }

  async resume(ref: SessionRef): Promise<ApiResult<void>> {
    const running = this.runningSessions.get(ref);

    if (running === undefined) {
      return error("Session is no longer running.", "NOT_FOUND");
    }

    if (running.terminalPersistence.kind === "failed") {
      return terminalPersistenceError();
    }

    if (running.state !== EngineState.Paused) {
      return error(`Cannot resume a ${running.state} session.`, "CONFLICT");
    }

    const pauseOwnership = running.pauseOwnership;
    return this.queuePause(running, () =>
      this.resumeRunning(running, pauseOwnership),
    );
  }

  async pauseOutsideProject(
    projectId: string | undefined,
  ): Promise<ApiResult<void>> {
    this.activeProjectId = projectId;
    this.projectGeneration += 1;

    const sessions = this.runningSessions
      .values()
      .filter(
        (session) =>
          session.ref.projectId !== projectId &&
          session.state !== EngineState.Paused &&
          session.terminalPersistence.kind === "pending",
      );

    const results = await Promise.all(
      sessions.map((session) => this.pauseForProjectChange(session)),
    );

    return results.find((result) => !result.success) ?? ok(undefined);
  }

  async deleteSessions(refs: SessionRef[]): Promise<void> {
    const revisions = await this.sessions.deleteSessions(refs);

    this.runningSessions.tombstone(refs);

    for (const [projectId, revision] of revisions) {
      this.events.publish(projectId, revision, [
        {
          type: "delete",
          refs: refs.filter((ref) => ref.projectId === projectId),
        },
      ]);
    }
  }

  private async resumeRunning(
    running: RunningSession,
    pauseOwnership: PauseOwnership,
  ): Promise<ApiResult<void>> {
    if (running.terminalPersistence.kind === "failed") {
      return terminalPersistenceError();
    }

    if (running.terminalPersistence.kind !== "pending") {
      return ok(undefined);
    }

    const resumedLifecycle = this.events.activeLifecycleForPhase(running.phase);
    await this.events.drain(running);

    if (terminalPersistenceFailed(running)) {
      return terminalPersistenceError();
    }

    if (this.events.isFinalizing(running)) {
      return ok(undefined);
    }

    if (running.eventError) {
      return error(running.eventError.message, "IO");
    }

    if (running.pauseOwnership !== pauseOwnership) {
      return ok(undefined);
    }

    await this.events.persistState(running, resumedLifecycle);

    if (
      this.runningSessions.isCurrent(running) &&
      running.pauseOwnership === pauseOwnership &&
      !this.events.isTerminal(running.state)
    ) {
      setPauseOwner(running, "none");
      running.runControl.resume();
    }

    return ok(undefined);
  }

  private async pauseForProjectChange(
    running: RunningSession,
  ): Promise<ApiResult<void>> {
    const existing = this.projectPauses.get(running);

    if (existing !== undefined) {
      return existing;
    }

    const reconciliation = this.trackProjectPause(running);
    this.projectPauses.set(running, reconciliation);

    return reconciliation;
  }

  private async trackProjectPause(
    running: RunningSession,
  ): Promise<ApiResult<void>> {
    try {
      return await this.queuePause(running, () =>
        this.reconcileProjectPause(running),
      );
    } finally {
      this.projectPauses.delete(running);
    }
  }

  private async reconcileProjectPause(
    running: RunningSession,
  ): Promise<ApiResult<void>> {
    if (running.terminalPersistence.kind !== "pending") {
      return ok(undefined);
    }

    if (running.ref.projectId === this.activeProjectId) {
      return ok(undefined);
    }

    if (running.pauseOwnership.kind === "external") {
      return ok(undefined);
    }

    const pauseOwnership = setPauseOwner(running, "project");

    running.runControl.pause();

    try {
      await this.events.drain(running);

      if (this.events.isFinalizing(running)) {
        return ok(undefined);
      }

      if (running.eventError) {
        this.releasePause(running, pauseOwnership);
        return error(running.eventError.message, "IO");
      }

      const activeLifecycle = this.events.activeLifecycleForPhase(
        running.phase,
      );

      while (this.runningSessions.isCurrent(running)) {
        if (running.pauseOwnership !== pauseOwnership) {
          return ok(undefined);
        }

        const generation = this.projectGeneration;
        const shouldRemainPaused =
          running.ref.projectId !== this.activeProjectId;

        if (shouldRemainPaused && running.state !== EngineState.Paused) {
          await this.events.persistState(running, {
            state: EngineState.Paused,
            phase: running.phase,
          });
        } else if (
          !shouldRemainPaused &&
          running.state === EngineState.Paused
        ) {
          await this.events.persistState(running, activeLifecycle);
        }

        if (this.events.isFinalizing(running)) {
          return ok(undefined);
        }

        if (running.pauseOwnership !== pauseOwnership) {
          return ok(undefined);
        }

        if (generation !== this.projectGeneration) {
          continue;
        }

        if (!shouldRemainPaused) {
          this.releasePause(running, pauseOwnership);
        }

        return ok(undefined);
      }

      return ok(undefined);
    } catch (cause) {
      if (
        running.state !== EngineState.Paused &&
        running.pauseOwnership === pauseOwnership
      ) {
        this.releasePause(running, pauseOwnership);
      }

      return error(
        `Could not reconcile project pause: ${getErrorMessage(cause)}`,
        "IO",
      );
    }
  }

  private async pauseRunning(
    running: RunningSession,
    pauseOwnership: PauseOwnership,
  ): Promise<ApiResult<void>> {
    let pausePersisted = false;

    if (running.terminalPersistence.kind === "failed") {
      return terminalPersistenceError();
    }

    if (running.terminalPersistence.kind !== "pending") {
      return ok(undefined);
    }

    running.runControl.pause();

    try {
      await this.events.drain(running);

      if (terminalPersistenceFailed(running)) {
        return terminalPersistenceError();
      }

      if (this.events.isFinalizing(running)) {
        return ok(undefined);
      }

      if (running.eventError) {
        this.releasePause(running, pauseOwnership);
        return error(running.eventError.message, "IO");
      }

      await this.events.persistState(running, {
        state: EngineState.Paused,
        phase: running.phase,
      });
      pausePersisted = running.state === EngineState.Paused;

      return ok(undefined);
    } catch (cause) {
      if (!pausePersisted && running.pauseOwnership === pauseOwnership) {
        this.releasePause(running, pauseOwnership);
      }

      return error(
        `Could not persist paused state: ${getErrorMessage(cause)}`,
        "IO",
      );
    }
  }

  private queuePause(
    running: RunningSession,
    operation: () => Promise<ApiResult<void>>,
  ): Promise<ApiResult<void>> {
    const previous = this.pauseOperations.get(running) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );

    this.pauseOperations.set(running, settled);

    return result.finally(() => {
      if (this.pauseOperations.get(running) === settled) {
        this.pauseOperations.delete(running);
      }
    });
  }

  private async isProjectActive(projectId: string): Promise<boolean> {
    const project = await this.sdk.projects.getCurrent();
    return project?.getId() === projectId;
  }

  private async stopStartupAfterProjectChange(
    running: RunningSession,
  ): Promise<ApiResult<SessionDescriptor>> {
    try {
      const canceled = await this.cancel(running.ref);
      if (!canceled.success) {
        return canceled;
      }
    } catch (cause) {
      return error(
        `Could not stop a scan after the active project changed: ${getErrorMessage(cause)}`,
        "IO",
      );
    }

    return projectChangedError();
  }

  private releasePause(
    running: RunningSession,
    ownership: PauseOwnership,
  ): void {
    if (running.pauseOwnership !== ownership) {
      return;
    }

    setPauseOwner(running, "none");
    this.rollbackPause(running);
  }

  private rollbackPause(running: RunningSession): void {
    if (
      !running.controller.signal.aborted &&
      !this.events.isTerminal(running.state)
    ) {
      running.runControl.resume();
    }
  }
}

function projectChangedError(): ApiResult<never> {
  return error(
    "The active project changed while starting the scan.",
    "CONFLICT",
  );
}

function terminalPersistenceError(): ApiResult<never> {
  return error(
    "The scan finished, but its terminal state could not be persisted. Cancel it to retry finalization.",
    "CONFLICT",
  );
}

function terminalPersistenceFailed(running: RunningSession): boolean {
  return running.terminalPersistence.kind === "failed";
}
