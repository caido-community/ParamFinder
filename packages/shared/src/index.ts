import { z } from "zod";

export const AnomalyType = {
  StatusCode: "status-code",
  Headers: "headers",
  ReflectionCount: "reflection_count",
  Body: "body",
  Redirect: "redirect",
  Similarity: "similarity",
} as const;
export type AnomalyType = (typeof AnomalyType)[keyof typeof AnomalyType];
export const MiningSessionState = {
  Pending: "pending",
  Learning: "learning",
  Running: "running",
  Completed: "completed",
  Error: "error",
  Paused: "paused",
  Canceled: "canceled",
  Timeout: "timeout",
} as const;
export type MiningSessionState =
  (typeof MiningSessionState)[keyof typeof MiningSessionState];
export const MiningSessionPhase = {
  Learning: "learning",
  Discovery: "discovery",
  Idle: "idle",
} as const;
export type MiningSessionPhase =
  (typeof MiningSessionPhase)[keyof typeof MiningSessionPhase];

export const AttackType = {
  Query: "query",
  Body: "body",
  Headers: "headers",
} as const;
export const attackTypeSchema = z.enum(AttackType);
export const requestContextSchema = z.enum([
  "discovery",
  "narrower",
  "learning",
]);
export const parameterValueTypeSchema = z.enum(["string", "integer"]);
export const engineStateSchema = z.enum(MiningSessionState);
export const enginePhaseSchema = z.enum(MiningSessionPhase);
export const anomalyTypeSchema = z.enum(AnomalyType);

export type AttackType = z.infer<typeof attackTypeSchema>;
export type RequestContext = z.infer<typeof requestContextSchema>;
export type ParameterValueType = z.infer<typeof parameterValueTypeSchema>;
export type Parameter = { name: string; value: string };
export const parameterSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type Anomaly =
  | { type: typeof AnomalyType.StatusCode; from: number; to: number }
  | { type: typeof AnomalyType.Redirect; from?: string; to?: string }
  | {
      type: typeof AnomalyType.Headers;
      headerName: string;
      from?: string[];
      to?: string[];
    }
  | {
      type: typeof AnomalyType.ReflectionCount;
      parameterName: string;
      from: number;
      to: number;
    }
  | {
      type: typeof AnomalyType.Body;
      check: "length";
      from: number;
      to: number;
    }
  | {
      type: typeof AnomalyType.Body;
      check: "content";
      expectedDiffCount: number;
      actualDiffCount: number;
    }
  | {
      type: typeof AnomalyType.Similarity;
      similarity: number;
      threshold: number;
    };
export const anomalySchema = z.union([
  z.object({
    type: z.literal(AnomalyType.StatusCode),
    from: z.number(),
    to: z.number(),
  }),
  z.object({
    type: z.literal(AnomalyType.Redirect),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  z.object({
    type: z.literal(AnomalyType.Headers),
    headerName: z.string(),
    from: z.array(z.string()).optional(),
    to: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal(AnomalyType.ReflectionCount),
    parameterName: z.string(),
    from: z.number(),
    to: z.number(),
  }),
  z.object({
    type: z.literal(AnomalyType.Body),
    check: z.literal("length"),
    from: z.number(),
    to: z.number(),
  }),
  z.object({
    type: z.literal(AnomalyType.Body),
    check: z.literal("content"),
    expectedDiffCount: z.number(),
    actualDiffCount: z.number(),
  }),
  z.object({
    type: z.literal(AnomalyType.Similarity),
    similarity: z.number(),
    threshold: z.number(),
  }),
]);

export const requestSchema = z.object({
  id: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  url: z.string().min(1),
  path: z.string().min(1),
  query: z.string(),
  method: z.string().min(1),
  headers: z.record(z.string(), z.array(z.string())),
  body: z.string(),
  tls: z.boolean(),
  raw: z.string().min(1),
  context: requestContextSchema,
});
export type Request = z.infer<typeof requestSchema>;

export const responseSchema = z.object({
  requestId: z.string().min(1),
  status: z.number().int().nonnegative(),
  headers: z.record(z.string(), z.array(z.string())),
  body: z.string().optional(),
  time: z.number().nonnegative(),
  length: z.number().int().nonnegative().optional(),
  raw: z.string().min(1).optional(),
});
export type Response = z.infer<typeof responseSchema>;
export const requestResponseSchema = z.object({
  request: requestSchema,
  response: responseSchema,
});
export type RequestResponse = z.infer<typeof requestResponseSchema>;

export const apiErrorCodeSchema = z.enum([
  "NO_PROJECT",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "IO",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: JsonValue;
}
export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.json().optional(),
});
export type ApiResult<T> =
  | { success: true; value: T }
  | { success: false; error: ApiError };
export function ok<T>(value: T): ApiResult<T> {
  return { success: true, value };
}
export function error(
  message: string,
  code: ApiErrorCode = "INTERNAL",
  details?: JsonValue,
): ApiResult<never> {
  return { success: false, error: { code, message, details } };
}

export const settingsSchema = z.object({
  delay: z.number().int().nonnegative(),
  requestTimeoutSeconds: z.number().positive(),
  scanTimeoutSeconds: z.number().positive().optional(),
  autoDetectMaxSize: z.boolean(),
  maxQuerySize: z.number().int().positive().optional(),
  maxHeaderSize: z.number().int().positive().optional(),
  maxBodySize: z.number().int().positive().optional(),
  learnRequestsCount: z.number().int().min(3),
  wafDetection: z.boolean(),
  ignoreCloudflareBlocks: z.boolean(),
  additionalChecks: z.boolean(),
  debug: z.boolean(),
  autopilotEnabled: z.boolean(),
  updateContentLength: z.boolean(),
  ignoreAnomalyTypes: z.array(anomalyTypeSchema),
  addCacheBusterParameter: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
export interface SettingsDocument {
  revision: number;
  settings: Settings;
}
export const settingsDocumentSchema = z.object({
  revision: z.number().int().nonnegative(),
  settings: settingsSchema,
});
export interface SettingsPatch {
  revision: number;
  changes: Partial<Settings>;
}
export const settingsPatchSchema = z.object({
  revision: z.number().int().nonnegative(),
  changes: settingsSchema.partial().strict(),
});

export interface ParamMinerConfig {
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
  ignoreCloudflareBlocks?: boolean;
  additionalChecks: boolean;
  ignoreAnomalyTypes: AnomalyType[];
  customValue?: string;
  customValueType?: ParameterValueType;
  jsonBodyPath?: string;
  maxParametersAmount?: number;
  delayBetweenRequests: number;
  requestTimeoutSeconds?: number;
  scanTimeoutSeconds?: number;
  debug: boolean;
}
export const paramMinerConfigSchema = z.object({
  attackType: attackTypeSchema,
  learnRequestsCount: z.number().int().min(3),
  autoDetectMaxSize: z.boolean(),
  maxQuerySize: z.number().int().positive().optional(),
  maxHeaderSize: z.number().int().positive().optional(),
  maxBodySize: z.number().int().positive().optional(),
  updateContentLength: z.boolean(),
  autopilotEnabled: z.boolean().optional(),
  addCacheBusterParameter: z.boolean(),
  wafDetection: z.boolean(),
  ignoreCloudflareBlocks: z.boolean().optional(),
  additionalChecks: z.boolean(),
  ignoreAnomalyTypes: z.array(anomalyTypeSchema),
  customValue: z.string().min(1).optional(),
  customValueType: parameterValueTypeSchema.optional(),
  jsonBodyPath: z.string().min(1).optional(),
  maxParametersAmount: z.number().int().positive().optional(),
  delayBetweenRequests: z.number().int().nonnegative(),
  requestTimeoutSeconds: z.number().positive().optional(),
  scanTimeoutSeconds: z.number().positive().optional(),
  debug: z.boolean(),
});

export function settingsToParamMinerConfig(
  settings: Settings,
  overrides: Partial<ParamMinerConfig> = {},
): ParamMinerConfig {
  return {
    attackType: overrides.attackType ?? "query",
    learnRequestsCount: settings.learnRequestsCount,
    autoDetectMaxSize: settings.autoDetectMaxSize,
    maxQuerySize: settings.maxQuerySize,
    maxHeaderSize: settings.maxHeaderSize,
    maxBodySize: settings.maxBodySize,
    updateContentLength: settings.updateContentLength,
    autopilotEnabled: settings.autopilotEnabled,
    addCacheBusterParameter: settings.addCacheBusterParameter,
    wafDetection: settings.wafDetection,
    ignoreCloudflareBlocks: settings.ignoreCloudflareBlocks,
    additionalChecks: settings.additionalChecks,
    ignoreAnomalyTypes: settings.ignoreAnomalyTypes,
    customValueType: "string",
    delayBetweenRequests: settings.delay,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    scanTimeoutSeconds: settings.scanTimeoutSeconds,
    debug: settings.debug,
    ...overrides,
  };
}

export const wordlistStatusSchema = z.enum([
  "pending",
  "active",
  "disabled",
  "pending_delete",
]);
export interface Wordlist {
  id: string;
  name: string;
  enabled: boolean;
  attackTypes: AttackType[];
  status: z.infer<typeof wordlistStatusSchema>;
  error?: string;
}
export const wordlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  attackTypes: z.array(attackTypeSchema).min(1),
  status: wordlistStatusSchema,
  error: z.string().optional(),
});

export type RequestSummary = {
  requestId: string;
  responseStatus: number;
  responseTime: number;
  responseLength: number;
};
export type SentRequest = RequestSummary & {
  parametersSent: number;
  parametersTested?: number;
  context: RequestContext;
};
export const sentRequestSchema = z.object({
  requestId: z.string(),
  responseStatus: z.number().int(),
  responseTime: z.number().nonnegative(),
  responseLength: z.number().int().nonnegative(),
  parametersSent: z.number().int().nonnegative(),
  parametersTested: z.number().int().nonnegative().optional(),
  context: requestContextSchema,
});
export type SessionFinding = {
  requestId: string;
  responseStatus: number;
  responseLength: number;
  parameter: Parameter;
  anomaly: Anomaly;
};
export const sessionFindingSchema = z.object({
  requestId: z.string(),
  responseStatus: z.number().int(),
  responseLength: z.number().int().nonnegative(),
  parameter: parameterSchema,
  anomaly: anomalySchema,
});
export type SessionRerun = { targetRequest: Request; config: ParamMinerConfig };
export const sessionRerunSchema = z.object({
  targetRequest: requestSchema,
  config: paramMinerConfigSchema,
});

export interface SessionRef {
  projectId: string;
  sessionId: string;
}
export const sessionRefSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
});

export function compareSessionIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export interface SessionDescriptor {
  ref: SessionRef;
  state: MiningSessionState;
  phase: MiningSessionPhase;
  totalParametersAmount: number;
  totalLearnRequests: number;
  parametersSent: number;
  requestsSent: number;
  findingsCount: number;
  logsCount: number;
  createdAt: number;
  updatedAt: number;
  rerun?: SessionRerun;
  error?: ApiError;
}
export const sessionDescriptorSchema = z.object({
  ref: sessionRefSchema,
  state: engineStateSchema,
  phase: enginePhaseSchema,
  totalParametersAmount: z.number().int().nonnegative(),
  totalLearnRequests: z.number().int().nonnegative(),
  parametersSent: z.number().int().nonnegative(),
  requestsSent: z.number().int().nonnegative(),
  findingsCount: z.number().int().nonnegative(),
  logsCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  rerun: sessionRerunSchema.optional(),
  error: apiErrorSchema.optional(),
});
export interface ProjectSessionSnapshot {
  version: 2;
  projectId: string;
  revision: number;
  sessions: SessionDescriptor[];
}
export const projectSessionSnapshotSchema = z.object({
  version: z.literal(2),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sessions: z.array(sessionDescriptorSchema),
});
export type SessionEntryKind = "request" | "finding" | "log";
export type SessionEntryInput =
  | { kind: "request"; value: SentRequest }
  | { kind: "finding"; value: SessionFinding }
  | { kind: "log"; value: string };
export type Sequenced<T> = T & { sequence: number };
export type SessionEntry = SessionEntryInput & { sequence: number };
export type SessionEntryValue = SessionEntry["value"];
export const sessionEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    sequence: z.number().int().positive(),
    kind: z.literal("request"),
    value: sentRequestSchema,
  }),
  z.object({
    sequence: z.number().int().positive(),
    kind: z.literal("finding"),
    value: sessionFindingSchema,
  }),
  z.object({
    sequence: z.number().int().positive(),
    kind: z.literal("log"),
    value: z.string(),
  }),
]);
export interface SessionEntrySort {
  field:
    | "sequence"
    | "requestId"
    | "responseStatus"
    | "responseTime"
    | "responseLength"
    | "parametersSent"
    | "parametersTested"
    | "context"
    | "parameter"
    | "anomaly";
  direction: "asc" | "desc";
}
export interface SessionEntriesQuery {
  ref: SessionRef;
  kind: SessionEntryKind;
  cursor?: string;
  limit?: number;
  sort?: SessionEntrySort;
  filter?: string;
}
export const sessionEntriesQuerySchema = z.object({
  ref: sessionRefSchema,
  kind: z.enum(["request", "finding", "log"]),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(1_000).optional(),
  sort: z
    .object({
      field: z.enum([
        "sequence",
        "requestId",
        "responseStatus",
        "responseTime",
        "responseLength",
        "parametersSent",
        "parametersTested",
        "context",
        "parameter",
        "anomaly",
      ]),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  filter: z.string().max(1_000).optional(),
});
export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
  total: number;
  snapshotMaxSequence: number;
}
export function cursorPageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().optional(),
    total: z.number().int().nonnegative(),
    snapshotMaxSequence: z.number().int().nonnegative(),
  });
}
export type SessionChange =
  | { type: "upsert"; session: SessionDescriptor }
  | {
      type: "entries";
      ref: SessionRef;
      entries: SessionEntry[];
      session: SessionDescriptor;
    }
  | { type: "delete"; refs: SessionRef[] }
  | {
      type: "terminal";
      session: SessionDescriptor;
      error?: ApiError;
    };
export const sessionChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("upsert"), session: sessionDescriptorSchema }),
  z.object({
    type: z.literal("entries"),
    ref: sessionRefSchema,
    entries: z.array(sessionEntrySchema),
    session: sessionDescriptorSchema,
  }),
  z.object({ type: z.literal("delete"), refs: z.array(sessionRefSchema) }),
  z.object({
    type: z.literal("terminal"),
    session: sessionDescriptorSchema,
    error: apiErrorSchema.optional(),
  }),
]);
export interface SessionChangeEnvelope {
  version: 1;
  projectId: string;
  revision: number;
  changes: SessionChange[];
}
export const sessionChangeEnvelopeSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  changes: z.array(sessionChangeSchema).min(1),
});
