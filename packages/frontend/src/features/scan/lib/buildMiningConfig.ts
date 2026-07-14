import {
  type AttackType,
  type ParamMinerConfig,
  type Settings,
  settingsToParamMinerConfig,
} from "shared";

import type { AdvancedScanOptions as ScanOptions } from "../stores/scanDialog";

export type AdvancedScanOptions = Omit<ScanOptions, "attackType">;

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
