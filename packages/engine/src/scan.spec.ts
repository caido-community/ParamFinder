import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscoveryEvent } from "./events";
import { runDiscoveryScan, type ScanSummary } from "./scan";
import { AnomalyType, EnginePhase, EngineState } from "./types";

import type {
  BaselineProfile,
  EngineConfig,
  EngineRequest,
  EngineRequestResponse,
  Finding,
  RequestProvider,
} from "./index";

const { createDiscoveryEngineMock } = vi.hoisted(() => ({
  createDiscoveryEngineMock: vi.fn<
    () => {
      run: (input: {
        runOptions?: { onEvent?: (event: DiscoveryEvent) => void };
      }) => Promise<unknown>;
    }
  >(),
}));

vi.mock("./engine", () => ({
  createDiscoveryEngine: createDiscoveryEngineMock,
}));

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

function createProvider(): RequestProvider {
  return {
    async send(request): Promise<EngineRequestResponse> {
      const interesting = request.query.includes("secret");
      const body = interesting ? "interesting response" : "baseline response";

      return {
        request,
        response: {
          requestId: request.id,
          status: 200,
          headers: {},
          body,
          time: 10,
          raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
        },
      };
    },
  };
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
  };
}

function createFinding(parameter = "secret"): Finding {
  const requestResponse: EngineRequestResponse = {
    request: createBaseRequest(),
    response: {
      requestId: "request-1",
      status: 200,
      headers: {},
      body: "interesting response",
      time: 10,
      raw: "HTTP/1.1 200 OK\r\n\r\ninteresting response",
    },
  };

  return {
    requestResponse,
    parameter: {
      name: parameter,
      value: "value",
    },
    anomaly: {
      type: AnomalyType.Body,
      check: "content",
      expectedDiffCount: 0,
      actualDiffCount: 1,
    },
  };
}

beforeEach(() => {
  createDiscoveryEngineMock.mockReset();
});

describe("runDiscoveryScan", () => {
  it("maps raw engine events to scan events and tracks progress updates", async () => {
    const finding = createFinding();
    const rawEvents: DiscoveryEvent[] = [];
    const mappedEvents: string[] = [];
    const progressTotals: number[] = [];

    createDiscoveryEngineMock.mockReturnValue({
      run: async (input: {
        runOptions?: {
          onEvent?: (event: DiscoveryEvent) => void;
        };
      }) => {
        input.runOptions?.onEvent?.({
          type: "state",
          state: EngineState.Running,
          phase: EnginePhase.Discovery,
        });
        input.runOptions?.onEvent?.({
          type: "adjustTotalParameters",
          totalParametersAmount: 4,
        });
        input.runOptions?.onEvent?.({
          type: "request",
          parametersSent: 2,
          parametersTested: 2,
          context: "discovery",
          requestResponse: finding.requestResponse,
        });
        input.runOptions?.onEvent?.({
          type: "finding",
          finding,
        });
        input.runOptions?.onEvent?.({
          type: "completed",
          state: EngineState.Completed,
          phase: EnginePhase.Discovery,
          findings: [finding],
          totalParametersAmount: 4,
        });

        return {
          state: EngineState.Completed,
          phase: EnginePhase.Discovery,
          profile: createCompletedProfile(),
          findings: [finding],
          totalParametersAmount: 4,
        };
      },
    });

    const { result, summary } = await runDiscoveryScan(
      {
        provider: createProvider(),
        random: () => 0,
      },
      {
        request: createBaseRequest(),
        words: ["secret"],
        engineConfig: createConfig(),
        runOptions: {
          onEvent: (event) => {
            rawEvents.push(event);
          },
        },
      },
      {
        onEvent: (event) => {
          mappedEvents.push(event.type);
          if (event.type === "progress") {
            progressTotals.push(event.totalParametersAmount);
          }
        },
      },
    );

    expect(result.state).toBe(EngineState.Completed);
    expect(rawEvents.map((event) => event.type)).toEqual([
      "state",
      "adjustTotalParameters",
      "request",
      "finding",
      "completed",
    ]);
    expect(mappedEvents).toEqual([
      "state",
      "progress",
      "request",
      "finding",
      "summary",
    ]);
    expect(progressTotals).toEqual([4]);
    expect(summary.totalParametersAmount).toBe(4);
    expect(summary.requestsSent).toBe(1);
    expect(summary.parametersSent).toBe(2);
    expect(summary.findingsCount).toBe(1);
    expect(summary.findings[0]?.parameter).toBe("secret");
  });

  it("rebuilds finding summaries from the final result when finding events are missing", async () => {
    const finding = createFinding("admin");

    createDiscoveryEngineMock.mockReturnValue({
      run: async () => ({
        state: EngineState.Completed,
        phase: EnginePhase.Discovery,
        profile: createCompletedProfile(),
        findings: [finding],
        totalParametersAmount: 1,
      }),
    });

    const { summary } = await runDiscoveryScan(
      {
        provider: createProvider(),
        random: () => 0,
      },
      {
        request: createBaseRequest(),
        words: ["admin"],
        engineConfig: createConfig(),
      },
    );

    expect(summary.findingsCount).toBe(1);
    expect(summary.findings[0]).toMatchObject({
      parameter: "admin",
      responseStatus: 200,
    });
    expect(summary.findings[0]?.anomaly).toContain("BODY");
  });

  it("keeps partial findings consistent in canceled summaries", async () => {
    const finding = createFinding();
    createDiscoveryEngineMock.mockReturnValue({
      run: async (input: {
        runOptions?: { onEvent?: (event: DiscoveryEvent) => void };
      }) => {
        input.runOptions?.onEvent?.({ type: "finding", finding });
        input.runOptions?.onEvent?.({
          type: "completed",
          state: EngineState.Canceled,
          phase: EnginePhase.Discovery,
          findings: [finding],
          totalParametersAmount: 1,
        });
        return {
          state: EngineState.Canceled,
          phase: EnginePhase.Discovery,
          findings: [finding],
          totalParametersAmount: 1,
        };
      },
    });

    const summaries: ScanSummary[] = [];
    const { summary } = await runDiscoveryScan(
      { provider: createProvider() },
      {
        request: createBaseRequest(),
        words: ["secret"],
        engineConfig: createConfig(),
      },
      {
        onEvent: (event) => {
          if (event.type === "summary") summaries.push(event.summary);
        },
      },
    );

    expect(summary.findingsCount).toBe(1);
    expect(summaries[0]?.findingsCount).toBe(summary.findingsCount);
  });

  it.each([
    {
      name: "canceled",
      result: {
        state: EngineState.Canceled,
        phase: EnginePhase.Discovery,
        findings: [],
        totalParametersAmount: 2,
      },
    },
    {
      name: "timeout",
      result: {
        state: EngineState.Timeout,
        phase: EnginePhase.Discovery,
        profile: createCompletedProfile(),
        findings: [],
        totalParametersAmount: 2,
      },
    },
    {
      name: "error",
      result: {
        state: EngineState.Error,
        phase: EnginePhase.Discovery,
        profile: createCompletedProfile(),
        findings: [],
        totalParametersAmount: 2,
        failureReason: "provider failed",
      },
    },
  ])("builds a %s summary", async ({ result }) => {
    createDiscoveryEngineMock.mockReturnValue({
      run: async () => result,
    });

    const { summary } = await runDiscoveryScan(
      {
        provider: createProvider(),
        random: () => 0,
      },
      {
        request: createBaseRequest(),
        words: ["secret", "admin"],
        engineConfig: createConfig(),
      },
    );

    expect(summary.state).toBe(result.state);
    expect(
      summary.state === EngineState.Error ? summary.failureReason : undefined,
    ).toBe(result.state === EngineState.Error ? "provider failed" : undefined);
  });
});

function createCompletedProfile(): BaselineProfile {
  return {
    initialRequestResponse: {
      request: createBaseRequest(),
      response: {
        requestId: "request-1",
        status: 200,
        headers: {},
        body: "baseline response",
        time: 10,
        raw: "HTTP/1.1 200 OK\r\n\r\nbaseline response",
      },
    },
    stableFactors: {
      bodyStable: false,
      bodyLength: 17,
      bodyLengthStable: true,
      headersStable: true,
      statusCodeStable: true,
      reflectionStable: false,
      similarityStable: false,
      redirectStable: false,
      reflectionsCount: 0,
      statusCode: 200,
      unstableHeaders: [],
      similarity: 1,
    },
    bodyDiffReferenceCount: 0,
  };
}
