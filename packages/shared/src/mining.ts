import { z } from "zod";

import { apiErrorSchema } from "./api";
import {
  anomalySchema,
  anomalyTypeSchema,
  attackTypeSchema,
  enginePhaseSchema,
  engineStateSchema,
  parameterSchema,
  parameterValueTypeSchema,
  requestContextSchema,
  requestSchema,
} from "./primitives";

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

export const settingsChangesSchema = settingsSchema.partial().strict();
export type SettingsChanges = z.infer<typeof settingsChangesSchema>;

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
export type ParamMinerConfig = z.infer<typeof paramMinerConfigSchema>;

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

export const wordlistSchema = z.object({
  path: z.string().min(1),
  enabled: z.boolean(),
  attackTypes: z.array(attackTypeSchema).min(1),
});
export type Wordlist = z.infer<typeof wordlistSchema>;

export const sentRequestSchema = z.object({
  requestId: z.string(),
  responseStatus: z.number().int(),
  responseTime: z.number().nonnegative(),
  responseLength: z.number().int().nonnegative(),
  parametersSent: z.number().int().nonnegative(),
  parametersTested: z.number().int().nonnegative().optional(),
  context: requestContextSchema,
});
export type SentRequest = z.infer<typeof sentRequestSchema>;

export const sessionFindingSchema = z.object({
  requestId: z.string(),
  responseStatus: z.number().int(),
  responseLength: z.number().int().nonnegative(),
  parameter: parameterSchema,
  anomaly: anomalySchema,
});
export type SessionFinding = z.infer<typeof sessionFindingSchema>;

export const sessionRerunSchema = z.object({
  targetRequest: requestSchema,
  config: paramMinerConfigSchema,
});
export type SessionRerun = z.infer<typeof sessionRerunSchema>;

export const sessionRefSchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
});
export type SessionRef = z.infer<typeof sessionRefSchema>;

export function compareSessionIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
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
export type SessionDescriptor = z.infer<typeof sessionDescriptorSchema>;

export const projectSessionSnapshotSchema = z.object({
  version: z.literal(2),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sessions: z.array(sessionDescriptorSchema),
});
export type ProjectSessionSnapshot = z.infer<
  typeof projectSessionSnapshotSchema
>;

export type Sequenced<T> = T & { sequence: number };
export const sessionEntryInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request"), value: sentRequestSchema }),
  z.object({ kind: z.literal("finding"), value: sessionFindingSchema }),
  z.object({ kind: z.literal("log"), value: z.string() }),
]);
export type SessionEntryInput = z.infer<typeof sessionEntryInputSchema>;
export type SessionEntryKind = SessionEntryInput["kind"];
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
export type SessionEntry = z.infer<typeof sessionEntrySchema>;
export type SessionEntryValue = SessionEntry["value"];

export const sessionEntrySortFieldSchema = z.enum([
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
]);
export type SessionEntrySortField = z.infer<typeof sessionEntrySortFieldSchema>;
export const sessionEntrySortSchema = z.object({
  field: sessionEntrySortFieldSchema,
  direction: z.enum(["asc", "desc"]),
});
export type SessionEntrySort = z.infer<typeof sessionEntrySortSchema>;
export const sessionEntriesQuerySchema = z.object({
  ref: sessionRefSchema,
  kind: z.enum(["request", "finding", "log"]),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(1_000).optional(),
  sort: sessionEntrySortSchema.optional(),
  filter: z.string().max(1_000).optional(),
});
export type SessionEntriesQuery = z.infer<typeof sessionEntriesQuerySchema>;

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
export type SessionChange = z.infer<typeof sessionChangeSchema>;

export const sessionChangeEnvelopeSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  changes: z.array(sessionChangeSchema).min(1),
});
export type SessionChangeEnvelope = z.infer<typeof sessionChangeEnvelopeSchema>;

export const projectIdSchema = z.string().min(1);
export const sessionRefsSchema = z.array(sessionRefSchema).max(10_000);
export const wordlistImportSchema = z.object({
  data: z.string().min(1),
  filename: z.string().trim().min(1),
});
export const wordlistPathSchema = z.string().min(1);
export const requestIdSchema = z.string().min(1);
export const wordlistEnabledUpdateSchema = z.object({
  path: wordlistPathSchema,
  enabled: z.boolean(),
});
export const wordlistAttackTypesUpdateSchema = z.object({
  path: wordlistPathSchema,
  attackTypes: z.array(attackTypeSchema).min(1),
});
export const startMiningInputSchema = z.object({
  target: requestSchema,
  config: paramMinerConfigSchema,
});
