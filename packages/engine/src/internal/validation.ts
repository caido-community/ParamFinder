import { z } from "zod";

import { RunControl } from "../run-control";
import {
  type Anomaly,
  AnomalyType,
  type BaselineProfile,
  type EngineRequest,
  type EngineRequestResponse,
  type EngineResponse,
  INSPECTABLE_BODY_KINDS,
  type Parameter,
  REQUEST_CONTEXTS,
  type RunOptions,
  type StableFactors,
} from "../types";

export { anomalyTypeSchema, engineConfigSchema } from "../config-schema";

export const headersSchema = z.record(z.string(), z.array(z.string()));
export const parameterSchema: z.ZodType<Parameter> = z.object({
  name: z.string(),
  value: z.string(),
});
export const anomalySchema: z.ZodType<Anomaly> = z.union([
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

export const engineRequestSchema: z.ZodType<EngineRequest> = z.object({
  id: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  url: z.string().min(1),
  path: z.string().min(1),
  query: z.string(),
  method: z.string().min(1),
  headers: headersSchema,
  body: z.string(),
  tls: z.boolean(),
  raw: z.string().min(1),
  context: z.enum(REQUEST_CONTEXTS),
});

export const engineResponseSchema: z.ZodType<EngineResponse> = z.object({
  requestId: z.string().min(1),
  status: z.number().int().nonnegative(),
  headers: headersSchema,
  body: z.string(),
  time: z.number().nonnegative(),
  length: z.number().int().nonnegative(),
  raw: z.string().min(1).optional(),
});
export const engineRequestResponseSchema: z.ZodType<EngineRequestResponse> =
  z.object({ request: engineRequestSchema, response: engineResponseSchema });

export const stableFactorsSchema: z.ZodType<StableFactors> = z.object({
  bodyStable: z.boolean(),
  bodyLength: z.number().int().nonnegative(),
  bodyLengthStable: z.boolean(),
  headersStable: z.boolean(),
  statusCodeStable: z.boolean(),
  reflectionStable: z.boolean(),
  similarityStable: z.boolean(),
  redirectStable: z.boolean(),
  reflectionsCount: z.number().int().nonnegative(),
  statusCode: z.number().int().nonnegative(),
  unstableHeaders: z.array(z.string()),
  similarity: z.number().min(0).max(1),
  redirect: z.string().min(1).optional(),
});

export const additionalChecksResultSchema = z.object({
  handlesSpecialCharacters: z.boolean(),
  handlesEncodedSpecialCharacters: z.boolean(),
});

export const baselineProfileSchema: z.ZodType<BaselineProfile> = z.object({
  initialRequestResponse: z.object({
    request: engineRequestSchema,
    response: engineResponseSchema,
  }),
  stableFactors: stableFactorsSchema,
  bodyDiffReferenceCount: z.number().int().nonnegative(),
  wafResponse: engineResponseSchema.optional(),
  additionalChecks: additionalChecksResultSchema.optional(),
  maxSize: z.number().int().positive().optional(),
  bodyKind: z.enum(INSPECTABLE_BODY_KINDS).optional(),
  multipartBoundary: z.string().min(1).optional(),
});

export const runOptionsSchema: z.ZodType<RunOptions> = z.object({
  delayMs: z.number().int().min(0).optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  signal: z
    .custom<AbortSignal>(
      (value) => value instanceof AbortSignal,
      "Expected an AbortSignal",
    )
    .optional(),
  runControl: z
    .custom<RunControl>(
      (value) => value instanceof RunControl,
      "Expected a RunControl",
    )
    .optional(),
  onEvent: z
    .custom<
      RunOptions["onEvent"]
    >((value) => typeof value === "function", "Expected an event handler function")
    .optional(),
});

export const wordsSchema = z.array(z.string());

export const learnInputSchema: z.ZodType<{
  request: unknown;
  engineConfig: unknown;
  runOptions?: unknown;
}> = z.object({
  request: z.unknown(),
  engineConfig: z.unknown(),
  runOptions: z.unknown().optional(),
});

export const runInputSchema: z.ZodType<{
  request: unknown;
  words: unknown;
  engineConfig: unknown;
  runOptions?: unknown;
}> = z.object({
  request: z.unknown(),
  words: z.unknown(),
  engineConfig: z.unknown(),
  runOptions: z.unknown().optional(),
});

export const discoverInputSchema: z.ZodType<{
  request: unknown;
  words: unknown;
  engineConfig: unknown;
  profile: unknown;
  runOptions?: unknown;
}> = z.object({
  request: z.unknown(),
  words: z.unknown(),
  engineConfig: z.unknown(),
  profile: z.unknown(),
  runOptions: z.unknown().optional(),
});
