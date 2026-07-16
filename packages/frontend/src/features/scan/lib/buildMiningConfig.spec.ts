import { AnomalyType, type Settings } from "shared";
import { describe, expect, it } from "vitest";

import { buildMiningConfig } from "./buildMiningConfig";

const settings: Settings = {
  delay: 100,
  requestTimeoutSeconds: 30,
  scanTimeoutSeconds: 5000,
  autoDetectMaxSize: true,
  maxQuerySize: 100,
  maxHeaderSize: 200,
  maxBodySize: 300,
  learnRequestsCount: 6,
  wafDetection: true,
  ignoreCloudflareBlocks: false,
  additionalChecks: true,
  debug: false,
  autopilotEnabled: true,
  updateContentLength: true,
  ignoreAnomalyTypes: [AnomalyType.Body],
  addCacheBusterParameter: false,
};

describe("buildMiningConfig", () => {
  it("maps settings into engine config", () => {
    expect(buildMiningConfig(settings, "query")).toEqual({
      attackType: "query",
      learnRequestsCount: 6,
      autoDetectMaxSize: true,
      requestTimeoutSeconds: 30,
      scanTimeoutSeconds: 5000,
      delayBetweenRequests: 100,
      addCacheBusterParameter: false,
      maxQuerySize: 100,
      maxHeaderSize: 200,
      maxBodySize: 300,
      wafDetection: true,
      ignoreCloudflareBlocks: false,
      additionalChecks: true,
      debug: false,
      updateContentLength: true,
      autopilotEnabled: true,
      ignoreAnomalyTypes: [AnomalyType.Body],
      customValue: undefined,
      customValueType: "string",
      jsonBodyPath: undefined,
      maxParametersAmount: undefined,
    });
  });

  it("lets advanced options override scan-specific fields", () => {
    expect(
      buildMiningConfig(settings, "headers", {
        customValue: "marker",
        customValueType: "string",
        jsonBodyPath: "$.data.user",
        cacheBusterParameter: true,
        maxParametersAmount: 12,
      }),
    ).toMatchObject({
      attackType: "headers",
      customValue: "marker",
      jsonBodyPath: "$.data.user",
      addCacheBusterParameter: true,
      maxParametersAmount: 12,
    });
  });

  it("uses the datatype selected in advanced options", () => {
    expect(
      buildMiningConfig(settings, "body", { customValueType: "integer" }),
    ).toMatchObject({
      attackType: "body",
      customValueType: "integer",
    });
  });
});
