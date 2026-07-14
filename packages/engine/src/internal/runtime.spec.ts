import { describe, expect, it, vi } from "vitest";

import type { DiscoveryEvent } from "../events";
import { RunControl } from "../run-control";
import type {
  EngineRequest,
  EngineRequestResponse,
  EngineResponse,
} from "../types";

import { createEngineRuntime } from "./runtime";

const challengeTitle = "<title>Just a moment...</title>";

function createRequest(context: EngineRequest["context"] = "discovery") {
  return {
    id: "request-1",
    host: "example.com",
    port: 443,
    url: "https://example.com/test",
    path: "/test",
    query: "",
    method: "GET",
    headers: {},
    body: "",
    tls: true,
    raw: "GET /test HTTP/1.1\r\nHost: example.com\r\n\r\n",
    context,
  } satisfies EngineRequest;
}

function createResponse(
  request: EngineRequest,
  overrides: Partial<EngineResponse> = {},
): EngineRequestResponse {
  return {
    request,
    response: {
      requestId: request.id,
      status: 200,
      headers: {},
      body: "ok",
      length: 0,
      time: 1,
      ...overrides,
    },
  };
}

describe("Cloudflare challenge handling", () => {
  it("retries a Cloudflare challenge twice and returns a recovered response", async () => {
    const request = createRequest();
    const sleep = vi.fn(async () => undefined);
    let sends = 0;
    const runtime = createEngineRuntime({
      sleep,
      provider: {
        async send() {
          sends += 1;
          return sends < 3
            ? createResponse(request, {
                status: 403,
                body: `<html>${challengeTitle}</html>`,
              })
            : createResponse(request);
        },
      },
    });

    const result = await runtime.requests.sendRequest(request, { delayMs: 10 });

    expect(result.response.status).toBe(200);
    expect(sends).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it.each([
    { status: 403, body: "Forbidden" },
    { status: 200, body: challengeTitle },
  ])("requires both the 403 status and challenge title", async (response) => {
    const request = createRequest();
    let sends = 0;
    const runtime = createEngineRuntime({
      provider: {
        async send() {
          sends += 1;
          return createResponse(request, response);
        },
      },
    });

    await expect(runtime.requests.sendRequest(request)).resolves.toBeDefined();
    expect(sends).toBe(1);
    runtime.dispose();
  });

  it("pauses after two retries and sends nothing else until resumed", async () => {
    const request = createRequest("learning");
    const runControl = new RunControl();
    const events: DiscoveryEvent[] = [];
    let sends = 0;
    const runtime = createEngineRuntime({
      provider: {
        async send() {
          sends += 1;
          return sends <= 3
            ? createResponse(request, {
                status: 403,
                body: `<html>${challengeTitle}</html>`,
              })
            : createResponse(request);
        },
      },
    });

    const resultPromise = runtime.requests.sendRequest(request, {
      runControl,
      onEvent: (event) => events.push(event),
    });

    await vi.waitFor(() => expect(runControl.isPaused()).toBe(true));
    expect(sends).toBe(3);
    expect(events).toContainEqual({
      type: "state",
      state: "paused",
      phase: "learning",
    });
    expect(events).toContainEqual({
      type: "log",
      level: "warn",
      message:
        "Cloudflare WAF detected after 2 retries. Run paused; resolve the challenge, then resume.",
    });
    expect(events.slice(0, 2).map((event) => event.type)).toEqual([
      "log",
      "state",
    ]);

    await Promise.resolve();
    expect(sends).toBe(3);

    runControl.resume();
    await expect(resultPromise).resolves.toMatchObject({
      response: { status: 200 },
    });
    expect(sends).toBe(4);
    runtime.dispose();
  });

  it("stops after two retries when the run cannot be paused", async () => {
    const request = createRequest();
    let sends = 0;
    const runtime = createEngineRuntime({
      provider: {
        async send() {
          sends += 1;
          return createResponse(request, {
            status: 403,
            body: `<html>${challengeTitle}</html>`,
          });
        },
      },
    });

    await expect(runtime.requests.sendRequest(request)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message:
        "Cloudflare WAF detected after 2 retries. Run stopped because pausing is unavailable.",
    });
    expect(sends).toBe(3);
    runtime.dispose();
  });
});

describe("request pacing and rate limiting", () => {
  it("paces consecutive provider requests centrally", async () => {
    const request = createRequest();
    const sleep = vi.fn(async () => undefined);
    const runtime = createEngineRuntime({
      sleep,
      provider: {
        async send() {
          return createResponse(request);
        },
      },
    });

    await runtime.requests.sendRequest(request, { delayMs: 25 });
    await runtime.requests.sendRequest(request, { delayMs: 25 });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(25, expect.any(AbortSignal));
    runtime.dispose();
  });

  it("fails immediately on a 429 when pausing is unavailable", async () => {
    const request = createRequest();
    let sends = 0;
    const runtime = createEngineRuntime({
      provider: {
        async send() {
          sends += 1;
          return createResponse(request, { status: 429 });
        },
      },
    });

    await expect(runtime.requests.sendRequest(request)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message:
        "Rate limited with HTTP 429. Run stopped because pausing is unavailable.",
    });
    expect(sends).toBe(1);
    runtime.dispose();
  });

  it("pauses a 429 request and retries it only after resume", async () => {
    const request = createRequest();
    const runControl = new RunControl();
    const events: DiscoveryEvent[] = [];
    let sends = 0;
    const runtime = createEngineRuntime({
      provider: {
        async send() {
          sends += 1;
          return createResponse(request, { status: sends === 1 ? 429 : 200 });
        },
      },
    });

    const resultPromise = runtime.requests.sendRequest(request, {
      runControl,
      onEvent: (event) => events.push(event),
    });
    await vi.waitFor(() => expect(runControl.isPaused()).toBe(true));
    expect(sends).toBe(1);
    expect(events.slice(0, 2).map((event) => event.type)).toEqual([
      "state",
      "log",
    ]);

    runControl.resume();
    await expect(resultPromise).resolves.toMatchObject({
      response: { status: 200 },
    });
    expect(sends).toBe(2);
    expect(events).toContainEqual({
      type: "state",
      state: "running",
      phase: "discovery",
    });
    runtime.dispose();
  });
});
