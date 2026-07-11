import type {
  EngineRequest,
  EngineRequestResponse,
  LoggerFn,
  RandomSource,
  SleepFn,
} from "./types";

export interface RequestProvider {
  send(
    request: EngineRequest,
    options?: RequestProviderSendOptions,
  ): Promise<EngineRequestResponse>;
}

export interface RequestProviderSendOptions {
  /** Cancellation signal for providers whose transport supports cancellation. */
  signal?: AbortSignal;
  /** Transport deadline that providers are expected to enforce. */
  timeoutMs?: number;
}

export interface EngineDependencies {
  provider: RequestProvider;
  sleep?: SleepFn;
  now?: () => number;
  random?: RandomSource;
  logger?: LoggerFn;
}

export async function defaultSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new Error("Aborted");
  }

  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error("Aborted"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
