import { describe, expect, it } from "vitest";

import { createDiscoveryEngine } from "./engine";
import type { DiscoveryEvent } from "./events";
import { RunControl } from "./run-control";
import { AnomalyType } from "./types";

import type {
  BaselineProfile,
  EngineConfig,
  EngineDependencies,
  EngineRequest,
  EngineRequestResponse,
  RequestProvider,
} from "./index";

function createBaseRequest(): EngineRequest {
  return {
    id: "request-1",
    host: "example.com",
    port: 443,
    url: "https://example.com/test",
    path: "/test",
    query: "",
    method: "GET",
    headers: {
      Host: ["example.com"],
    },
    body: "",
    tls: true,
    raw: "GET /test HTTP/1.1\r\nHost: example.com\r\n\r\n",
    context: "discovery",
  };
}

function createJsonBodyRequest(): EngineRequest {
  return {
    ...createBaseRequest(),
    method: "POST",
    headers: {
      Host: ["example.com"],
      "Content-Type": ["application/json"],
      "Content-Length": ["2"],
    },
    body: "{}",
    raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
  };
}

function createProvider(): RequestProvider {
  return {
    async send(request): Promise<EngineRequestResponse> {
      const interesting =
        request.query.includes("secret") ||
        request.raw.includes("secret") ||
        request.body.includes("secret");

      const body = interesting ? "interesting response" : "baseline response";
      return {
        request,
        response: {
          requestId: request.id,
          status: 200,
          headers: {},
          body,
          length: 0,
          time: 10,
          raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
        },
      };
    },
  };
}

function createResponse(request: EngineRequest): EngineRequestResponse {
  return {
    request,
    response: {
      requestId: request.id,
      status: 200,
      headers: {},
      body: "baseline response",
      length: 0,
      time: 1,
    },
  };
}

function createTestEngine(dependencies: EngineDependencies) {
  return createDiscoveryEngine({
    sleep: async () => undefined,
    ...dependencies,
  });
}

function createConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return {
    attackType: "query",
    learnRequestsCount: 3,
    autoDetectMaxSize: false,
    maxQuerySize: 200,
    updateContentLength: false,
    addCacheBusterParameter: false,
    wafDetection: false,
    ignoreCloudflareBlocks: false,
    additionalChecks: false,
    ignoreAnomalyTypes: [],
    ...overrides,
    autopilotEnabled: overrides?.autopilotEnabled ?? false,
    customValueType: overrides?.customValueType ?? "string",
  };
}

function createSequentialRandom(): () => number {
  let index = 0;

  return () => {
    const value = (index % 36) / 36;
    index += 1;
    return value;
  };
}

function createReflectionProfile(): BaselineProfile {
  return {
    initialRequestResponse: {
      request: createBaseRequest(),
      response: {
        requestId: "request-1",
        status: 200,
        headers: {},
        body: "baseline response",
        length: 0,
        time: 10,
        raw: "HTTP/1.1 200 OK\r\n\r\nbaseline response",
      },
    },
    stableFactors: {
      bodyStable: false,
      bodyLength: "baseline response".length,
      bodyLengthStable: false,
      headersStable: true,
      statusCodeStable: true,
      reflectionStable: true,
      similarityStable: false,
      redirectStable: true,
      reflectionsCount: 0,
      statusCode: 200,
      unstableHeaders: [],
      similarity: 1,
    },
    bodyDiffReferenceCount: 0,
  };
}

describe("createDiscoveryEngine", () => {
  it("finds a parameter through the full run flow", async () => {
    const events: DiscoveryEvent[] = [];
    const engine = createTestEngine({
      provider: createProvider(),
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["alpha", "secret"],
      engineConfig: createConfig(),
      runOptions: {
        onEvent: (event) => events.push(event),
      },
    });

    expect(result.state).toBe("completed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.parameter.name).toBe("secret");
    expect(events.some((event) => event.type === "finding")).toBe(true);
  });

  it("verifies reflected parameters directly without narrowing the chunk", async () => {
    const events: DiscoveryEvent[] = [];
    const sentRequests: EngineRequest[] = [];
    const reflectedParameterNames = new Set(["name", "token"]);
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          sentRequests.push(request);

          const params = new URLSearchParams(request.query);
          const reflectedValues = Array.from(reflectedParameterNames)
            .map((parameterName) => params.get(parameterName) ?? undefined)
            .filter((value) => value !== undefined);
          const body =
            reflectedValues.length === 0
              ? "baseline response"
              : `reflected ${reflectedValues.join(" ")}`;

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: createSequentialRandom(),
    });

    const result = await engine.discover({
      request: createBaseRequest(),
      words: ["alpha", "name", "token"],
      engineConfig: createConfig({
        maxQuerySize: 1000,
      }),
      profile: createReflectionProfile(),
      runOptions: {
        onEvent: (event) => events.push(event),
      },
    });

    const narrowerRequests = sentRequests.filter(
      (request) => request.context === "narrower",
    );
    const narrowerRequestParameterNames = narrowerRequests.map((request) =>
      Array.from(new URLSearchParams(request.query).keys()),
    );
    const logMessages = events
      .filter((event) => event.type === "log")
      .map((event) => event.message);

    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((finding) => finding.parameter.name)).toEqual([
      "name",
      "token",
    ]);
    expect(
      result.findings.every(
        (finding) => finding.anomaly.type === AnomalyType.ReflectionCount,
      ),
    ).toBe(true);
    expect(narrowerRequestParameterNames).toEqual([
      [],
      ["name"],
      [],
      [],
      ["token"],
      [],
      [],
      ["alpha"],
      [],
    ]);
    expect(
      logMessages.some((message) => message.includes("Narrowing down chunk")),
    ).toBe(false);
    expect(
      events.find(
        (event) =>
          event.type === "log" &&
          event.message.includes('Verifying candidate parameter "name"'),
      ),
    ).toMatchObject({ level: "info" });
  });

  it("still finds non-reflected parameters in a reflected chunk", async () => {
    const profile = createReflectionProfile();
    profile.stableFactors.bodyStable = true;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const params = new URLSearchParams(request.query);
          const parts: string[] = [];
          const reflectedValue = params.get("name");
          if (reflectedValue) parts.push(`reflected ${reflectedValue}`);
          if (params.has("secret")) parts.push("secret response");
          const body = parts.length > 0 ? parts.join(" ") : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: createSequentialRandom(),
    });

    const result = await engine.discover({
      request: createBaseRequest(),
      words: ["name", "secret"],
      engineConfig: createConfig({ maxQuerySize: 1000 }),
      profile,
    });

    expect(result.findings.map((finding) => finding.parameter.name)).toEqual([
      "name",
      "secret",
    ]);
  });

  it("verifies lower-priority anomalies when status changes are ignored", async () => {
    const profile = createReflectionProfile();
    profile.stableFactors.bodyStable = true;
    profile.stableFactors.reflectionStable = false;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const interesting = new URLSearchParams(request.query).has("secret");
          const body = interesting
            ? "interesting response"
            : "baseline response";
          return {
            request,
            response: {
              requestId: request.id,
              status: interesting ? 500 : 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 ${interesting ? 500 : 200} OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.discover({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig({
        ignoreAnomalyTypes: [AnomalyType.StatusCode],
      }),
      profile,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.anomaly.type).toBe(AnomalyType.Body);
  });

  it("drops a finding when the control request also changes during verification", async () => {
    let sawVerifiedAnomaly = false;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isSecret = request.query.includes("secret");
          const isNarrower = request.context === "narrower";

          if (isSecret && isNarrower) {
            sawVerifiedAnomaly = true;
          }

          const body =
            !isSecret && isNarrower && sawVerifiedAnomaly
              ? "ambient drift response"
              : isSecret
                ? "interesting response"
                : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
    });

    expect(result.state).toBe("completed");
    expect(result.findings).toHaveLength(0);
  });

  it("keeps a finding when controls drift but the candidate still stands out", async () => {
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isSecret = request.query.includes("secret");
          const body =
            request.context === "narrower"
              ? isSecret
                ? "interesting response with a much stronger change"
                : "ambient drift response"
              : isSecret
                ? "interesting response with a much stronger change"
                : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
    });

    expect(result.state).toBe("completed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.parameter.name).toBe("secret");
  });

  it("still drops a finding when the candidate and both controls drift the same way", async () => {
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isSecret = request.query.includes("secret");
          const body =
            request.context === "narrower"
              ? "ambient drift response"
              : isSecret
                ? "interesting response"
                : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
    });

    expect(result.state).toBe("completed");
    expect(result.findings).toHaveLength(0);
  });

  it("keeps a status finding when the surrounding controls have unrelated body drift", async () => {
    let controlCount = 0;
    const profile = createReflectionProfile();
    profile.stableFactors.bodyStable = true;
    profile.stableFactors.reflectionStable = false;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isSecret = new URLSearchParams(request.query).has("secret");
          let body = "baseline response";
          if (request.context === "narrower" && !isSecret) {
            controlCount += 1;
            body = `ambient control ${controlCount}`;
          }

          return {
            request,
            response: {
              requestId: request.id,
              status: isSecret ? 500 : 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 ${isSecret ? 500 : 200} OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: createSequentialRandom(),
    });

    const result = await engine.discover({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig({ maxParametersAmount: 1 }),
      profile,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.parameter.name).toBe("secret");
    expect(result.findings[0]?.anomaly.type).toBe(AnomalyType.StatusCode);
  });

  it("reduces discovery chunks when matched random canaries reproduce the anomaly", async () => {
    const events: DiscoveryEvent[] = [];
    const profile = createReflectionProfile();
    profile.stableFactors.bodyStable = true;
    profile.stableFactors.reflectionStable = false;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const query = new URLSearchParams(request.query);
          const isSecret = query.has("secret");
          const genericManyParameterResponse = query.size > 1;
          const body = genericManyParameterResponse
            ? "generic many-parameter response"
            : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: isSecret ? 500 : 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 ${isSecret ? 500 : 200} OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: createSequentialRandom(),
    });

    const result = await engine.discover({
      request: createBaseRequest(),
      words: ["alpha", "beta", "secret"],
      engineConfig: createConfig({
        maxQuerySize: 1000,
        maxParametersAmount: 3,
      }),
      profile,
      runOptions: { onEvent: (event) => events.push(event) },
    });

    expect(result.findings.map((finding) => finding.parameter.name)).toEqual([
      "secret",
    ]);
    expect(
      events.some(
        (event) =>
          event.type === "log" &&
          event.message.includes("reducing discovery chunks to 1 parameter"),
      ),
    ).toBe(true);
  });

  it("refreshes a stale baseline from dedicated canaries before discovery", async () => {
    const events: DiscoveryEvent[] = [];
    const profile = createReflectionProfile();
    profile.stableFactors.bodyStable = true;
    profile.stableFactors.reflectionStable = false;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isSecret = new URLSearchParams(request.query).has("secret");
          const body = "new baseline response";
          return {
            request,
            response: {
              requestId: request.id,
              status: isSecret ? 500 : 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 ${isSecret ? 500 : 200} OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: createSequentialRandom(),
    });

    const result = await engine.discover({
      request: createBaseRequest(),
      words: ["alpha", "secret"],
      engineConfig: createConfig({ maxParametersAmount: 1 }),
      profile,
      runOptions: { onEvent: (event) => events.push(event) },
    });

    expect(result.findings.map((finding) => finding.parameter.name)).toEqual([
      "secret",
    ]);
    expect(profile.initialRequestResponse.response.body).toBe(
      "new baseline response",
    );
    expect(
      events.some(
        (event) =>
          event.type === "log" &&
          event.message.includes("Baseline drift detected during calibration"),
      ),
    ).toBe(true);
  });

  it("rejects a finding when the control window disagrees in different ways", async () => {
    let narrowerRequestCount = 0;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isSecret = request.query.includes("secret");

          if (request.context === "narrower") {
            narrowerRequestCount += 1;
            if (narrowerRequestCount === 3) {
              const body = "baseline response";
              return {
                request,
                response: {
                  requestId: request.id,
                  status: 200,
                  headers: {
                    "X-Drift": ["1"],
                  },
                  body,
                  length: 0,
                  time: 10,
                  raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
                },
              };
            }

            const body =
              narrowerRequestCount === 2
                ? "interesting response with a much stronger change"
                : "baseline response";

            return {
              request,
              response: {
                requestId: request.id,
                status: 200,
                headers: {},
                body,
                length: 0,
                time: 10,
                raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
              },
            };
          }

          const body = isSecret
            ? "interesting response with a much stronger change"
            : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
    });

    expect(result.state).toBe("completed");
    expect(result.findings).toHaveLength(0);
  });

  it("supports pause and resume through run control", async () => {
    const control = new RunControl();
    control.pause();

    const engine = createTestEngine({
      provider: createProvider(),
      random: () => 0,
    });

    const runPromise = engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
      runOptions: {
        runControl: control,
      },
    });

    await Promise.resolve();
    control.resume();
    const result = await runPromise;

    expect(result.state).toBe("completed");
  });

  it("stops at the response boundary when paused during a request", async () => {
    const control = new RunControl();
    let sends = 0;
    let releaseFirstSend!: () => void;
    let markFirstSendStarted!: () => void;
    const firstSendStarted = new Promise<void>((resolve) => {
      markFirstSendStarted = resolve;
    });
    const firstSendBlocked = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });

    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          sends += 1;
          if (sends === 1) {
            markFirstSendStarted();
            await firstSendBlocked;
          }
          return createResponse(request);
        },
      },
      random: () => 0,
    });

    const runPromise = engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
      runOptions: { runControl: control },
    });

    await firstSendStarted;
    control.pause();
    releaseFirstSend();
    await Promise.resolve();
    await Promise.resolve();

    expect(sends).toBe(1);

    control.resume();
    const result = await runPromise;
    expect(result.state).toBe("completed");
    expect(sends).toBeGreaterThan(1);
  });

  it("detects a WAF response and suppresses matching blocked responses", async () => {
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isWafPattern =
            request.query.includes("%2Fetc%2Fpasswd") ||
            request.query.includes(".htaccess");
          const isBlockedPayload = request.query.includes("secret");
          const body =
            isWafPattern || isBlockedPayload
              ? "waf blocked"
              : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig({
        wafDetection: true,
      }),
    });

    expect(result.state).toBe("completed");
    expect(result.profile?.wafResponse?.body).toBe("waf blocked");
    expect(result.findings).toHaveLength(0);
  });

  it("does not learn ordinary reflection as a WAF response", async () => {
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const testValue = new URLSearchParams(request.query).get("test");
          const body = testValue
            ? `baseline response ${testValue}`
            : "baseline response";
          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: [],
      engineConfig: createConfig({ wafDetection: true }),
    });

    expect(result.state).toBe("completed");
    expect(result.profile?.wafResponse).toBeUndefined();
  });

  it("moves on when a payload triggers a learned Cloudflare WAF response", async () => {
    const events: DiscoveryEvent[] = [];
    const runControl = new RunControl();
    const cloudflareBody =
      "<html><head><title>Just a moment...</title></head><body>blocked</body></html>";
    let cloudflareResponses = 0;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const isWafProbe =
            request.context === "learning" &&
            (request.query.includes("test=%2Fetc%2Fpasswd") ||
              request.query.includes("test=.htaccess"));
          const isBlockedPayload =
            request.context === "discovery" &&
            request.query.includes("onerror=");
          const blocked = isWafProbe || isBlockedPayload;
          if (blocked) cloudflareResponses += 1;

          const body = blocked ? cloudflareBody : "baseline response";
          return {
            request,
            response: {
              requestId: request.id,
              status: blocked ? 403 : 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 ${blocked ? "403 Forbidden" : "200 OK"}\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["onerror"],
      engineConfig: createConfig({ wafDetection: true }),
      runOptions: {
        runControl,
        onEvent: (event) => events.push(event),
      },
    });

    expect(result.state).toBe("completed");
    expect(result.profile?.wafResponse).toMatchObject({
      status: 403,
      body: cloudflareBody,
    });
    expect(result.findings).toHaveLength(0);
    expect(cloudflareResponses).toBe(3);
    expect(runControl.isPaused()).toBe(false);
    expect(
      events.some(
        (event) => event.type === "state" && event.state === "paused",
      ),
    ).toBe(false);
  });

  it("skips ineffective WAF probes for integer body scans", async () => {
    const wafProbeBodies: string[] = [];
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          if (
            request.context === "learning" &&
            request.body.includes('"test":12345678')
          ) {
            wafProbeBodies.push(request.body);
          }

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body: "",
              length: 0,
              time: 10,
              raw: "HTTP/1.1 200 OK\r\n\r\n",
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createJsonBodyRequest(),
      words: [],
      engineConfig: createConfig({
        attackType: "body",
        maxBodySize: 200,
        updateContentLength: true,
        wafDetection: true,
        customValueType: "integer",
      }),
    });

    expect(result.state).toBe("completed");
    expect(result.findings).toHaveLength(0);
    expect(wafProbeBodies).toEqual([]);
  });

  it("requires matching responses from distinct WAF probes", async () => {
    const wafProbeQueries: string[] = [];
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          if (
            request.context === "learning" &&
            request.query.includes("test=")
          ) {
            wafProbeQueries.push(request.query);
          }

          const body =
            request.query.includes("javascript%3Aalert") ||
            request.query.includes("onload%3Dalert")
              ? "waf blocked"
              : "";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: [],
      engineConfig: createConfig({
        wafDetection: true,
      }),
    });

    expect(result.state).toBe("completed");
    expect(result.profile?.wafResponse?.body).toBe("waf blocked");
    expect(wafProbeQueries).toEqual([
      "test=%2Fetc%2Fpasswd",
      "test=.htaccess",
      "test=javascript%3Aalert",
      "test=onload%3Dalert",
    ]);
  });

  it("keeps integer additional-check payloads numeric for body scans", async () => {
    const additionalCheckBodies: string[] = [];
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          if (
            request.context === "learning" &&
            request.body.includes("paramFinder")
          ) {
            additionalCheckBodies.push(request.body);
          }

          const body = request.body.includes("paramFinder[]")
            ? "special characters rejected"
            : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createJsonBodyRequest(),
      words: ["alpha"],
      engineConfig: createConfig({
        attackType: "body",
        maxBodySize: 200,
        updateContentLength: true,
        additionalChecks: true,
        customValueType: "integer",
      }),
    });

    expect(result.state).toBe("completed");
    expect(additionalCheckBodies).toEqual([
      '{"paramFinder[]":12345678}',
      '{"paramFinder%5B%5D":12345678}',
    ]);
  });

  it("avoids null JSON values across all learning requests in integer body mode", async () => {
    const learningBodies: string[] = [];
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          if (request.context === "learning" && request.body) {
            learningBodies.push(request.body);
          }

          const body = request.body.includes("paramFinder[]")
            ? "special characters rejected"
            : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createJsonBodyRequest(),
      words: ["alpha"],
      engineConfig: createConfig({
        attackType: "body",
        autoDetectMaxSize: true,
        maxQuerySize: undefined,
        updateContentLength: true,
        wafDetection: true,
        additionalChecks: true,
        customValueType: "integer",
      }),
    });

    expect(result.state).toBe("completed");
    expect(learningBodies.length).toBeGreaterThan(0);
    expect(learningBodies.every((body) => !body.includes(":null"))).toBe(true);
  });

  it("autopilot shrinks max query size after a 414 response", async () => {
    const events: DiscoveryEvent[] = [];
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`);
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          const status = request.query.length > 600 ? 414 : 200;
          const body = status === 414 ? "uri too long" : "baseline response";

          return {
            request,
            response: {
              requestId: request.id,
              status,
              headers: {},
              body,
              length: 0,
              time: 10,
              raw: `HTTP/1.1 ${status} ${status === 414 ? "URI Too Long" : "OK"}\r\n\r\n${body}`,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words,
      engineConfig: createConfig({
        maxQuerySize: 2000,
        autopilotEnabled: true,
      }),
      runOptions: {
        onEvent: (event) => events.push(event),
      },
    });

    expect(result.state).toBe("completed");
    expect(result.profile?.maxSize).toBe(500);
    expect(
      events.some(
        (event) =>
          event.type === "log" &&
          event.message.includes("Adjusting max URL size to 500"),
      ),
    ).toBe(true);
  });

  it("treats a per-request timeout as a provider error", async () => {
    let receivedTimeout: number | undefined;
    const engine = createTestEngine({
      provider: {
        async send(_request, options): Promise<EngineRequestResponse> {
          receivedTimeout = options?.timeoutMs;
          return await new Promise<EngineRequestResponse>(
            (_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(new Error("provider aborted")),
                { once: true },
              );
            },
          );
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["alpha", "secret"],
      engineConfig: createConfig(),
      runOptions: {
        requestTimeoutMs: 10,
        timeoutMs: 1_000,
      },
    });

    expect(receivedTimeout).toBe(10);
    expect(result.state).toBe("error");
    if (result.state !== "error") {
      throw new Error(`Expected error result, got ${result.state}`);
    }
    expect(result.phase).toBe("learning");
    expect(result.failureReason).toContain("Request timed out after 10ms");
  });

  it("enforces the overall deadline during a learning request", async () => {
    let receivedTimeout: number | undefined;
    const engine = createTestEngine({
      provider: {
        async send(_request, options): Promise<EngineRequestResponse> {
          receivedTimeout = options?.timeoutMs;
          return await new Promise<EngineRequestResponse>(
            (_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(new Error("provider aborted")),
                { once: true },
              );
            },
          );
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["alpha"],
      engineConfig: createConfig(),
      runOptions: { requestTimeoutMs: 1_000, timeoutMs: 10 },
    });

    expect(receivedTimeout).toBeGreaterThan(0);
    expect(receivedTimeout).toBeLessThanOrEqual(10);
    expect(result).toMatchObject({
      state: "timeout",
      phase: "learning",
      profile: undefined,
    });
  });

  it("enforces the same overall deadline during discovery", async () => {
    let requestCount = 0;
    const engine = createTestEngine({
      provider: {
        async send(request, options): Promise<EngineRequestResponse> {
          requestCount += 1;
          if (requestCount > 3) {
            return await new Promise<EngineRequestResponse>(
              (_resolve, reject) => {
                options?.signal?.addEventListener(
                  "abort",
                  () => reject(new Error("provider aborted")),
                  { once: true },
                );
              },
            );
          }
          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body: "baseline response",
              length: 0,
              time: 1,
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["alpha"],
      engineConfig: createConfig(),
      runOptions: { timeoutMs: 20 },
    });

    expect(result.state).toBe("timeout");
    expect(result.phase).toBe("discovery");
    expect(result.profile).toBeDefined();
  });

  it("enforces the overall deadline while paused", async () => {
    const runControl = new RunControl();
    runControl.pause();
    let sends = 0;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          sends += 1;
          return createResponse(request);
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["alpha"],
      engineConfig: createConfig(),
      runOptions: { runControl, timeoutMs: 10 },
    });

    expect(result).toMatchObject({ state: "timeout", phase: "learning" });
    expect(sends).toBe(0);
  });

  it("enforces the overall deadline during a delay even if sleep ignores abort", async () => {
    const engine = createTestEngine({
      provider: createProvider(),
      random: () => 0,
      sleep: async () => await new Promise<void>(() => {}),
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["alpha"],
      engineConfig: createConfig(),
      runOptions: { delayMs: 1_000, timeoutMs: 10 },
    });

    expect(result).toMatchObject({ state: "timeout", phase: "learning" });
  });

  it("cancels promptly while a provider send is in flight", async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const engine = createTestEngine({
      provider: {
        async send(_request, options): Promise<EngineRequestResponse> {
          markStarted?.();
          return await new Promise<EngineRequestResponse>(
            (_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(new Error("provider aborted")),
                { once: true },
              );
            },
          );
        },
      },
      random: () => 0,
    });

    const run = engine.run({
      request: createBaseRequest(),
      words: ["alpha"],
      engineConfig: createConfig(),
      runOptions: { signal: controller.signal },
    });
    await started;
    controller.abort();

    await expect(run).resolves.toMatchObject({
      state: "canceled",
      phase: "learning",
    });
  });

  it("retains confirmed findings when canceled during discovery", async () => {
    const controller = new AbortController();
    const events: DiscoveryEvent[] = [];
    const engine = createTestEngine({
      provider: createProvider(),
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
      runOptions: {
        signal: controller.signal,
        onEvent: (event) => {
          events.push(event);
          if (event.type === "finding") controller.abort();
        },
      },
    });

    expect(result.state).toBe("canceled");
    expect(result.findings.map((finding) => finding.parameter.name)).toEqual([
      "secret",
    ]);
    expect(events.find((event) => event.type === "completed")).toMatchObject({
      state: "canceled",
      findings: [{ parameter: { name: "secret" } }],
    });
    expect(events.slice(-2).map((event) => event.type)).toEqual([
      "state",
      "completed",
    ]);
  });

  it("returns an error result when the provider fails mid-run", async () => {
    const events: DiscoveryEvent[] = [];
    let requestCount = 0;
    const engine = createTestEngine({
      provider: {
        async send(request): Promise<EngineRequestResponse> {
          requestCount += 1;
          if (requestCount === 4) {
            throw new Error("socket hang up");
          }

          return {
            request,
            response: {
              requestId: request.id,
              status: 200,
              headers: {},
              body: "baseline response",
              length: 0,
              time: 10,
              raw: "HTTP/1.1 200 OK\r\n\r\nbaseline response",
            },
          };
        },
      },
      random: () => 0,
    });

    const result = await engine.run({
      request: createBaseRequest(),
      words: ["secret"],
      engineConfig: createConfig(),
      runOptions: {
        onEvent: (event) => events.push(event),
      },
    });

    expect(result.state).toBe("error");
    expect(result.phase).toBe("discovery");
    if (result.state !== "error") {
      throw new Error("Expected failed engine run result");
    }
    expect(result.failureReason).toContain("Request provider failed");
    expect(result.failureReason).toContain("socket hang up");
    expect(
      events.some(
        (event) => event.type === "completed" && event.state === "error",
      ),
    ).toBe(true);
    expect(events.slice(-2).map((event) => event.type)).toEqual([
      "state",
      "completed",
    ]);
  });
});
