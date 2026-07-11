import type { DiscoveryEvent } from "./events";
import type { RunControl } from "./run-control";

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

export type AttackType = (typeof ATTACK_TYPES)[number];
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
  requestId: string;
  status: number;
  headers: HeaderMap;
  body?: string;
  time: number;
  length?: number;
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

export enum AnomalyType {
  StatusCode = "status-code",
  Headers = "headers",
  ReflectionCount = "reflection_count",
  Body = "body",
  Redirect = "redirect",
  Similarity = "similarity",
}

export interface StatusCodeAnomaly {
  type: AnomalyType.StatusCode;
  from: number;
  to: number;
}

export interface RedirectAnomaly {
  type: AnomalyType.Redirect;
  from?: string;
  to?: string;
}

export interface HeadersAnomaly {
  type: AnomalyType.Headers;
  headerName: string;
  from?: string[];
  to?: string[];
}

export interface ReflectionCountAnomaly {
  type: AnomalyType.ReflectionCount;
  parameterName: string;
  from: number;
  to: number;
}

export interface BodyLengthAnomaly {
  type: AnomalyType.Body;
  check: "length";
  from: number;
  to: number;
}

export interface BodyContentAnomaly {
  type: AnomalyType.Body;
  check: "content";
  expectedDiffCount: number;
  actualDiffCount: number;
}

export interface SimilarityAnomaly {
  type: AnomalyType.Similarity;
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
  bodyLength: number;
  bodyLengthStable: boolean;
  headersStable: boolean;
  statusCodeStable: boolean;
  reflectionStable: boolean;
  similarityStable: boolean;
  redirectStable: boolean;
  reflectionsCount: number;
  statusCode: number;
  unstableHeaders: string[];
  similarity: number;
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

export enum EngineState {
  Pending = "pending",
  Learning = "learning",
  Running = "running",
  Completed = "completed",
  Error = "error",
  Paused = "paused",
  Canceled = "canceled",
  Timeout = "timeout",
}

export enum EnginePhase {
  Learning = "learning",
  Discovery = "discovery",
  Idle = "idle",
}

export interface EngineConfig {
  attackType: AttackType;
  learnRequestsCount: number;
  autoDetectMaxSize: boolean;
  maxQuerySize?: number;
  maxHeaderSize?: number;
  maxBodySize?: number;
  updateContentLength: boolean;
  autopilotEnabled?: boolean;
  addCacheBusterParameter: boolean;
  wafDetection: boolean;
  ignoreCloudflareBlocks: boolean;
  additionalChecks: boolean;
  ignoreAnomalyTypes: AnomalyType[];
  customValue?: string;
  customValueType?: ParameterValueType;
  jsonBodyPath?: string;
  maxParametersAmount?: number;
}

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
  state: EngineState.Completed;
  phase: EnginePhase.Discovery;
}

export interface EngineCanceledRunSummary extends EngineRunSummaryBase {
  state: EngineState.Canceled;
  phase: EnginePhase.Learning | EnginePhase.Discovery;
}

export interface EngineTimeoutRunSummary extends EngineRunSummaryBase {
  state: EngineState.Timeout;
  phase: EnginePhase.Learning | EnginePhase.Discovery;
}

export interface EngineFailedRunSummary extends EngineRunSummaryBase {
  state: EngineState.Error;
  phase: EnginePhase.Learning | EnginePhase.Discovery;
  failureReason: string;
}

export type EngineRunSummary =
  | EngineCompletedRunSummary
  | EngineCanceledRunSummary
  | EngineTimeoutRunSummary
  | EngineFailedRunSummary;

export interface EngineCompletedRunResult extends EngineCompletedRunSummary {
  state: EngineState.Completed;
  phase: EnginePhase.Discovery;
  profile: BaselineProfile;
}

export interface EngineCanceledRunResult extends EngineCanceledRunSummary {
  state: EngineState.Canceled;
  phase: EnginePhase.Learning | EnginePhase.Discovery;
  profile?: BaselineProfile;
}

export interface EngineTimeoutRunResult extends EngineTimeoutRunSummary {
  state: EngineState.Timeout;
  phase: EnginePhase.Learning | EnginePhase.Discovery;
  profile?: BaselineProfile;
}

export interface EngineFailedRunResult extends EngineFailedRunSummary {
  state: EngineState.Error;
  phase: EnginePhase.Learning | EnginePhase.Discovery;
  profile?: BaselineProfile;
  failureReason: string;
}

export type EngineRunResult =
  | EngineCompletedRunResult
  | EngineCanceledRunResult
  | EngineTimeoutRunResult
  | EngineFailedRunResult;
