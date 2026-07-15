import { describe, expect, it } from "vitest";

import {
  createEngineConfig,
  parseDiscoverInput,
  parseEngineConfig,
  parseLearnInput,
  parseRunInput,
} from "./config";
import { EngineError } from "./errors";
import { RunControl } from "./run-control";
import type { BaselineProfile, EngineConfig, EngineRequest } from "./types";

function createRequest(): EngineRequest {
  return {
    id: "request-1",
    host: "example.com",
    port: 443,
    url: "https://example.com/test",
    path: "/test",
    query: "",
    method: "POST",
    headers: {
      Host: ["example.com"],
      "Content-Type": ["application/json"],
      "Content-Length": ["2"],
    },
    body: "{}",
    tls: true,
    raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
    context: "discovery",
  };
}

function createConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return {
    attackType: "query",
    learnRequestsCount: 3,
    autoDetectMaxSize: false,
    maxQuerySize: 128,
    updateContentLength: false,
    addCacheBusterParameter: true,
    wafDetection: true,
    ignoreCloudflareBlocks: false,
    additionalChecks: true,
    ignoreAnomalyTypes: [],
    ...overrides,
    autopilotEnabled: overrides?.autopilotEnabled ?? false,
    customValueType: overrides?.customValueType ?? "string",
  };
}

function createProfile(): BaselineProfile {
  return {
    initialRequestResponse: {
      request: createRequest(),
      response: {
        status: 200,
        headers: {},
        body: "{}",
        length: 0,
        time: 12,
        raw: "HTTP/1.1 200 OK\r\n\r\n{}",
      },
    },
    stableFactors: {
      bodyStable: true,
      bodyLengthStable: true,
      statusCodeStable: true,
      reflectionStable: false,
      similarityStable: true,
      redirectStable: false,
      reflectionsCount: 0,
      unstableHeaders: [],
    },
    bodyDiffReferenceCount: 0,
    bodyKind: "json",
  };
}

describe("config parsing", () => {
  it("creates SDK defaults for query attacks", () => {
    expect(createEngineConfig()).toEqual({
      attackType: "query",
      learnRequestsCount: 6,
      autoDetectMaxSize: true,
      updateContentLength: false,
      autopilotEnabled: true,
      addCacheBusterParameter: true,
      wafDetection: true,
      ignoreCloudflareBlocks: false,
      additionalChecks: true,
      ignoreAnomalyTypes: [],
      customValueType: "string",
    });
  });

  it("uses body-specific defaults when creating config overrides", () => {
    expect(
      createEngineConfig({
        attackType: "body",
      }),
    ).toMatchObject({
      attackType: "body",
      updateContentLength: true,
      autopilotEnabled: false,
    });
  });

  it("rejects explicit max sizes when auto-detect is enabled", () => {
    expect(() =>
      parseEngineConfig(
        createConfig({
          autoDetectMaxSize: true,
          maxQuerySize: 256,
        }),
      ),
    ).toThrowError(
      "Cannot set explicit max size values when autoDetectMaxSize is enabled",
    );
  });

  it("rejects invalid SDK defaults during builder creation", () => {
    expect(() =>
      createEngineConfig({
        autoDetectMaxSize: true,
        maxQuerySize: 256,
      }),
    ).toThrowError(
      "Cannot set explicit max size values when autoDetectMaxSize is enabled",
    );
  });

  it("rejects integer value generation combined with a custom value", () => {
    expect(() =>
      parseEngineConfig(
        createConfig({
          customValue: "prefix-",
          customValueType: "integer",
        }),
      ),
    ).toThrowError("Cannot set customValue when customValueType is integer");
  });

  it("rejects malformed or unsafe JSON body paths", () => {
    for (const jsonBodyPath of ["$broken", "$.a..b", "$.__proto__.value"]) {
      expect(() =>
        parseEngineConfig(createConfig({ jsonBodyPath })),
      ).toThrowError("Invalid JSON body path");
    }
  });

  it("parses a valid run input including run options", () => {
    const controller = new AbortController();
    const runControl = new RunControl();
    const onEvent = () => {};

    const parsed = parseRunInput({
      request: createRequest(),
      words: ["alpha", "beta"],
      engineConfig: createConfig(),
      runOptions: {
        delayMs: 25,
        requestTimeoutMs: 500,
        timeoutMs: 2000,
        signal: controller.signal,
        runControl,
        onEvent,
      },
    });

    expect(parsed.words).toEqual(["alpha", "beta"]);
    expect(parsed.engineConfig.attackType).toBe("query");
    expect(parsed.runOptions).toMatchObject({
      delayMs: 25,
      requestTimeoutMs: 500,
      timeoutMs: 2000,
      signal: controller.signal,
      runControl,
      onEvent,
    });
  });

  it("rejects invalid run option handlers with INVALID_RUN_OPTIONS", () => {
    const error = captureThrownEngineError(() =>
      parseRunInput({
        request: createRequest(),
        words: ["alpha"],
        engineConfig: createConfig(),
        runOptions: {
          onEvent: "not-a-function",
        },
      }),
    );

    expect(error.code).toBe("INVALID_RUN_OPTIONS");
    expect(error.message).toContain("Expected an event handler function");
  });

  it("rejects invalid request and overall timeouts", () => {
    for (const runOptions of [
      { requestTimeoutMs: 0 },
      { requestTimeoutMs: 1.5 },
      { timeoutMs: -1 },
    ]) {
      const error = captureThrownEngineError(() =>
        parseRunInput({
          request: createRequest(),
          words: ["alpha"],
          engineConfig: createConfig(),
          runOptions,
        }),
      );

      expect(error.code).toBe("INVALID_RUN_OPTIONS");
    }
  });

  it("rejects malformed learn input requests with INVALID_REQUEST", () => {
    const error = captureThrownEngineError(() =>
      parseLearnInput({
        request: {
          ...createRequest(),
          port: 0,
        },
        engineConfig: createConfig(),
      }),
    );

    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.message).toContain("port");
  });

  it("rejects invalid discover profiles and reports the profile path", () => {
    const error = captureThrownEngineError(() =>
      parseDiscoverInput({
        request: createRequest(),
        words: ["alpha"],
        engineConfig: createConfig(),
        profile: {
          ...createProfile(),
          stableFactors: {
            ...createProfile().stableFactors,
            reflectionsCount: -1,
          },
        },
      }),
    );

    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.message).toContain("discover input profile");
  });
});

function captureThrownEngineError(callback: () => unknown): EngineError {
  try {
    callback();
  } catch (error) {
    if (error instanceof EngineError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected callback to throw an EngineError");
}
