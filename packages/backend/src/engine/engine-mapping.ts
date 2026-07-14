import { createEngineConfig, createRunOptions } from "@paramfinder/engine";
import type { EngineConfig, RunOptions } from "@paramfinder/engine";
import type { ParamMinerConfig, Settings } from "shared";
export { settingsToParamMinerConfig } from "shared";

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 15 * 60;

export function createDefaultSettings(): Settings {
  return {
    delay: 20,
    requestTimeoutSeconds: DEFAULT_REQUEST_TIMEOUT_SECONDS,
    autoDetectMaxSize: true,
    learnRequestsCount: 6,
    wafDetection: true,
    ignoreCloudflareBlocks: false,
    additionalChecks: true,
    debug: false,
    autopilotEnabled: true,
    updateContentLength: true,
    ignoreAnomalyTypes: [],
    addCacheBusterParameter: true,
  };
}

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
  overrides: RunOptions = {},
): RunOptions {
  return createRunOptions({
    ...overrides,
    delayMs: config.delayBetweenRequests,
    requestTimeoutMs:
      (config.requestTimeoutSeconds ?? DEFAULT_REQUEST_TIMEOUT_SECONDS) * 1000,
    timeoutMs:
      config.scanTimeoutSeconds === undefined
        ? undefined
        : config.scanTimeoutSeconds * 1000,
  });
}
