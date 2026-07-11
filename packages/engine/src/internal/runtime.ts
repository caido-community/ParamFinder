import { matchesWafResponse } from "../detect-anomaly";
import { EngineError } from "../errors";
import type { DiscoveryEvent } from "../events";
import { mutateRequest } from "../mutate-request";
import {
  defaultSleep,
  type EngineDependencies,
  type RequestProvider,
} from "../provider";
import type {
  AttackType,
  EngineConfig,
  EngineRequest,
  EngineRequestResponse,
  EngineResponse,
  LoggerFn,
  Parameter,
  RandomSource,
  RequestContext,
  RunOptions,
  SleepFn,
} from "../types";
import { EnginePhase, EngineState } from "../types";
import { emitLog } from "../utils";

type EventSink = Pick<RunOptions, "onEvent"> | undefined;

const CLOUDFLARE_CHALLENGE_TITLE = "<title>Just a moment...</title>";
const CLOUDFLARE_RETRY_COUNT = 2;
const RATE_LIMIT_STATUS = 429;

export interface SendMutatedRequestArgs {
  baseRequest: EngineRequest;
  parameters: Parameter[];
  attackType: AttackType;
  context: RequestContext;
  engineConfig: EngineConfig;
  runOptions?: RunOptions;
  allowCloudflareChallenge?: boolean;
}

interface SendRequestOptions {
  allowCloudflareChallenge?: boolean;
}

interface PauseForInterventionOptions {
  level: "info" | "warn";
  message: string;
  stateFirst: boolean;
}

export interface EngineRuntimeContext {
  runtime: {
    provider: RequestProvider;
    sleep: SleepFn;
    now: () => number;
    random: RandomSource;
    logger?: LoggerFn;
  };
  emit: (runOptions: EventSink, event: DiscoveryEvent) => void;
  waitForCheckpoint: (runOptions?: RunOptions) => Promise<void>;
  sleepIfNeeded: (
    runOptions?: RunOptions,
    extraDelayMs?: number,
  ) => Promise<void>;
  sendRequest: (
    request: EngineRequest,
    runOptions?: RunOptions,
  ) => Promise<EngineRequestResponse>;
  sendMutatedRequest: (
    args: SendMutatedRequestArgs,
  ) => Promise<EngineRequestResponse>;
  detectAndEmitRequest: (
    runOptions: EventSink,
    requestResponse: EngineRequestResponse,
    parametersSent: number,
    parametersTested?: number,
  ) => void;
  setKnownWafResponse: (response?: EngineResponse) => void;
  dispose: () => void;
}

export interface EngineRuntimeLimits {
  timeoutMs?: number;
}

export function createEngineRuntimeContext(
  dependencies: EngineDependencies,
  limits: EngineRuntimeLimits = {},
): EngineRuntimeContext {
  const runtime = {
    provider: dependencies.provider,
    sleep: dependencies.sleep ?? defaultSleep,
    now: dependencies.now ?? Date.now,
    random: dependencies.random ?? Math.random,
    logger: dependencies.logger,
  };
  const deadlineAt =
    limits.timeoutMs === undefined
      ? undefined
      : runtime.now() + limits.timeoutMs;
  const deadlineController =
    deadlineAt === undefined ? undefined : new AbortController();
  const deadlineTimer =
    deadlineController === undefined
      ? undefined
      : setTimeout(() => deadlineController.abort(), limits.timeoutMs);
  let knownWafResponse: EngineResponse | undefined;
  let needsRequestDelay = false;

  const emit = (runOptions: EventSink, event: DiscoveryEvent): void => {
    if (event.type === "log") {
      emitLog(runtime.logger, event.level, event.message);
    }

    runOptions?.onEvent?.(event);
  };

  const waitForCheckpoint = async (runOptions?: RunOptions): Promise<void> => {
    throwIfStopped(runOptions);
    if (runOptions?.runControl === undefined) {
      return;
    }

    const operation = createOperationSignal(runOptions);
    try {
      await raceWithSignal(
        runOptions.runControl.waitIfPaused(operation.signal),
        operation.signal,
      );
    } catch (error) {
      throwStoppedOr(error, runOptions, operation.requestTimedOut);
    } finally {
      operation.dispose();
    }
    throwIfStopped(runOptions);
  };

  const sleepIfNeeded = async (
    runOptions?: RunOptions,
    extraDelayMs: number = 0,
  ) => {
    const delayMs = (runOptions?.delayMs ?? 0) + extraDelayMs;
    await waitForCheckpoint(runOptions);
    if (delayMs <= 0) {
      needsRequestDelay = false;
      return;
    }

    const operation = createOperationSignal(runOptions);
    try {
      await raceWithSignal(
        runtime.sleep(delayMs, operation.signal),
        operation.signal,
      );
    } catch (error) {
      throwStoppedOr(error, runOptions, operation.requestTimedOut);
    } finally {
      operation.dispose();
    }
    needsRequestDelay = false;
    throwIfStopped(runOptions);
  };

  const sendProviderRequest = async (
    request: EngineRequest,
    runOptions?: RunOptions,
  ): Promise<EngineRequestResponse> => {
    await waitForCheckpoint(runOptions);
    if (needsRequestDelay) {
      await sleepIfNeeded(runOptions);
    }
    throwIfStopped(runOptions);
    const remainingMs = getRemainingMs();
    const providerTimeoutMs = minimumDefined(
      runOptions?.requestTimeoutMs,
      remainingMs,
    );
    const requestTimeoutWins =
      runOptions?.requestTimeoutMs !== undefined &&
      (remainingMs === undefined || runOptions.requestTimeoutMs < remainingMs);
    const operation = createOperationSignal(
      runOptions,
      requestTimeoutWins ? runOptions.requestTimeoutMs : undefined,
    );
    let result: EngineRequestResponse;
    try {
      result = await runtime.provider.send(request, {
        signal: operation.signal,
        timeoutMs: providerTimeoutMs,
      });
      needsRequestDelay = true;
      throwIfStopped(runOptions);
      if (operation.requestTimedOut()) {
        throwRequestTimeout(runOptions?.requestTimeoutMs);
      }
    } catch (error) {
      if (operation.requestTimedOut()) {
        throwRequestTimeout(runOptions?.requestTimeoutMs, error);
      }

      throwIfStopped(runOptions);

      if (error instanceof EngineError) {
        throw error;
      }

      throw new EngineError("PROVIDER_ERROR", "Request provider failed", {
        cause: error,
      });
    } finally {
      operation.dispose();
    }

    await waitForCheckpoint(runOptions);
    return result;
  };

  const sendRequestWithOptions = async (
    request: EngineRequest,
    runOptions?: RunOptions,
    options: SendRequestOptions = {},
  ): Promise<EngineRequestResponse> => {
    let retries = 0;

    while (true) {
      const result = await sendProviderRequest(request, runOptions);
      if (result.response.status === RATE_LIMIT_STATUS) {
        if (runOptions?.runControl === undefined) {
          const message =
            "Rate limited with HTTP 429. Run stopped because pausing is unavailable.";
          emit(runOptions, { type: "log", level: "warn", message });
          throw new EngineError("PROVIDER_ERROR", message);
        }

        await pauseForIntervention(request, runOptions, {
          level: "info",
          message:
            "Rate limited, pausing the run. Adjust the delay between requests, then resume.",
          stateFirst: true,
        });
        continue;
      }

      if (!isCloudflareChallenge(result)) {
        return result;
      }
      if (
        options.allowCloudflareChallenge ||
        (knownWafResponse !== undefined &&
          matchesWafResponse(knownWafResponse, result.response))
      ) {
        return result;
      }

      if (retries < CLOUDFLARE_RETRY_COUNT) {
        retries += 1;
        await sleepIfNeeded(runOptions);
        continue;
      }

      if (runOptions?.runControl === undefined) {
        const message =
          "Cloudflare WAF detected after 2 retries. Run stopped because pausing is unavailable.";
        emit(runOptions, { type: "log", level: "warn", message });
        throw new EngineError("PROVIDER_ERROR", message);
      }

      await pauseForIntervention(request, runOptions, {
        level: "warn",
        message:
          "Cloudflare WAF detected after 2 retries. Run paused; resolve the challenge, then resume.",
        stateFirst: false,
      });
      retries = 0;
    }
  };

  const pauseForIntervention = async (
    request: EngineRequest,
    runOptions: RunOptions,
    options: PauseForInterventionOptions,
  ): Promise<void> => {
    const runControl = runOptions.runControl;
    if (runControl === undefined) {
      throw new EngineError(
        "INTERNAL_ERROR",
        "Cannot pause a run without run control",
      );
    }

    const stateEvent: DiscoveryEvent = {
      type: "state",
      state: EngineState.Paused,
      phase: getPhaseForRequest(request),
    };
    const logEvent: DiscoveryEvent = {
      type: "log",
      level: options.level,
      message: options.message,
    };

    if (options.stateFirst) {
      emit(runOptions, stateEvent);
      emit(runOptions, logEvent);
    } else {
      emit(runOptions, logEvent);
      emit(runOptions, stateEvent);
    }

    runControl.pause();
    await waitForCheckpoint(runOptions);
    emitResumedState(runOptions, request);
  };

  const sendRequest = async (
    request: EngineRequest,
    runOptions?: RunOptions,
  ): Promise<EngineRequestResponse> =>
    await sendRequestWithOptions(request, runOptions);

  const sendMutatedRequest = async (
    args: SendMutatedRequestArgs,
  ): Promise<EngineRequestResponse> => {
    const cacheBusterSeed = `${runtime.now()}-${Math.floor(runtime.random() * 1_000_000)}`;
    const mutatedRequest = mutateRequest({
      baseRequest: args.baseRequest,
      attackType: args.attackType,
      parameters: args.parameters,
      context: args.context,
      updateContentLength: args.engineConfig.updateContentLength,
      customValueType: args.engineConfig.customValueType,
      jsonBodyPath: args.engineConfig.jsonBodyPath,
      addCacheBusterParameter: args.engineConfig.addCacheBusterParameter,
      cacheBusterValue: `cb${cacheBusterSeed}`,
    });

    const requestResponse = await sendRequestWithOptions(
      mutatedRequest,
      args.runOptions,
      {
        allowCloudflareChallenge: args.allowCloudflareChallenge,
      },
    );
    return {
      request: {
        ...requestResponse.request,
        context: args.context,
      },
      response: requestResponse.response,
    };
  };

  const detectAndEmitRequest = (
    runOptions: EventSink,
    requestResponse: EngineRequestResponse,
    parametersSent: number,
    parametersTested = parametersSent,
  ) => {
    emit(runOptions, {
      type: "request",
      parametersSent,
      parametersTested,
      context: requestResponse.request.context,
      requestResponse,
    });
  };

  const setKnownWafResponse = (response?: EngineResponse): void => {
    knownWafResponse = response;
  };

  const getRemainingMs = (): number | undefined =>
    deadlineAt === undefined
      ? undefined
      : Math.max(0, deadlineAt - runtime.now());

  const deadlineExpired = (): boolean =>
    deadlineController?.signal.aborted === true ||
    (deadlineAt !== undefined && runtime.now() >= deadlineAt);

  const throwIfStopped = (runOptions?: RunOptions): void => {
    if (runOptions?.signal?.aborted) {
      throw new EngineError("RUN_ABORTED", "Run aborted");
    }

    if (deadlineExpired()) {
      throw new EngineError("RUN_TIMEOUT", "Run deadline exceeded");
    }
  };

  const throwStoppedOr = (
    error: unknown,
    runOptions: RunOptions | undefined,
    requestTimedOut: () => boolean,
  ): never => {
    if (requestTimedOut()) {
      throwRequestTimeout(runOptions?.requestTimeoutMs, error);
    }

    throwIfStopped(runOptions);

    throw error;
  };

  const createOperationSignal = (
    runOptions?: RunOptions,
    requestTimeoutMs?: number,
  ): OperationSignal => {
    const controller = new AbortController();
    let didRequestTimeout = false;
    const cleanups: Array<() => void> = [];

    const linkSignal = (signal: AbortSignal | undefined) => {
      if (signal === undefined) {
        return;
      }
      if (signal.aborted) {
        controller.abort();
        return;
      }

      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    };

    linkSignal(runOptions?.signal);
    linkSignal(deadlineController?.signal);

    if (requestTimeoutMs !== undefined) {
      const timer = setTimeout(() => {
        didRequestTimeout = true;
        controller.abort();
      }, requestTimeoutMs);
      cleanups.push(() => clearTimeout(timer));
    }

    return {
      signal: controller.signal,
      requestTimedOut: () => didRequestTimeout,
      dispose: () => cleanups.forEach((cleanup) => cleanup()),
    };
  };

  const dispose = () => {
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer);
    }
  };

  return {
    runtime,
    emit,
    waitForCheckpoint,
    sleepIfNeeded,
    sendRequest,
    sendMutatedRequest,
    detectAndEmitRequest,
    setKnownWafResponse,
    dispose,
  };
}

function emitResumedState(
  runOptions: RunOptions,
  request: EngineRequest,
): void {
  runOptions.onEvent?.({
    type: "state",
    state:
      getPhaseForRequest(request) === EnginePhase.Learning
        ? EngineState.Learning
        : EngineState.Running,
    phase: getPhaseForRequest(request),
  });
}

interface OperationSignal {
  signal: AbortSignal;
  requestTimedOut: () => boolean;
  dispose: () => void;
}

async function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw new Error("Operation aborted");
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("Operation aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function minimumDefined(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.min(left, right);
}

function isCloudflareChallenge(
  requestResponse: EngineRequestResponse,
): boolean {
  const { response } = requestResponse;
  return (
    response.status === 403 &&
    (response.body?.includes(CLOUDFLARE_CHALLENGE_TITLE) === true ||
      response.raw?.includes(CLOUDFLARE_CHALLENGE_TITLE) === true)
  );
}

function getPhaseForRequest(request: EngineRequest): EnginePhase {
  return request.context === "learning"
    ? EnginePhase.Learning
    : EnginePhase.Discovery;
}

function throwRequestTimeout(timeoutMs?: number, cause?: unknown): never {
  throw new EngineError(
    "PROVIDER_ERROR",
    timeoutMs === undefined
      ? "Request timed out"
      : `Request timed out after ${timeoutMs}ms`,
    { cause },
  );
}
