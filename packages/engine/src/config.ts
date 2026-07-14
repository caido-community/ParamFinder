import type { z } from "zod";

import { type EngineErrorCode, fromZodError } from "./errors";
import {
  baselineProfileSchema,
  discoverInputSchema,
  engineConfigSchema,
  engineRequestSchema,
  learnInputSchema,
  runInputSchema,
  runOptionsSchema,
  wordsSchema,
} from "./internal/validation";
import type {
  BaselineProfile,
  EngineConfig,
  EngineConfigInput,
  EngineDiscoverInput,
  EngineLearnInput,
  EngineRequest,
  EngineRunInput,
  RunOptions,
} from "./types";

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  errorCode: EngineErrorCode,
  subject: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw fromZodError(errorCode, subject, result.error);
  }

  return result.data;
}

function parseWords(words: unknown, subject: string): string[] {
  return parseWithSchema(wordsSchema, words, "INVALID_REQUEST", subject);
}

function assertMatchesSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  errorCode: EngineErrorCode,
  subject: string,
): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw fromZodError(errorCode, subject, result.error);
  }
}

export function parseEngineRequest(request: unknown): EngineRequest {
  return parseWithSchema(
    engineRequestSchema,
    request,
    "INVALID_REQUEST",
    "request",
  );
}

export function parseEngineConfig(config: unknown): EngineConfig {
  return parseWithSchema(
    engineConfigSchema,
    config,
    "INVALID_CONFIG",
    "engine config",
  );
}

export function createEngineConfig(
  overrides: EngineConfigInput = {},
): EngineConfig {
  const attackType = overrides.attackType ?? "query";

  return parseEngineConfig({
    attackType,
    learnRequestsCount: overrides.learnRequestsCount ?? 6,
    autoDetectMaxSize: overrides.autoDetectMaxSize ?? true,
    maxQuerySize: overrides.maxQuerySize,
    maxHeaderSize: overrides.maxHeaderSize,
    maxBodySize: overrides.maxBodySize,
    updateContentLength: overrides.updateContentLength ?? attackType === "body",
    autopilotEnabled: overrides.autopilotEnabled ?? attackType === "query",
    addCacheBusterParameter: overrides.addCacheBusterParameter ?? true,
    wafDetection: overrides.wafDetection ?? true,
    ignoreCloudflareBlocks: overrides.ignoreCloudflareBlocks ?? false,
    additionalChecks: overrides.additionalChecks ?? true,
    ignoreAnomalyTypes: overrides.ignoreAnomalyTypes ?? [],
    customValue: overrides.customValue,
    customValueType: overrides.customValueType ?? "string",
    jsonBodyPath: overrides.jsonBodyPath,
    maxParametersAmount: overrides.maxParametersAmount,
  });
}

function parseRunOptions(runOptions?: unknown): RunOptions | undefined {
  if (runOptions === undefined) {
    return undefined;
  }

  return parseWithSchema(
    runOptionsSchema,
    runOptions,
    "INVALID_RUN_OPTIONS",
    "run options",
  );
}

export function createRunOptions(overrides: RunOptions = {}): RunOptions {
  return parseRunOptions(overrides) ?? {};
}

export function parseRunInput(input: unknown): EngineRunInput {
  const parsedInput = parseWithSchema(
    runInputSchema,
    input,
    "INVALID_REQUEST",
    "run input",
  );

  return {
    request: parseEngineRequest(parsedInput.request),
    words: parseWords(parsedInput.words, "run input words"),
    engineConfig: parseEngineConfig(parsedInput.engineConfig),
    runOptions: parseRunOptions(parsedInput.runOptions),
  };
}

export function parseLearnInput(input: unknown): EngineLearnInput {
  const parsedInput = parseWithSchema(
    learnInputSchema,
    input,
    "INVALID_REQUEST",
    "learn input",
  );

  return {
    request: parseEngineRequest(parsedInput.request),
    engineConfig: parseEngineConfig(parsedInput.engineConfig),
    runOptions: parseRunOptions(parsedInput.runOptions),
  };
}

export function parseDiscoverInput(input: unknown): EngineDiscoverInput {
  const parsedInput = parseWithSchema(
    discoverInputSchema,
    input,
    "INVALID_REQUEST",
    "discover input",
  );
  assertMatchesSchema(
    baselineProfileSchema,
    parsedInput.profile,
    "INVALID_REQUEST",
    "discover input profile",
  );

  return {
    request: parseEngineRequest(parsedInput.request),
    words: parseWords(parsedInput.words, "discover input words"),
    engineConfig: parseEngineConfig(parsedInput.engineConfig),
    profile: parsedInput.profile as BaselineProfile,
    runOptions: parseRunOptions(parsedInput.runOptions),
  };
}
