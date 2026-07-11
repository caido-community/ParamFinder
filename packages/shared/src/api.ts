import { z } from "zod";

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

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.json().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

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

export type CursorPage<T> = {
  items: T[];
  nextCursor?: string;
  total: number;
  snapshotMaxSequence: number;
};
