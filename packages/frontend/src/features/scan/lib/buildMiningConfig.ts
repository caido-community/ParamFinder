import {
  type AttackType,
  type ParamMinerConfig,
  type Settings,
  settingsToParamMinerConfig,
} from "shared";

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
  return settingsToParamMinerConfig(settings, {
    attackType,
    addCacheBusterParameter:
      options.cacheBusterParameter ?? settings.addCacheBusterParameter,
    customValue: options.customValue,
    customValueType: "string",
    jsonBodyPath: options.jsonBodyPath,
    maxParametersAmount: options.maxParametersAmount,
  });
}
