import type { EngineRequest, HeaderMap, LoggerFn, LoggerLevel } from "./types";

export const DEFAULT_LEARNING_PARAMETER_NAME_LENGTH = 10;
export const DEFAULT_LEARNING_PARAMETER_VALUE_LENGTH = 10;
export const MAX_HEURISTIC_BODY_LENGTH = 256 * 1024;

export function sampleBody(body: string): string {
  if (body.length <= MAX_HEURISTIC_BODY_LENGTH) {
    return body;
  }

  const sampledCharacters = MAX_HEURISTIC_BODY_LENGTH - 2;
  const segmentLength = Math.floor(sampledCharacters / 3);
  const middleStart = Math.floor((body.length - segmentLength) / 2);
  const endLength = sampledCharacters - segmentLength * 2;

  return [
    body.slice(0, segmentLength),
    body.slice(middleStart, middleStart + segmentLength),
    body.slice(-endLength),
  ].join("\n");
}

export function normalizeHeaderName(name: string): string {
  return name.toLowerCase();
}

function findHeaderKey(headers: HeaderMap, name: string): string | undefined {
  const target = normalizeHeaderName(name);
  return Object.keys(headers).find(
    (headerName) => normalizeHeaderName(headerName) === target,
  );
}

export function appendHeader(
  headers: HeaderMap,
  name: string,
  value: string,
): void {
  const key = findHeaderKey(headers, name) ?? name;
  if (!headers[key]) {
    headers[key] = [];
  }

  headers[key].push(value);
}

export function getHeaderValues(
  headers: HeaderMap,
  name: string,
): string[] | undefined {
  const key = findHeaderKey(headers, name);
  return key ? headers[key] : undefined;
}

export function getFirstHeaderValue(
  headers: HeaderMap,
  name: string,
): string | undefined {
  return getHeaderValues(headers, name)?.[0];
}

export function hasHeader(headers: HeaderMap, name: string): boolean {
  return findHeaderKey(headers, name) !== undefined;
}

export function headerValuesEqual(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function getNormalizedHeaderNames(headers: HeaderMap): string[] {
  return Array.from(new Set(Object.keys(headers).map(normalizeHeaderName)));
}

export function randomString(length: number, random: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";

  for (let index = 0; index < length; index += 1) {
    const alphabetIndex = Math.floor(random() * alphabet.length);
    value += alphabet[alphabetIndex] ?? "a";
  }

  return value;
}

export function getUtf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function buildUrl(
  request: Pick<EngineRequest, "tls" | "host" | "port" | "path" | "query">,
): string {
  const protocol = request.tls ? "https" : "http";
  const defaultPort = request.tls ? 443 : 80;
  const port = request.port === defaultPort ? "" : `:${request.port}`;
  const query = request.query ? `?${request.query}` : "";
  return `${protocol}://${request.host}${port}${request.path}${query}`;
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

export function buildFragmentCounts(
  text: string,
  substringLength: number = 2,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index <= text.length - substringLength; index += 1) {
    const fragment = text.slice(index, index + substringLength);
    counts.set(fragment, (counts.get(fragment) ?? 0) + 1);
  }

  return counts;
}

function countFragmentMatches(
  fragmentCounts: Map<string, number>,
  text: string,
  substringLength: number,
): number {
  const remaining = new Map(fragmentCounts);
  let matches = 0;
  for (let index = 0; index <= text.length - substringLength; index += 1) {
    const fragment = text.slice(index, index + substringLength);
    const count = remaining.get(fragment) ?? 0;
    if (count > 0) {
      remaining.set(fragment, count - 1);
      matches += 1;
    }
  }

  return matches;
}

export function similarityFromFragmentCounts(
  referenceCounts: Map<string, number>,
  referenceLength: number,
  second: string,
  substringLength: number = 2,
): number {
  const right = second.toLowerCase();
  if (referenceLength < substringLength || right.length < substringLength) {
    return 0;
  }

  const matches = countFragmentMatches(referenceCounts, right, substringLength);
  return (
    (matches * 2) / (referenceLength + right.length - (substringLength - 1) * 2)
  );
}

export function stringSimilarity(
  first: string,
  second: string,
  substringLength: number = 2,
): number {
  if (first === second) {
    return 1;
  }

  const left = sampleBody(first).toLowerCase();
  return similarityFromFragmentCounts(
    buildFragmentCounts(left, substringLength),
    left.length,
    sampleBody(second),
    substringLength,
  );
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function countLineDifferencesFromLeft(
  left: string[],
  second: string,
): number {
  const right = splitLines(second);
  const maxLength = Math.max(left.length, right.length);
  let differences = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if ((left[index] ?? "") !== (right[index] ?? "")) {
      differences += 1;
    }
  }

  return differences;
}

export function countLineDifferences(first: string, second: string): number {
  if (first === second) {
    return 0;
  }

  return countLineDifferencesFromLeft(splitLines(first), second);
}

export function sanitizeWords(words: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    cleaned.push(trimmed);
  }

  return cleaned;
}

export function emitLog(
  logger: LoggerFn | undefined,
  level: LoggerLevel,
  message: string,
): void {
  logger?.(level, message);
}
