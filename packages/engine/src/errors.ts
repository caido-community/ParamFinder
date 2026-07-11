import type { ZodError } from "zod";

export type EngineErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_REQUEST"
  | "INVALID_RUN_OPTIONS"
  | "MUTATION_ERROR"
  | "UNSUPPORTED_REQUEST_SHAPE"
  | "PROVIDER_ERROR"
  | "RUN_ABORTED"
  | "RUN_TIMEOUT"
  | "INTERNAL_ERROR";

export class EngineError extends Error {
  public readonly code: EngineErrorCode;
  public readonly cause?: unknown;

  constructor(
    code: EngineErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export function toEngineError(
  error: unknown,
  fallbackCode: EngineErrorCode = "INTERNAL_ERROR",
): EngineError {
  if (error instanceof EngineError) {
    return error;
  }

  if (error instanceof Error) {
    return new EngineError(fallbackCode, error.message, { cause: error });
  }

  return new EngineError(fallbackCode, String(error), { cause: error });
}

function formatValidationPath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "root";
  }

  return path.map(String).join(".");
}

export function fromZodError(
  code: EngineErrorCode,
  subject: string,
  error: ZodError,
): EngineError {
  const details = error.issues
    .map((issue) => `${formatValidationPath(issue.path)}: ${issue.message}`)
    .join("; ");

  return new EngineError(
    code,
    details ? `Invalid ${subject}: ${details}` : `Invalid ${subject}`,
    { cause: error },
  );
}
