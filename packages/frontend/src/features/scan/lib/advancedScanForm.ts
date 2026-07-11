import type { AttackType } from "shared";

import type {
  AdvancedScanRequest,
  AdvancedScanResult,
} from "../stores/scanDialog";

export const advancedScanCacheKey = "paramfinder.advanced-scan.cache";

export type AdvancedScanCache = {
  attackType?: AttackType;
  customValue?: string;
  jsonBodyPath?: string;
  cacheBusterParameter?: boolean;
  maxParametersAmount?: number;
};

export type AdvancedScanFormValues = {
  attackType: AttackType;
  customValue: string;
  jsonBodyPath: string;
  cacheBusterParameter: boolean;
  maxParametersAmount: number | undefined;
};

export function createAdvancedScanFormValues(
  request: AdvancedScanRequest,
  cache: AdvancedScanCache,
): AdvancedScanFormValues {
  return {
    attackType: request.initialAttackType ?? cache.attackType ?? "query",
    customValue: cache.customValue ?? "",
    jsonBodyPath: cache.jsonBodyPath ?? "",
    cacheBusterParameter: cache.cacheBusterParameter ?? false,
    maxParametersAmount: cache.maxParametersAmount,
  };
}

export function createAdvancedScanCache(
  values: AdvancedScanFormValues,
): AdvancedScanCache {
  return normalizeAdvancedScanValues(values);
}

export function createAdvancedScanResult(
  values: AdvancedScanFormValues,
): AdvancedScanResult {
  return normalizeAdvancedScanValues(values);
}

function normalizeAdvancedScanValues(
  values: AdvancedScanFormValues,
): AdvancedScanResult {
  return {
    attackType: values.attackType,
    customValue: values.customValue !== "" ? values.customValue : undefined,
    jsonBodyPath:
      values.attackType === "body" && values.jsonBodyPath !== ""
        ? values.jsonBodyPath
        : undefined,
    cacheBusterParameter:
      values.attackType === "headers" ? values.cacheBusterParameter : undefined,
    maxParametersAmount: values.maxParametersAmount,
  };
}
