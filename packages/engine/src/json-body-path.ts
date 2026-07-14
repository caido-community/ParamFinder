import { getProperty, parsePath, stringifyPath } from "dot-prop";

import { isRecordObject } from "./value-guards";

export type JsonBodyPathSegment = string | number;

export function parseJsonBodyPath(
  path: string,
): readonly JsonBodyPathSegment[] {
  const normalized = stripRootSelector(path);
  if (normalized === "") {
    return [];
  }

  const segments = parsePath(normalized);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        (typeof segment === "string" && segment.length === 0) ||
        (typeof segment === "number" &&
          (!Number.isSafeInteger(segment) || segment < 0)),
    )
  ) {
    throw new Error(`Invalid JSON body path: ${path}`);
  }

  return segments;
}

export function formatJsonBodyPath(
  segments: readonly JsonBodyPathSegment[],
): string {
  if (segments.length === 0) {
    return "$";
  }

  const normalized = [...segments];
  if (
    normalized.some(
      (segment) =>
        (typeof segment === "string" && segment.length === 0) ||
        (typeof segment === "number" &&
          (!Number.isSafeInteger(segment) || segment < 0)),
    )
  ) {
    throw new Error("Invalid JSON body path segments");
  }
  const serialized = stringifyPath(normalized);
  const reparsed = parsePath(serialized);
  if (reparsed.length !== normalized.length) {
    throw new Error("Invalid JSON body path segments");
  }

  return serialized.startsWith("[") ? `$${serialized}` : `$.${serialized}`;
}

export function appendJsonBodyPath(
  parentPath: string,
  segment: JsonBodyPathSegment,
): string {
  return formatJsonBodyPath([...parseJsonBodyPath(parentPath), segment]);
}

export function resolveJsonBodyPath(
  root: unknown,
  path: string,
): Record<string, unknown> | undefined {
  if (!isRecordObject(root)) {
    return undefined;
  }

  let segments: readonly JsonBodyPathSegment[];
  try {
    segments = parseJsonBodyPath(path);
  } catch {
    return undefined;
  }
  const value = segments.length === 0 ? root : getProperty(root, segments);
  return isRecordObject(value) ? value : undefined;
}

export function isInjectableJsonBodyPath(root: unknown, path: string): boolean {
  return resolveJsonBodyPath(root, path) !== undefined;
}

function stripRootSelector(path: string): string {
  if (path === "$") {
    return "";
  }

  if (path.startsWith("$.")) {
    return path.slice(2);
  }

  if (path.startsWith("$[")) {
    return path.slice(1);
  }

  if (path.startsWith("$")) {
    throw new Error(`Invalid JSON body path: ${path}`);
  }

  return path;
}
