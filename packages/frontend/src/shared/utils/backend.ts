import { apiErrorSchema } from "shared";

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  const apiError = apiErrorSchema.safeParse(err);
  if (apiError.success) {
    return apiError.data.message;
  }

  return String(err);
}
