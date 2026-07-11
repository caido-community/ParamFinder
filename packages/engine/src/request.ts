import type { EngineRequest, HeaderMap, RequestContext } from "./types";
import { appendHeader, buildUrl, getUtf8ByteLength, hasHeader } from "./utils";

type HeaderValue = string | string[];
type HeaderInput = Headers | HeaderMap | Record<string, HeaderValue>;

export interface CreateEngineRequestInput {
  url: string;
  method?: string;
  headers?: HeaderInput;
  body?: string;
  id?: string;
  context?: RequestContext;
}

export interface CreateEngineRequestHeadersInput {
  headers?: string[];
  defaults?: HeaderInput;
  body?: string;
  contentType?: string;
}

export function createEngineRequest(
  input: CreateEngineRequestInput,
): EngineRequest {
  const parsedUrl = new URL(input.url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }

  const body = input.body ?? "";
  const method = (input.method ?? (body ? "POST" : "GET")).toUpperCase();
  const headers = normalizeHeaders(input.headers);

  if (!hasHeader(headers, "Host")) {
    appendHeader(headers, "Host", parsedUrl.host);
  }

  const inferredContentType = inferContentType(body);
  if (body && inferredContentType && !hasHeader(headers, "Content-Type")) {
    appendHeader(headers, "Content-Type", inferredContentType);
  }

  if (body && !hasHeader(headers, "Content-Length")) {
    appendHeader(headers, "Content-Length", getUtf8ByteLength(body).toString());
  }

  const path = parsedUrl.pathname || "/";
  const query = parsedUrl.search.length > 0 ? parsedUrl.search.slice(1) : "";
  const port = parsedUrl.port
    ? Number(parsedUrl.port)
    : parsedUrl.protocol === "https:"
      ? 443
      : 80;
  const tls = parsedUrl.protocol === "https:";

  return {
    id: input.id ?? createRequestId(),
    host: parsedUrl.hostname,
    port,
    url: buildUrl({
      host: parsedUrl.hostname,
      port,
      tls,
      path,
      query,
    }),
    path,
    query,
    method,
    headers,
    body,
    tls,
    raw: buildRawRequest(method, path, query, headers, body),
    context: input.context ?? "discovery",
  };
}

export function createEngineRequestHeaders(
  input: CreateEngineRequestHeadersInput,
): HeaderMap {
  const headers: HeaderMap = {};

  for (const header of input.headers ?? []) {
    const separatorIndex = header.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid header value: ${header}`);
    }

    const name = header.slice(0, separatorIndex).trim();
    const value = header.slice(separatorIndex + 1).trim();
    if (!name || !value) {
      throw new Error(`Invalid header value: ${header}`);
    }

    appendHeader(headers, name, value);
  }

  const defaultHeaders = normalizeHeaders(input.defaults);
  for (const [name, values] of Object.entries(defaultHeaders)) {
    if (hasHeader(headers, name)) {
      continue;
    }

    for (const value of values) {
      appendHeader(headers, name, value);
    }
  }

  const body = input.body ?? "";
  if (body && input.contentType && !hasHeader(headers, "Content-Type")) {
    appendHeader(headers, "Content-Type", input.contentType);
  }

  if (body && !hasHeader(headers, "Content-Length")) {
    appendHeader(headers, "Content-Length", getUtf8ByteLength(body).toString());
  }

  return headers;
}

export function canSendRequestBody(method: string): boolean {
  return method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD";
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeHeaders(headers?: HeaderInput): HeaderMap {
  if (!headers) {
    return {};
  }

  const normalized: HeaderMap = {};

  if (headers instanceof Headers) {
    headers.forEach((value, name) => {
      appendHeader(normalized, name, value);
    });
    return normalized;
  }

  for (const [name, value] of Object.entries(headers)) {
    const values = Array.isArray(value) ? value : [value];
    for (const headerValue of values) {
      appendHeader(normalized, name, headerValue);
    }
  }

  return normalized;
}

function buildRawRequest(
  method: string,
  path: string,
  query: string,
  headers: HeaderMap,
  body: string,
): string {
  const pathWithQuery = query ? `${path}?${query}` : path;
  const headerLines: string[] = [];

  for (const [name, values] of Object.entries(headers)) {
    for (const value of values) {
      headerLines.push(`${name}: ${value}`);
    }
  }

  return `${[`${method} ${pathWithQuery} HTTP/1.1`, ...headerLines].join("\r\n")}\r\n\r\n${body}`;
}

function inferContentType(body: string): string | undefined {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return undefined;
  }

  if (
    (trimmedBody.startsWith("{") && trimmedBody.endsWith("}")) ||
    (trimmedBody.startsWith("[") && trimmedBody.endsWith("]"))
  ) {
    return "application/json";
  }

  if (trimmedBody.includes("=")) {
    return "application/x-www-form-urlencoded";
  }

  return undefined;
}
