import { createEngineConfig, createRunOptions } from "@paramfinder/engine";
import type { EngineConfig, RunOptions } from "@paramfinder/engine";
import type { ParamMinerConfig } from "shared";

export function toEngineConfig(config: ParamMinerConfig): EngineConfig {
  return createEngineConfig({
    attackType: config.attackType,
    learnRequestsCount: config.learnRequestsCount,
    autoDetectMaxSize: config.autoDetectMaxSize,
    maxQuerySize: config.maxQuerySize,
    maxHeaderSize: config.maxHeaderSize,
    maxBodySize: config.maxBodySize,
    updateContentLength: config.updateContentLength,
    autopilotEnabled: config.autopilotEnabled,
    addCacheBusterParameter: config.addCacheBusterParameter,
    wafDetection: config.wafDetection,
    ignoreCloudflareBlocks: config.ignoreCloudflareBlocks,
    additionalChecks: config.additionalChecks,
    ignoreAnomalyTypes: config.ignoreAnomalyTypes,
    customValue: config.customValue,
    customValueType: config.customValueType,
    jsonBodyPath: config.jsonBodyPath,
    maxParametersAmount: config.maxParametersAmount,
  });
}

export function toRunOptions(
  config: ParamMinerConfig,
  defaultRequestTimeoutSeconds: number,
  overrides: RunOptions = {},
): RunOptions {
  return createRunOptions({
    ...overrides,
    delayMs: config.delayBetweenRequests,
    requestTimeoutMs:
      (config.requestTimeoutSeconds ?? defaultRequestTimeoutSeconds) * 1000,
    timeoutMs:
      config.scanTimeoutSeconds === undefined
        ? undefined
        : config.scanTimeoutSeconds * 1000,
  });
}
