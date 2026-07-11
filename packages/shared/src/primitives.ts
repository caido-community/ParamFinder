import {
  type Anomaly,
  anomalySchema,
  ATTACK_TYPES,
  AnomalyType as EngineAnomalyType,
  type AnomalyType as EngineAnomalyTypeValue,
  AttackType as EngineAttackType,
  type AttackType as EngineAttackTypeValue,
  EnginePhase,
  type EnginePhase as EnginePhaseValue,
  type EngineRequest,
  type EngineRequestResponse,
  engineRequestResponseSchema,
  engineRequestSchema,
  type EngineResponse,
  engineResponseSchema,
  EngineState,
  type EngineState as EngineStateValue,
  type Parameter,
  PARAMETER_VALUE_TYPES,
  parameterSchema,
  REQUEST_CONTEXTS,
} from "@paramfinder/engine";
import { z } from "zod";

export const AnomalyType = EngineAnomalyType;
export type AnomalyType = EngineAnomalyTypeValue;
export const AttackType = EngineAttackType;
export type AttackType = EngineAttackTypeValue;
export const MiningSessionPhase = EnginePhase;
export type MiningSessionPhase = EnginePhaseValue;
export const MiningSessionState = EngineState;
export type MiningSessionState = EngineStateValue;
export type {
  Anomaly,
  EngineRequest as Request,
  EngineRequestResponse as RequestResponse,
  EngineResponse as Response,
  Parameter,
};

export const attackTypeSchema = z.enum(ATTACK_TYPES);
export const requestContextSchema = z.enum(REQUEST_CONTEXTS);
export const parameterValueTypeSchema = z.enum(PARAMETER_VALUE_TYPES);
export const engineStateSchema = z.enum(EngineState);
export const enginePhaseSchema = z.enum(EnginePhase);
export const anomalyTypeSchema = z.enum(EngineAnomalyType);

export type RequestContext = z.infer<typeof requestContextSchema>;
export type ParameterValueType = z.infer<typeof parameterValueTypeSchema>;

export { anomalySchema, parameterSchema };

export const requestSchema: z.ZodType<EngineRequest> = engineRequestSchema;
export const responseSchema: z.ZodType<EngineResponse> = engineResponseSchema;
export const requestResponseSchema = engineRequestResponseSchema;
