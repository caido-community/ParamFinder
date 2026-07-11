import type { AttackType, ParamMinerConfig, Settings } from "shared";

export type AdvancedScanOptions = {
  customValue?: string;
  jsonBodyPath?: string;
  cacheBusterParameter?: boolean;
  maxParametersAmount?: number;
};

export function buildMiningConfig(
  settings: Settings,
  attackType: AttackType,
  options: AdvancedScanOptions = {},
): ParamMinerConfig {
  return {
    attackType,
    learnRequestsCount: settings.learnRequestsCount,
    autoDetectMaxSize: settings.autoDetectMaxSize,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    scanTimeoutSeconds: settings.scanTimeoutSeconds,
    delayBetweenRequests: settings.delay,
    addCacheBusterParameter:
      options.cacheBusterParameter ?? settings.addCacheBusterParameter,
    maxQuerySize: settings.maxQuerySize,
    maxHeaderSize: settings.maxHeaderSize,
    maxBodySize: settings.maxBodySize,
    wafDetection: settings.wafDetection,
    ignoreCloudflareBlocks: settings.ignoreCloudflareBlocks,
    additionalChecks: settings.additionalChecks,
    debug: settings.debug,
    updateContentLength: settings.updateContentLength,
    autopilotEnabled: settings.autopilotEnabled,
    ignoreAnomalyTypes: settings.ignoreAnomalyTypes,
    customValue: options.customValue,
    customValueType: "string",
    jsonBodyPath: options.jsonBodyPath,
    maxParametersAmount: options.maxParametersAmount,
  };
}
