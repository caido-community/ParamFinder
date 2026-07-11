import type {
  AdvancedScanOptions,
  AdvancedScanRequest,
} from "../stores/scanDialog";

export const advancedScanCacheKey = "paramfinder.advanced-scan.cache";

export type AdvancedScanFormValues = Omit<
  AdvancedScanOptions,
  "customValue" | "jsonBodyPath" | "cacheBusterParameter"
> & {
  customValue: string;
  jsonBodyPath: string;
  cacheBusterParameter: boolean;
};

export type AdvancedScanCache = Partial<AdvancedScanFormValues>;

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
): AdvancedScanOptions {
  return normalizeAdvancedScanValues(values);
}

function normalizeAdvancedScanValues(
  values: AdvancedScanFormValues,
): AdvancedScanOptions {
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
