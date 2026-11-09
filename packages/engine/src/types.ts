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

export type EngineRequest = {
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
};

export type EngineResponse = {
  status: number;
  headers: HeaderMap;
  body: string;
  time: number;
  length: number;
  raw?: string;
};

export type EngineRequestResponse = {
  request: EngineRequest;
  response: EngineResponse;
};

export type Parameter = {
  name: string;
  value: string;
};

export const AnomalyType = {
  StatusCode: "status-code",
  Headers: "headers",
  ReflectionCount: "reflection_count",
  Body: "body",
  Redirect: "redirect",
  Similarity: "similarity",
} as const;

export type AnomalyType = (typeof AnomalyType)[keyof typeof AnomalyType];

export type StatusCodeAnomaly = {
  type: typeof AnomalyType.StatusCode;
  from: number;
  to: number;
};

export type RedirectAnomaly = {
  type: typeof AnomalyType.Redirect;
  from?: string;
  to?: string;
};

export type HeadersAnomaly = {
  type: typeof AnomalyType.Headers;
  headerName: string;
  from?: string[];
  to?: string[];
};

export type ReflectionCountAnomaly = {
  type: typeof AnomalyType.ReflectionCount;
  parameterName: string;
  from: number;
  to: number;
};

export type BodyLengthAnomaly = {
  type: typeof AnomalyType.Body;
  check: "length";
  from: number;
  to: number;
};

export type BodyContentAnomaly = {
  type: typeof AnomalyType.Body;
  check: "content";
  expectedDiffCount: number;
  actualDiffCount: number;
};

export type SimilarityAnomaly = {
  type: typeof AnomalyType.Similarity;
  similarity: number;
  threshold: number;
};

export type Anomaly =
  | StatusCodeAnomaly
  | RedirectAnomaly
  | HeadersAnomaly
  | ReflectionCountAnomaly
  | BodyLengthAnomaly
  | BodyContentAnomaly
  | SimilarityAnomaly;

export type Finding = {
  requestResponse: EngineRequestResponse;
  parameter: Parameter;
  anomaly: Anomaly;
};

export type AdditionalChecksResult = {
  handlesSpecialCharacters: boolean;
  handlesEncodedSpecialCharacters: boolean;
};

export type StableFactors = {
  bodyStable: boolean;
  bodyLengthStable: boolean;
  statusCodeStable: boolean;
  reflectionStable: boolean;
  similarityStable: boolean;
  redirectStable: boolean;
  reflectionsCount: number;
  unstableHeaders: string[];
  redirect?: string;
};

export type BaselineProfile = {
  initialRequestResponse: EngineRequestResponse;
  stableFactors: StableFactors;
  bodyDiffReferenceCount: number;
  wafResponse?: EngineResponse;
  additionalChecks?: AdditionalChecksResult;
  maxSize?: number;
  bodyKind?: InspectableBodyKind;
  multipartBoundary?: string;
};

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

// Timers hold a signed 32-bit delay; a longer one fires at once.
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export type RunOptions = {
  delayMs?: number;
  requestTimeoutMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  runControl?: RunControl;
  onEvent?: (event: DiscoveryEvent) => void;
};

export type EngineLearnInput = {
  request: EngineRequest;
  engineConfig: EngineConfig;
  runOptions?: RunOptions;
};

export type EngineDiscoverInput = {
  request: EngineRequest;
  words: string[];
  engineConfig: EngineConfig;
  profile: BaselineProfile;
  runOptions?: RunOptions;
};

export type EngineRunInput = {
  request: EngineRequest;
  words: string[];
  engineConfig: EngineConfig;
  runOptions?: RunOptions;
};

export type EngineLearnResult = {
  profile: BaselineProfile;
};

export type EngineDiscoverResult = {
  findings: Finding[];
  totalParametersAmount: number;
};

export type EngineRunSummaryBase = {
  findings: Finding[];
  totalParametersAmount: number;
};

export type EngineCompletedRunSummary = EngineRunSummaryBase & {
  state: typeof EngineState.Completed;
  phase: typeof EnginePhase.Discovery;
};

export type EngineCanceledRunSummary = EngineRunSummaryBase & {
  state: typeof EngineState.Canceled;
  phase: typeof EnginePhase.Learning | typeof EnginePhase.Discovery;
};

export type EngineTimeoutRunSummary = EngineRunSummaryBase & {
  state: typeof EngineState.Timeout;
  phase: typeof EnginePhase.Learning | typeof EnginePhase.Discovery;
};

export type EngineFailedRunSummary = EngineRunSummaryBase & {
  state: typeof EngineState.Error;
  phase: typeof EnginePhase.Learning | typeof EnginePhase.Discovery;
  failureReason: string;
};

export type EngineRunSummary =
  | EngineCompletedRunSummary
  | EngineCanceledRunSummary
  | EngineTimeoutRunSummary
  | EngineFailedRunSummary;

export type EngineCompletedRunResult = EngineCompletedRunSummary & {
  profile: BaselineProfile;
};

export type EngineCanceledRunResult = EngineCanceledRunSummary & {
  profile?: BaselineProfile;
};

export type EngineTimeoutRunResult = EngineTimeoutRunSummary & {
  profile?: BaselineProfile;
};

export type EngineFailedRunResult = EngineFailedRunSummary & {
  profile?: BaselineProfile;
};

export type EngineRunResult =
  | EngineCompletedRunResult
  | EngineCanceledRunResult
  | EngineTimeoutRunResult
  | EngineFailedRunResult;
