import { createEngineRequestFromRaw } from "@paramfinder/engine";
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
  const request = createEngineRequestFromRaw({
    raw,
    host: "localhost",
    port: 80,
    tls: false,
  });

  return {
    path: request.path,
    query: request.query,
    method: request.method,
    headers: request.headers,
    body: request.body,
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
  return createEngineRequestFromRaw({
    raw: selection.raw,
    host: selection.host,
    port: selection.port,
    tls: selection.isTls,
    path: selection.path,
    query: selection.query,
    context: "discovery",
  });
}
