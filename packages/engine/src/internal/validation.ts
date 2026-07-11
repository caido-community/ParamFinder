import { z } from "zod";

import { parseJsonBodyPath } from "../json-body-path";
import { RunControl } from "../run-control";
import {
  AnomalyType,
  ATTACK_TYPES,
  type BaselineProfile,
  type EngineConfig,
  type EngineRequest,
  type EngineResponse,
  INSPECTABLE_BODY_KINDS,
  PARAMETER_VALUE_TYPES,
  REQUEST_CONTEXTS,
  type RunOptions,
  type StableFactors,
} from "../types";

const headersSchema = z.record(z.string(), z.array(z.string()));
const anomalyTypeSchema = z.enum(AnomalyType);

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

const engineResponseSchema: z.ZodType<EngineResponse> = z.object({
  requestId: z.string().min(1),
  status: z.number().int().nonnegative(),
  headers: headersSchema,
  body: z.string().optional(),
  time: z.number().nonnegative(),
  length: z.number().int().nonnegative().optional(),
  raw: z.string().min(1).optional(),
});

const stableFactorsSchema: z.ZodType<StableFactors> = z.object({
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

const additionalChecksResultSchema = z.object({
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

export const engineConfigSchema: z.ZodType<EngineConfig> = z
  .object({
    attackType: z.enum(ATTACK_TYPES),
    learnRequestsCount: z.number().int().min(3),
    autoDetectMaxSize: z.boolean(),
    maxQuerySize: z.number().int().positive().optional(),
    maxHeaderSize: z.number().int().positive().optional(),
    maxBodySize: z.number().int().positive().optional(),
    updateContentLength: z.boolean(),
    autopilotEnabled: z.boolean().optional(),
    addCacheBusterParameter: z.boolean(),
    wafDetection: z.boolean(),
    ignoreCloudflareBlocks: z.boolean(),
    additionalChecks: z.boolean(),
    ignoreAnomalyTypes: z.array(anomalyTypeSchema),
    customValue: z.string().min(1).optional(),
    customValueType: z.enum(PARAMETER_VALUE_TYPES).optional(),
    jsonBodyPath: z.string().min(1).optional(),
    maxParametersAmount: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const hasExplicitMaxSize =
      value.maxQuerySize !== undefined ||
      value.maxHeaderSize !== undefined ||
      value.maxBodySize !== undefined;

    if (value.autoDetectMaxSize && hasExplicitMaxSize) {
      ctx.addIssue({
        code: "custom",
        message:
          "Cannot set explicit max size values when autoDetectMaxSize is enabled",
      });
    }

    if (
      value.customValueType === "integer" &&
      value.customValue !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Cannot set customValue when customValueType is integer",
      });
    }

    if (value.jsonBodyPath !== undefined) {
      try {
        parseJsonBodyPath(value.jsonBodyPath);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["jsonBodyPath"],
          message: "Invalid JSON body path",
        });
      }
    }
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
