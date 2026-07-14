import { z } from "zod";

import { parseJsonBodyPath } from "./json-body-path";
import { AnomalyType, ATTACK_TYPES, PARAMETER_VALUE_TYPES } from "./types";

export const anomalyTypeSchema = z.enum(AnomalyType);

export const engineConfigSchema = z
  .object({
    attackType: z.enum(ATTACK_TYPES),
    learnRequestsCount: z.number().int().min(3),
    autoDetectMaxSize: z.boolean(),
    maxQuerySize: z.number().int().positive().optional(),
    maxHeaderSize: z.number().int().positive().optional(),
    maxBodySize: z.number().int().positive().optional(),
    updateContentLength: z.boolean(),
    autopilotEnabled: z.boolean(),
    addCacheBusterParameter: z.boolean(),
    wafDetection: z.boolean(),
    ignoreCloudflareBlocks: z.boolean(),
    additionalChecks: z.boolean(),
    ignoreAnomalyTypes: z.array(anomalyTypeSchema),
    customValue: z.string().min(1).optional(),
    customValueType: z.enum(PARAMETER_VALUE_TYPES),
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

export type EngineConfig = z.infer<typeof engineConfigSchema>;
export type EngineConfigInput = Partial<EngineConfig>;
