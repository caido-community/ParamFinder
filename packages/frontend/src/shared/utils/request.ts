import type { Request } from "shared";

export type ParsedRequest = {
  path: string;
  query: string;
  method: string;
  headers: Record<string, string[]>;
  body: string;
};

export type ParsedResponse = {
  headers: Record<string, string[]>;
  body: string;
};

export type RawRequestSelection = {
  raw: string;
  isTls: boolean;
  host: string;
  port: number;
  path?: string;
  query?: string;
};

export function toCrlf(raw: string): string {
  return raw
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\r\n");
}

export function parseRequest(raw: string): ParsedRequest {
  const { lines, body } = parseMessage(raw);
  const [method = "GET", fullPath = "/"] = (lines.shift() ?? "").split(" ");
  const querySeparator = fullPath.indexOf("?");
  const path =
    querySeparator === -1 ? fullPath : fullPath.slice(0, querySeparator);
  const query = querySeparator === -1 ? "" : fullPath.slice(querySeparator + 1);

  return {
    path,
    query,
    method,
    headers: parseHeaders(lines),
    body,
  };
}

export function parseResponse(raw: string): ParsedResponse {
  const { lines, body } = parseMessage(raw);
  lines.shift();
  return { headers: parseHeaders(lines), body };
}

function parseMessage(raw: string): { lines: string[]; body: string } {
  const [head = "", ...bodyParts] = raw.replaceAll("\r\n", "\n").split("\n\n");
  const lines = head.split("\n");
  return { lines, body: bodyParts.join("\n\n") };
}

function parseHeaders(lines: string[]): Record<string, string[]> {
  const headers: Record<string, string[]> = {};

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    headers[name] = [...(headers[name] ?? []), value];
  }
  return headers;
}

export function createRequestFromSelection(
  selection: RawRequestSelection,
): Request {
  const parsed = parseRequest(selection.raw);
  const path = selection.path ?? parsed.path;
  const query = selection.query ?? parsed.query;
  const protocol = selection.isTls ? "https" : "http";

  return {
    id: generateID(),
    host: selection.host,
    port: selection.port,
    url: `${protocol}://${selection.host}:${selection.port}${path}${query ? `?${query}` : ""}`,
    path,
    query,
    method: parsed.method,
    headers: parsed.headers,
    body: parsed.body,
    tls: selection.isTls,
    raw: selection.raw,
    context: "discovery",
  };
}

export function generateID(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
