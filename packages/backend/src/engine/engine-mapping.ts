import {
  createEngineConfig,
  AnomalyType as EngineAnomalyType,
} from "@paramfinder/engine";
import type { EngineConfig, RunOptions } from "@paramfinder/engine";
import type { ParamMinerConfig, Settings } from "shared";

/**
 * Per-request deadline applied when a config does not specify one. Bounds slow
 * or trickled responses so a single request can never stall a scan
 * indefinitely; the whole-scan timeout remains separate and opt-in.
 */
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
    ignoreAnomalyTypes: config.ignoreAnomalyTypes.map((type) => {
      switch (type) {
        case "status-code":
          return EngineAnomalyType.StatusCode;
        case "headers":
          return EngineAnomalyType.Headers;
        case "reflection_count":
          return EngineAnomalyType.ReflectionCount;
        case "body":
          return EngineAnomalyType.Body;
        case "redirect":
          return EngineAnomalyType.Redirect;
        case "similarity":
          return EngineAnomalyType.Similarity;
        default: {
          const exhaustive: never = type;
          return exhaustive;
        }
      }
    }),
    customValue: config.customValue,
    customValueType: config.customValueType,
    jsonBodyPath: config.jsonBodyPath,
    maxParametersAmount: config.maxParametersAmount,
  });
}

export function toRunOptions(
  config: ParamMinerConfig,
  overrides: RunOptions,
): RunOptions {
  return {
    ...overrides,
    delayMs: config.delayBetweenRequests,
    requestTimeoutMs:
      (config.requestTimeoutSeconds ?? DEFAULT_REQUEST_TIMEOUT_SECONDS) * 1000,
    timeoutMs:
      config.scanTimeoutSeconds === undefined
        ? undefined
        : config.scanTimeoutSeconds * 1000,
  };
}

export function settingsToParamMinerConfig(
  settings: Settings,
  overrides: Partial<ParamMinerConfig>,
): ParamMinerConfig {
  const attackType = overrides.attackType ?? "query";

  return {
    attackType,
    learnRequestsCount: settings.learnRequestsCount,
    autoDetectMaxSize: settings.autoDetectMaxSize,
    maxQuerySize: settings.maxQuerySize,
    maxHeaderSize: settings.maxHeaderSize,
    maxBodySize: settings.maxBodySize,
    updateContentLength: settings.updateContentLength,
    autopilotEnabled: settings.autopilotEnabled,
    addCacheBusterParameter: settings.addCacheBusterParameter,
    wafDetection: settings.wafDetection,
    ignoreCloudflareBlocks: settings.ignoreCloudflareBlocks,
    additionalChecks: settings.additionalChecks,
    ignoreAnomalyTypes: settings.ignoreAnomalyTypes,
    customValueType: "string",
    delayBetweenRequests: settings.delay,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    scanTimeoutSeconds: settings.scanTimeoutSeconds,
    debug: settings.debug,
    ...overrides,
  };
}
