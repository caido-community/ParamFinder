import { EngineError } from "./errors";

export class RunControl {
  private paused = false;
  private waiters = new Set<() => void>();

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    if (!this.paused) {
      return;
    }

    this.paused = false;
    const waiters = Array.from(this.waiters);
    this.waiters.clear();
    waiters.forEach((resolve) => resolve());
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public async waitIfPaused(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);

    if (!this.paused) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        cleanup();
        resolve();
      };

      const onAbort = () => {
        cleanup();
        reject(new EngineError("RUN_ABORTED", "Run aborted while paused"));
      };

      const cleanup = () => {
        this.waiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
      };

      this.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new EngineError("RUN_ABORTED", "Run aborted");
  }
}
