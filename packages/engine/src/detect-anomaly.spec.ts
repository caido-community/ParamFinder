import { describe, expect, it } from "vitest";

import {
  compareResponseToReference,
  detectAnomaly,
  matchesCloudflareBlock,
} from "./detect-anomaly";
import type {
  BaselineProfile,
  EngineRequestResponse,
  HeaderMap,
  Parameter,
} from "./types";
import { AnomalyType } from "./types";

function createRequestResponse(args?: {
  body?: string;
  status?: number;
  headers?: HeaderMap;
}): EngineRequestResponse {
  const body = args?.body ?? "a".repeat(100);
  const status = args?.status ?? 200;
  const headers = args?.headers ?? {};
  return {
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
      status,
      headers,
      body,
      time: 10,
      raw: `HTTP/1.1 ${status} OK\r\n\r\n${body}`,
    },
  };
}

function createProfile(): BaselineProfile {
  return {
    initialRequestResponse: createRequestResponse(),
    stableFactors: {
      bodyStable: false,
      bodyLength: 100,
      bodyLengthStable: true,
      headersStable: false,
      statusCodeStable: false,
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

describe("detectAnomaly", () => {
  it("flags body-length anomalies", () => {
    const profile = createProfile();

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ body: "a".repeat(90) }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Body,
      check: "length",
      from: 100,
      to: 90,
    });
  });

  it("does not flag body-length drift when stability was not learned", () => {
    const profile = createProfile();
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.similarityStable = false;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ body: "a".repeat(90) }).response,
      [],
    );

    expect(anomaly).toBeUndefined();
  });

  it("flags status-code anomalies when status stability was learned", () => {
    const profile = createProfile();
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.statusCodeStable = true;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ status: 500 }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.StatusCode,
      from: 200,
      to: 500,
    });
  });

  it("uses per-header stability even when the legacy global flag is false", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "stable body",
      headers: {
        "X-Stable": ["on"],
        Date: ["volatile"],
      },
    });
    profile.stableFactors.bodyLength = "stable body".length;
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.headersStable = false;
    profile.stableFactors.unstableHeaders = ["Date"];

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({
        body: "stable body",
        headers: {
          "X-Stable": ["off"],
          Date: ["changed"],
        },
      }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Headers,
      headerName: "X-Stable",
      from: ["on"],
      to: ["off"],
    });
  });

  it("compares response headers case-insensitively", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "stable body",
      headers: {
        "X-Stable": ["on"],
      },
    });
    profile.stableFactors.bodyLength = "stable body".length;
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.headersStable = true;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({
        body: "stable body",
        headers: {
          "x-stable": ["on"],
        },
      }).response,
      [],
    );

    expect(anomaly).toBeUndefined();
  });

  it("flags newly introduced headers when header stability was learned", () => {
    const profile = createProfile();
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.headersStable = true;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({
        headers: {
          "X-New": ["value"],
        },
      }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Headers,
      headerName: "X-New",
      to: ["value"],
    });
  });

  it("flags redirect anomalies when redirect stability was learned", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "stable body",
      headers: {
        Location: ["https://example.com/a"],
      },
    });
    profile.stableFactors.bodyLength = "stable body".length;
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.redirectStable = true;
    profile.stableFactors.redirect = "https://example.com/a";

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({
        body: "stable body",
        headers: {
          Location: ["https://example.com/b"],
        },
      }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Redirect,
      from: "https://example.com/a",
      to: "https://example.com/b",
    });
  });

  it("flags a learned redirect that loses its Location header", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "stable body",
      headers: { Location: ["https://example.com/a"] },
    });
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.redirectStable = true;
    profile.stableFactors.redirect = "https://example.com/a";

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ body: "stable body", headers: {} }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Redirect,
      from: "https://example.com/a",
      to: undefined,
    });
  });

  it("continues to lower-priority checks after an ignored anomaly", () => {
    const profile = createProfile();
    profile.stableFactors.statusCodeStable = true;
    profile.stableFactors.bodyLengthStable = true;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ status: 500, body: "short" }).response,
      [],
      [AnomalyType.StatusCode],
    );

    expect(anomaly).toMatchObject({
      type: AnomalyType.Body,
      check: "length",
    });
  });

  it("detects redirect anomalies with lower-case location headers", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "stable body",
      headers: {
        location: ["https://example.com/a"],
      },
    });
    profile.stableFactors.bodyLength = "stable body".length;
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.redirectStable = true;
    profile.stableFactors.redirect = "https://example.com/a";

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({
        body: "stable body",
        headers: {
          Location: ["https://example.com/b"],
        },
      }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Redirect,
      from: "https://example.com/a",
      to: "https://example.com/b",
    });
  });

  it("flags reflection-count anomalies for the affected parameter", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "alpha beta",
    });
    profile.stableFactors.bodyLength = "alpha beta".length;
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.reflectionStable = true;
    profile.stableFactors.reflectionsCount = 1;

    const parameters: Parameter[] = [
      { name: "alpha", value: "alpha" },
      { name: "beta", value: "beta" },
    ];
    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ body: "alpha only once" }).response,
      parameters,
    );

    expect(anomaly).toEqual({
      type: AnomalyType.ReflectionCount,
      parameterName: "beta",
      from: 1,
      to: 0,
    });
  });

  it("flags body-content anomalies when body stability was learned", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "line-one\nline-two",
    });
    profile.bodyDiffReferenceCount = 0;
    profile.stableFactors.bodyLength = "line-one\nline-two".length;
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.bodyStable = true;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ body: "line-one\nline-three" }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Body,
      check: "content",
      expectedDiffCount: 0,
      actualDiffCount: 1,
    });
  });

  it("flags similarity anomalies when similarity stability was learned", () => {
    const profile = createProfile();
    profile.initialRequestResponse = createRequestResponse({
      body: "a".repeat(120),
    });
    profile.stableFactors.bodyLength = 120;
    profile.stableFactors.bodyLengthStable = false;
    profile.stableFactors.similarityStable = true;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({ body: "b".repeat(120) }).response,
      [],
    );

    expect(anomaly).toEqual({
      type: AnomalyType.Similarity,
      similarity: 0,
      threshold: 0.95,
    });
  });

  it("suppresses anomalies when the response matches the learned WAF response", () => {
    const profile = createProfile();
    profile.wafResponse = createRequestResponse({
      body: "waf blocked",
      status: 403,
    }).response;
    profile.stableFactors.statusCodeStable = true;

    const anomaly = detectAnomaly(
      profile,
      createRequestResponse({
        body: "waf blocked",
        status: 403,
      }).response,
      [],
    );

    expect(anomaly).toBeUndefined();
  });

  it("suppresses Cloudflare block responses when skipCloudflareBlocks is enabled", () => {
    const profile = createProfile();
    profile.stableFactors.statusCodeStable = true;

    const cloudflareBlock = createRequestResponse({
      body: "<html><body>Sorry, you have been blocked</body></html>",
      status: 403,
    }).response;

    expect(
      detectAnomaly(profile, cloudflareBlock, [], [], true),
    ).toBeUndefined();
  });

  it("still reports Cloudflare block responses when skipCloudflareBlocks is disabled", () => {
    const profile = createProfile();
    profile.stableFactors.statusCodeStable = true;

    const cloudflareBlock = createRequestResponse({
      body: "<html><body>Sorry, you have been blocked</body></html>",
      status: 403,
    }).response;

    expect(detectAnomaly(profile, cloudflareBlock, [])).toEqual({
      type: AnomalyType.StatusCode,
      from: 200,
      to: 403,
    });
  });
});

describe("compareResponseToReference", () => {
  it("compares a candidate against an arbitrary control response", () => {
    const profile = createProfile();
    profile.stableFactors.bodyLengthStable = true;
    profile.stableFactors.similarityStable = false;

    const anomaly = compareResponseToReference(profile, {
      referenceResponse: createRequestResponse({ body: "a".repeat(80) })
        .response,
      response: createRequestResponse({ body: "b".repeat(90) }).response,
      parameters: [],
    });

    expect(anomaly).toEqual({
      type: AnomalyType.Body,
      check: "length",
      from: 80,
      to: 90,
    });
  });

  it("suppresses waf-matching responses during control comparisons", () => {
    const profile = createProfile();
    profile.stableFactors.bodyLengthStable = true;
    profile.wafResponse = createRequestResponse({
      body: "waf blocked",
    }).response;

    const anomaly = compareResponseToReference(profile, {
      referenceResponse: createRequestResponse({ body: "baseline response" })
        .response,
      response: createRequestResponse({ body: "waf blocked" }).response,
      parameters: [],
    });

    expect(anomaly).toBeUndefined();
  });

  it("suppresses Cloudflare block responses during control comparisons", () => {
    const profile = createProfile();
    profile.stableFactors.bodyLengthStable = true;

    const anomaly = compareResponseToReference(profile, {
      referenceResponse: createRequestResponse({ body: "baseline response" })
        .response,
      response: createRequestResponse({
        body: "error code: 1020",
        status: 403,
      }).response,
      parameters: [],
      skipCloudflareBlocks: true,
    });

    expect(anomaly).toBeUndefined();
  });
});

describe("matchesCloudflareBlock", () => {
  it("recognizes a Cloudflare 403 block page", () => {
    expect(
      matchesCloudflareBlock(
        createRequestResponse({
          body: "Attention Required! | Cloudflare",
          status: 403,
        }).response,
      ),
    ).toBe(true);
  });

  it("ignores a 403 without Cloudflare block markers", () => {
    expect(
      matchesCloudflareBlock(
        createRequestResponse({ body: "Forbidden", status: 403 }).response,
      ),
    ).toBe(false);
  });

  it("ignores Cloudflare markers on non-403 responses", () => {
    expect(
      matchesCloudflareBlock(
        createRequestResponse({
          body: "Sorry, you have been blocked",
          status: 200,
        }).response,
      ),
    ).toBe(false);
  });
});
