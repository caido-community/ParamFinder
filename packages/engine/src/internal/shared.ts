import { EngineError } from "../errors";
import { AnomalyType, EnginePhase, EngineState } from "../types";
import type {
  Anomaly,
  BaselineProfile,
  EngineCanceledRunResult,
  EngineCompletedRunResult,
  EngineConfig,
  EngineFailedRunResult,
  EngineRequestResponse,
  EngineTimeoutRunResult,
  Finding,
  Parameter,
} from "../types";

const ADDITIONAL_CHECK_STRING_VALUE = "exampleValue";
const ADDITIONAL_CHECK_INTEGER_VALUE = "12345678";
const WAF_PATTERNS = [
  "/etc/passwd",
  ".htaccess",
  "javascript:alert",
  "onload=alert",
];

export type AutopilotResult =
  | { handled: true; nextMaxSize: number; hasAdjustedQuerySize: true }
  | { handled: false; nextMaxSize?: number; hasAdjustedQuerySize: boolean };

export interface VerifiedAnomalyResult {
  anomaly: Anomaly;
  requestResponse: EngineRequestResponse;
}

export function anomaliesMatch(left: Anomaly, right: Anomaly): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === AnomalyType.Body && right.type === AnomalyType.Body) {
    return left.check === right.check;
  }

  if (left.type === AnomalyType.Headers && right.type === AnomalyType.Headers) {
    return left.headerName === right.headerName;
  }

  if (
    left.type === AnomalyType.ReflectionCount &&
    right.type === AnomalyType.ReflectionCount
  ) {
    return left.parameterName === right.parameterName;
  }

  return true;
}

export function isStrongVerificationAnomaly(anomaly: Anomaly): boolean {
  return (
    anomaly.type === AnomalyType.StatusCode ||
    anomaly.type === AnomalyType.Headers ||
    anomaly.type === AnomalyType.Body
  );
}

export function createAdditionalCheckParameterValue(
  engineConfig: EngineConfig,
): string {
  return engineConfig.customValueType === "integer"
    ? ADDITIONAL_CHECK_INTEGER_VALUE
    : ADDITIONAL_CHECK_STRING_VALUE;
}

export function createWafParameters(
  pattern: string,
  engineConfig: EngineConfig,
): Parameter[] {
  if (
    engineConfig.attackType === "body" &&
    engineConfig.customValueType === "integer"
  ) {
    return [{ name: "test", value: ADDITIONAL_CHECK_INTEGER_VALUE }];
  }

  return [{ name: "test", value: pattern }];
}

export function getConfiguredMaxSize(
  engineConfig: EngineConfig,
): number | undefined {
  switch (engineConfig.attackType) {
    case "query":
      return engineConfig.maxQuerySize;
    case "headers":
      return engineConfig.maxHeaderSize;
    case "body":
      return engineConfig.maxBodySize;
  }
}

export function getWafPatterns(): readonly string[] {
  return WAF_PATTERNS;
}

export function requireProfile(
  profile: BaselineProfile | undefined,
  message: string,
): BaselineProfile {
  if (!profile) {
    throw new EngineError("INTERNAL_ERROR", message);
  }

  return profile;
}

export function createCompletedRunResult(args: {
  findings: Finding[];
  profile: BaselineProfile;
  totalParametersAmount: number;
}): EngineCompletedRunResult {
  return {
    state: EngineState.Completed,
    phase: EnginePhase.Discovery,
    findings: args.findings,
    profile: args.profile,
    totalParametersAmount: args.totalParametersAmount,
  };
}

export function createCanceledRunResult(args: {
  phase: EnginePhase.Learning | EnginePhase.Discovery;
  profile?: BaselineProfile;
  totalParametersAmount: number;
  findings?: Finding[];
}): EngineCanceledRunResult {
  return {
    state: EngineState.Canceled,
    phase: args.phase,
    findings: args.findings ?? [],
    profile: args.profile,
    totalParametersAmount: args.totalParametersAmount,
  };
}

export function createTimeoutRunResult(args: {
  phase: EnginePhase.Learning | EnginePhase.Discovery;
  profile?: BaselineProfile;
  totalParametersAmount: number;
  findings?: Finding[];
}): EngineTimeoutRunResult {
  return {
    state: EngineState.Timeout,
    phase: args.phase,
    findings: args.findings ?? [],
    profile: args.profile,
    totalParametersAmount: args.totalParametersAmount,
  };
}

export function createErrorRunResult(args: {
  phase: EnginePhase.Learning | EnginePhase.Discovery;
  profile?: BaselineProfile;
  totalParametersAmount: number;
  failureReason: string;
  findings?: Finding[];
}): EngineFailedRunResult {
  return {
    state: EngineState.Error,
    phase: args.phase,
    findings: args.findings ?? [],
    profile: args.profile,
    totalParametersAmount: args.totalParametersAmount,
    failureReason: args.failureReason,
  };
}

export function describeProviderFailure(error: EngineError): string {
  if (!(error.cause instanceof Error) || !error.cause.message) {
    return error.message;
  }

  return error.cause.message === error.message
    ? error.message
    : `${error.message}: ${error.cause.message}`;
}
