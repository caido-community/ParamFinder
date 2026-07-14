import { describe, expect, it } from "vitest";

import { RunControl } from "./run-control";

describe("RunControl", () => {
  it("waits until resume is called", async () => {
    const control = new RunControl();
    control.pause();

    let resumed = false;
    const waiter = control.waitIfPaused().then(() => {
      resumed = true;
    });

    await Promise.resolve();
    expect(resumed).toBe(false);

    control.resume();
    await waiter;

    expect(resumed).toBe(true);
  });

  it("rejects if aborted while paused", async () => {
    const control = new RunControl();
    const controller = new AbortController();
    control.pause();

    const waiter = control.waitIfPaused(controller.signal);
    controller.abort();

    await expect(waiter).rejects.toThrow("Run aborted while paused");
  });
});
