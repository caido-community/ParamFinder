import { describe, expect, it } from "vitest";

import {
  applyAdditionalChecks,
  deriveBaselineProfile,
  extractWordsFromResponseBody,
  generateLearningParameters,
  getSizeProbeConfig,
} from "./learn";
import type { EngineRequestResponse, Parameter } from "./types";
import { MAX_HEURISTIC_BODY_LENGTH } from "./utils";

function createRequestResponse(
  body: string,
  parameters: Parameter[] = [],
  headers: EngineRequestResponse["response"]["headers"] = {},
): { requestResponse: EngineRequestResponse; parameters: Parameter[] } {
  return {
    requestResponse: {
      request: {
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
        context: "learning",
      },
      response: {
        requestId: "request-1",
        status: 200,
        headers,
        body,
        length: 0,
        time: 10,
        raw: `HTTP/1.1 200 OK\r\n\r\n${body}`,
      },
    },
    parameters,
  };
}

describe("deriveBaselineProfile", () => {
  it("marks body length stable when learning responses match", () => {
    const profile = deriveBaselineProfile([
      createRequestResponse("a".repeat(100)),
      createRequestResponse("a".repeat(100)),
      createRequestResponse("a".repeat(100)),
    ]);

    expect(profile.stableFactors.bodyLength).toBe(100);
    expect(profile.stableFactors.bodyLengthStable).toBe(true);
  });

  it("marks body length unstable when learning responses drift", () => {
    const profile = deriveBaselineProfile([
      createRequestResponse("a".repeat(100)),
      createRequestResponse("a".repeat(100)),
      createRequestResponse("a".repeat(80)),
    ]);

    expect(profile.stableFactors.bodyLengthStable).toBe(false);
  });

  it("compares sampled lines for large response bodies", () => {
    const padding = "padding\n".repeat(MAX_HEURISTIC_BODY_LENGTH / 8);
    const profile = deriveBaselineProfile([
      createRequestResponse(`start\n${padding}middle-a\n${padding}end`),
      createRequestResponse(`start\n${padding}middle-b\n${padding}end`),
      createRequestResponse(`start\n${padding}middle-c\n${padding}end`),
    ]);

    expect(profile.bodyDiffReferenceCount).toBeGreaterThan(0);
    expect(profile.stableFactors.bodyStable).toBe(true);
  });

  it("treats header names as case-insensitive when learning stability", () => {
    const profile = deriveBaselineProfile([
      createRequestResponse("stable", [], {
        "X-Stable": ["on"],
      }),
      createRequestResponse("stable", [], {
        "x-stable": ["on"],
      }),
    ]);

    expect(profile.stableFactors.headersStable).toBe(true);
    expect(profile.stableFactors.unstableHeaders).not.toContain("x-stable");
  });

  it("keeps stable-header detection enabled when volatile headers drift", () => {
    const profile = deriveBaselineProfile([
      createRequestResponse("stable", [], {
        Date: ["one"],
        "X-Stable": ["on"],
      }),
      createRequestResponse("stable", [], {
        Date: ["two"],
        "X-Stable": ["on"],
      }),
      createRequestResponse("stable", [], {
        Date: ["three"],
        "X-Stable": ["on"],
      }),
    ]);

    expect(profile.stableFactors.headersStable).toBe(true);
    expect(profile.stableFactors.unstableHeaders).toContain("date");
    expect(profile.stableFactors.unstableHeaders).not.toContain("x-stable");
  });
});

describe("word helpers", () => {
  it("extracts unique meaningful words from response bodies", () => {
    const words = extractWordsFromResponseBody("hello world hello _meta test!");
    expect(words).toEqual(["hello", "world", "_meta", "test"]);
  });

  it("extracts words from a bounded sample of large response bodies", () => {
    const padding = "x".repeat(MAX_HEURISTIC_BODY_LENGTH);
    const words = extractWordsFromResponseBody(
      `startword ${padding} middleword ${padding} endword`,
    );

    expect(words).toContain("startword");
    expect(words).toContain("middleword");
    expect(words).toContain("endword");
  });

  it("applies special-character filtering", () => {
    const words = applyAdditionalChecks(["test[]", "plain"], {
      handlesSpecialCharacters: false,
      handlesEncodedSpecialCharacters: false,
    });

    expect(words).toEqual(["plain"]);
  });
});

describe("parameter generation", () => {
  it("generates numeric learning values for integer mode", () => {
    const parameters = generateLearningParameters(3, () => 0, "integer");

    expect(parameters).toHaveLength(3);
    parameters.forEach((parameter) => {
      expect(parameter.value).toMatch(/^[1-9][0-9]{9}$/);
    });
  });

  it("generates numeric size probes for integer mode", () => {
    const probeConfig = getSizeProbeConfig("body", "json", "integer");
    const parameters = probeConfig.createParameters(() => 0, 12);

    expect(parameters).toHaveLength(1);
    expect(parameters[0]?.name).toBe("pf0");
    expect(parameters[0]?.value).toMatch(/^[1-9][0-9]*$/);
  });

  it("splits oversized integer JSON probes into finite numeric values", () => {
    const probeConfig = getSizeProbeConfig("body", "json", "integer");
    const parameters = probeConfig.createParameters(() => 0, 500);

    expect(parameters.length).toBeGreaterThan(1);
    parameters.forEach((parameter) => {
      expect(parameter.value).toMatch(/^[1-9][0-9]{0,14}$/);
    });
  });
});
