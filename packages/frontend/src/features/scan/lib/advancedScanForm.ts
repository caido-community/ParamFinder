import type {
  AdvancedScanOptions,
  AdvancedScanRequest,
} from "../stores/scanDialog";

export const advancedScanCacheKey = "paramfinder.advanced-scan.cache";

export type AdvancedScanFormValues = Omit<
  AdvancedScanOptions,
  | "customValue"
  | "customValueType"
  | "jsonBodyPath"
  | "cacheBusterParameter"
  | "maxParametersAmount"
> & {
  customValue: string;
  customValueType: NonNullable<AdvancedScanOptions["customValueType"]>;
  jsonBodyPath: string;
  cacheBusterParameter: boolean;
  maxParametersAmount: number | null | undefined;
};

export type AdvancedScanCache = Partial<AdvancedScanFormValues>;

export function createAdvancedScanFormValues(
  request: AdvancedScanRequest,
  cache: AdvancedScanCache,
): AdvancedScanFormValues {
  return {
    attackType: request.initialAttackType ?? cache.attackType ?? "query",
    customValue: cache.customValue ?? "",
    customValueType: cache.customValueType ?? "string",
    jsonBodyPath: cache.jsonBodyPath ?? "",
    cacheBusterParameter: cache.cacheBusterParameter ?? false,
    maxParametersAmount: cache.maxParametersAmount,
  };
}

export function createAdvancedScanOptions(
  values: AdvancedScanFormValues,
): AdvancedScanOptions {
  return {
    attackType: values.attackType,
    customValue:
      values.customValueType === "string" && values.customValue !== ""
        ? values.customValue
        : undefined,
    customValueType: values.customValueType,
    jsonBodyPath:
      values.attackType === "body" && values.jsonBodyPath !== ""
        ? values.jsonBodyPath
        : undefined,
    cacheBusterParameter:
      values.attackType === "headers" ? values.cacheBusterParameter : undefined,
    maxParametersAmount: values.maxParametersAmount ?? undefined,
  };
}
