export type BodyState =
  | { kind: "empty" }
  | { kind: "not-json"; reason: string }
  | { kind: "valid"; value: unknown };

export function evaluateJsonBody(raw?: string): BodyState {
  if (raw === undefined || raw.trim() === "") {
    return { kind: "empty" };
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {
        kind: "not-json",
        reason: "Body must be a JSON object at the root.",
      };
    }

    return { kind: "valid", value };
  } catch (err: unknown) {
    return {
      kind: "not-json",
      reason: err instanceof Error ? err.message : "Could not parse body",
    };
  }
}
