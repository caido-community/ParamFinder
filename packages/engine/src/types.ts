import type { EngineConfig } from "./config-schema";
import type { DiscoveryEvent } from "./events";
import type { RunControl } from "./run-control";

export type { EngineConfig, EngineConfigInput } from "./config-schema";

export const ATTACK_TYPES = ["query", "body", "headers"] as const;
export const REQUEST_CONTEXTS = ["discovery", "narrower", "learning"] as const;
export const INSPECTABLE_BODY_KINDS = [
  "json",
  "urlencoded",
  "multipart",
  "text",
] as const;
export const MUTABLE_BODY_KINDS = ["json", "urlencoded", "multipart"] as const;
export const PARAMETER_VALUE_TYPES = ["string", "integer"] as const;

export const AttackType = {
  Query: ATTACK_TYPES[0],
  Body: ATTACK_TYPES[1],
  Headers: ATTACK_TYPES[2],
} as const;

export type AttackType = (typeof AttackType)[keyof typeof AttackType];
export type RequestContext = (typeof REQUEST_CONTEXTS)[number];
export type InspectableBodyKind = (typeof INSPECTABLE_BODY_KINDS)[number];
export type MutableBodyKind = (typeof MUTABLE_BODY_KINDS)[number];
export type ParameterValueType = (typeof PARAMETER_VALUE_TYPES)[number];
export type HeaderMap = Record<string, string[]>;

export interface EngineRequest {
  id: string;
  host: string;
  port: number;
  url: string;
  path: string;
  query: string;
  method: string;
  headers: HeaderMap;
  body: string;
  tls: boolean;
  raw: string;
  context: RequestContext;
}

export interface EngineResponse {
  status: number;
  headers: HeaderMap;
  body: string;
  time: number;
  length: number;
  raw?: string;
}

export interface EngineRequestResponse {
  request: EngineRequest;
  response: EngineResponse;
}

export interface Parameter {
  name: string;
  value: string;
}

export const AnomalyType = {
  StatusCode: "status-code",
  Headers: "headers",
  ReflectionCount: "reflection_count",
  Body: "body",
  Redirect: "redirect",
  Similarity: "similarity",
} as const;

export type AnomalyType = (typeof AnomalyType)[keyof typeof AnomalyType];

export interface StatusCodeAnomaly {
  type: typeof AnomalyType.StatusCode;
  from: number;
  to: number;
}

export interface RedirectAnomaly {
  type: typeof AnomalyType.Redirect;
  from?: string;
  to?: string;
}

export interface HeadersAnomaly {
  type: typeof AnomalyType.Headers;
  headerName: string;
  from?: string[];
  to?: string[];
}

export interface ReflectionCountAnomaly {
  type: typeof AnomalyType.ReflectionCount;
  parameterName: string;
  from: number;
  to: number;
}

export interface BodyLengthAnomaly {
  type: typeof AnomalyType.Body;
  check: "length";
  from: number;
  to: number;
}

export interface BodyContentAnomaly {
  type: typeof AnomalyType.Body;
  check: "content";
  expectedDiffCount: number;
  actualDiffCount: number;
}

export interface SimilarityAnomaly {
  type: typeof AnomalyType.Similarity;
  similarity: number;
  threshold: number;
}

export type Anomaly =
  | StatusCodeAnomaly
  | RedirectAnomaly
  | HeadersAnomaly
  | ReflectionCountAnomaly
  | BodyLengthAnomaly
  | BodyContentAnomaly
  | SimilarityAnomaly;

export interface Finding {
  requestResponse: EngineRequestResponse;
  parameter: Parameter;
  anomaly: Anomaly;
}

export interface AdditionalChecksResult {
  handlesSpecialCharacters: boolean;
  handlesEncodedSpecialCharacters: boolean;
}

export interface StableFactors {
  bodyStable: boolean;
  bodyLengthStable: boolean;
  statusCodeStable: boolean;
  reflectionStable: boolean;
  similarityStable: boolean;
  redirectStable: boolean;
  reflectionsCount: number;
  unstableHeaders: string[];
  redirect?: string;
}

export interface BaselineProfile {
  initialRequestResponse: EngineRequestResponse;
  stableFactors: StableFactors;
  bodyDiffReferenceCount: number;
  wafResponse?: EngineResponse;
  additionalChecks?: AdditionalChecksResult;
  maxSize?: number;
  bodyKind?: InspectableBodyKind;
  multipartBoundary?: string;
}

export const EngineState = {
  Pending: "pending",
  Learning: "learning",
  Running: "running",
  Completed: "completed",
  Error: "error",
  Paused: "paused",
  Canceled: "canceled",
  Timeout: "timeout",
} as const;

export type EngineState = (typeof EngineState)[keyof typeof EngineState];

export const EnginePhase = {
  Learning: "learning",
  Discovery: "discovery",
  Idle: "idle",
} as const;

export type EnginePhase = (typeof EnginePhase)[keyof typeof EnginePhase];

export type LoggerLevel = "debug" | "info" | "warn" | "error";
export type LoggerFn = (level: LoggerLevel, message: string) => void;
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;
export type RandomSource = () => number;

export interface RunOptions {
  delayMs?: number;
  requestTimeoutMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  runControl?: RunControl;
  onEvent?: (event: DiscoveryEvent) => void;
}

export interface EngineLearnInput {
  request: EngineRequest;
  engineConfig: EngineConfig;
  runOptions?: RunOptions;
}

export interface EngineDiscoverInput {
  request: EngineRequest;
  words: string[];
  engineConfig: EngineConfig;
  profile: BaselineProfile;
  runOptions?: RunOptions;
}

export interface EngineRunInput {
  request: EngineRequest;
  words: string[];
  engineConfig: EngineConfig;
  runOptions?: RunOptions;
}

export interface EngineLearnResult {
  profile: BaselineProfile;
}

export interface EngineDiscoverResult {
  findings: Finding[];
  totalParametersAmount: number;
}

export interface EngineRunSummaryBase {
  findings: Finding[];
  totalParametersAmount: number;
}

export interface EngineCompletedRunSummary extends EngineRunSummaryBase {
  state: typeof EngineState.Completed;
  phase: typeof EnginePhase.Discovery;
}

export interface EngineCanceledRunSummary extends EngineRunSummaryBase {
  state: typeof EngineState.Canceled;
  phase: typeof EnginePhase.Learning | typeof EnginePhase.Discovery;
}

export interface EngineTimeoutRunSummary extends EngineRunSummaryBase {
  state: typeof EngineState.Timeout;
  phase: typeof EnginePhase.Learning | typeof EnginePhase.Discovery;
}

export interface EngineFailedRunSummary extends EngineRunSummaryBase {
  state: typeof EngineState.Error;
  phase: typeof EnginePhase.Learning | typeof EnginePhase.Discovery;
  failureReason: string;
}

export type EngineRunSummary =
  | EngineCompletedRunSummary
  | EngineCanceledRunSummary
  | EngineTimeoutRunSummary
  | EngineFailedRunSummary;

export interface EngineCompletedRunResult extends EngineCompletedRunSummary {
  profile: BaselineProfile;
}

export interface EngineCanceledRunResult extends EngineCanceledRunSummary {
  profile?: BaselineProfile;
}

export interface EngineTimeoutRunResult extends EngineTimeoutRunSummary {
  profile?: BaselineProfile;
}

export interface EngineFailedRunResult extends EngineFailedRunSummary {
  profile?: BaselineProfile;
}

export type EngineRunResult =
  | EngineCompletedRunResult
  | EngineCanceledRunResult
  | EngineTimeoutRunResult
  | EngineFailedRunResult;
