import { HttpForge } from "ts-http-forge";

import { EngineError } from "./errors";
import { resolveJsonBodyPath } from "./json-body-path";
import {
  type AttackType,
  type EngineRequest,
  type HeaderMap,
  type InspectableBodyKind,
  MUTABLE_BODY_KINDS,
  type MutableBodyKind,
  type Parameter,
  type ParameterValueType,
  type RequestContext,
} from "./types";
import { buildUrl, cloneHeaders, getUtf8ByteLength } from "./utils";

interface MutateRequestOptions {
  baseRequest: EngineRequest;
  attackType: AttackType;
  parameters: Parameter[];
  context: RequestContext;
  updateContentLength: boolean;
  customValueType?: ParameterValueType;
  jsonBodyPath?: string;
  addCacheBusterParameter?: boolean;
  cacheBusterValue?: string;
}

interface MutationBudgetOptions {
  baseRequest: EngineRequest;
  attackType: AttackType;
  parameters: Parameter[];
  maxSize?: number;
  customValueType?: ParameterValueType;
  jsonBodyPath?: string;
}

interface RequestMutationMetadata {
  bodyKind: InspectableBodyKind;
  multipartBoundary?: string;
}

export function inspectRequest(
  baseRequest: EngineRequest,
): RequestMutationMetadata {
  const forge = HttpForge.create(baseRequest.raw);
  const contentType = getContentType(forge);
  const bodyKind = resolveBodyKind(forge, contentType);
  return {
    bodyKind,
    multipartBoundary: extractMultipartBoundary(contentType),
  };
}

export function mutateRequest(options: MutateRequestOptions): EngineRequest {
  const forge = HttpForge.create(options.baseRequest.raw);

  switch (options.attackType) {
    case "query":
      applyQueryInjection(forge, options.parameters);
      break;
    case "headers":
      applyHeaderInjection(forge, options.parameters, options);
      break;
    case "body":
      applyBodyInjection(forge, options.parameters, options);
      break;
    default:
      throw new EngineError(
        "MUTATION_ERROR",
        `Unsupported attack type: ${options.attackType satisfies never}`,
      );
  }

  if (options.updateContentLength) {
    updateContentLength(forge);
  }

  return toEngineRequest(options.baseRequest, forge, options.context);
}

export function wouldExceedMutationBudget(
  options: MutationBudgetOptions,
): boolean {
  if (options.maxSize === undefined) {
    return false;
  }

  switch (options.attackType) {
    case "headers":
      return options.parameters.length > options.maxSize;
    case "query": {
      const mutated = mutateRequest({
        baseRequest: options.baseRequest,
        attackType: "query",
        parameters: options.parameters,
        context: "discovery",
        updateContentLength: false,
      });
      return getUtf8ByteLength(mutated.query) > options.maxSize;
    }
    case "body": {
      const mutated = mutateRequest({
        baseRequest: options.baseRequest,
        attackType: "body",
        parameters: options.parameters,
        context: "discovery",
        updateContentLength: false,
        customValueType: options.customValueType,
        jsonBodyPath: options.jsonBodyPath,
      });
      return getUtf8ByteLength(mutated.body) > options.maxSize;
    }
    default: {
      const exhaustiveAttackType: never = options.attackType;
      return exhaustiveAttackType;
    }
  }
}

function applyQueryInjection(forge: HttpForge, parameters: Parameter[]): void {
  parameters.forEach((parameter) => {
    forge.addQueryParam(parameter.name, parameter.value);
  });
}

function applyHeaderInjection(
  forge: HttpForge,
  parameters: Parameter[],
  options: Pick<
    MutateRequestOptions,
    "addCacheBusterParameter" | "cacheBusterValue"
  >,
): void {
  parameters.forEach((parameter) => {
    forge.setHeader(parameter.name, parameter.value);
  });

  if (options.addCacheBusterParameter && options.cacheBusterValue) {
    forge.upsertQueryParam(options.cacheBusterValue, options.cacheBusterValue);
  }
}

function applyBodyInjection(
  forge: HttpForge,
  parameters: Parameter[],
  options: Pick<MutateRequestOptions, "customValueType" | "jsonBodyPath">,
): void {
  mutateBody(forge, parameters, options.customValueType, options.jsonBodyPath);
}

function mutateBody(
  forge: HttpForge,
  parameters: Parameter[],
  customValueType?: ParameterValueType,
  jsonBodyPath?: string,
): void {
  const bodyKind = resolveBodyKind(forge, getContentType(forge));
  if (!isMutableBodyKind(bodyKind)) {
    throw new EngineError(
      "UNSUPPORTED_REQUEST_SHAPE",
      `Unsupported body type for mutation: ${bodyKind}`,
    );
  }

  switch (bodyKind) {
    case "json":
      mutateJsonBody(forge, parameters, customValueType, jsonBodyPath);
      return;
    case "urlencoded":
      parameters.forEach((parameter) => {
        forge.setBodyParam(parameter.name, parameter.value);
      });
      return;
    case "multipart":
      mutateMultipartBody(forge, parameters);
      return;
  }
}

function mutateJsonBody(
  forge: HttpForge,
  parameters: Parameter[],
  customValueType?: ParameterValueType,
  jsonBodyPath?: string,
): void {
  const currentBody = forge.getBody() || "{}";
  let bodyObject: Record<string, unknown>;

  try {
    const parsedBody = currentBody ? JSON.parse(currentBody) : {};
    if (!isRecordObject(parsedBody)) {
      throw new EngineError(
        "UNSUPPORTED_REQUEST_SHAPE",
        "JSON request body must be an object at the root",
      );
    }

    bodyObject = parsedBody;
  } catch (error) {
    if (error instanceof EngineError) {
      throw error;
    }

    throw new EngineError(
      "MUTATION_ERROR",
      "Failed to parse JSON request body",
      {
        cause: error,
      },
    );
  }

  if (jsonBodyPath === undefined) {
    parameters.forEach((parameter) => {
      defineJsonParameter(
        bodyObject,
        parameter.name,
        toJsonParameterValue(parameter.value, customValueType),
      );
    });
  } else {
    const injectionTarget = resolveJsonBodyPath(bodyObject, jsonBodyPath);
    if (injectionTarget === undefined) {
      throw new EngineError(
        "UNSUPPORTED_REQUEST_SHAPE",
        `JSON body path did not resolve to an object: ${jsonBodyPath}`,
      );
    }

    parameters.forEach((parameter) => {
      defineJsonParameter(
        injectionTarget,
        parameter.name,
        toJsonParameterValue(parameter.value, customValueType),
      );
    });
  }

  if (!getContentType(forge)) {
    forge.setHeader("Content-Type", "application/json");
  }
  forge.body(JSON.stringify(bodyObject));
}

function mutateMultipartBody(forge: HttpForge, parameters: Parameter[]): void {
  const contentType =
    forge.getHeader("Content-Type") ?? forge.getHeader("content-type");
  const boundary = extractMultipartBoundary(contentType);
  if (!boundary) {
    throw new EngineError(
      "UNSUPPORTED_REQUEST_SHAPE",
      "Missing multipart boundary",
    );
  }

  const originalBody = forge.getBody() ?? "";
  const finalBoundary = `--${boundary}--`;
  const finalBoundaryIndex = findClosingBoundaryIndex(
    originalBody,
    finalBoundary,
  );
  if (finalBoundaryIndex === -1) {
    throw new EngineError(
      "UNSUPPORTED_REQUEST_SHAPE",
      "Invalid multipart body: missing final boundary",
    );
  }

  let body = originalBody.slice(0, finalBoundaryIndex);
  const lineEnding = originalBody.includes("\r\n") ? "\r\n" : "\n";
  if (body.length > 0 && !body.endsWith("\n")) {
    body += lineEnding;
  }

  parameters.forEach((parameter) => {
    body += `--${boundary}${lineEnding}Content-Disposition: form-data; name="${parameter.name}"${lineEnding}${lineEnding}${parameter.value}${lineEnding}`;
  });

  body += originalBody.slice(finalBoundaryIndex);
  forge.body(body);
}

function updateContentLength(forge: HttpForge): void {
  const body = forge.getBody() ?? "";
  if (body.length === 0) {
    forge.removeHeader("Content-Length");
    return;
  }

  forge.setHeader("Content-Length", getUtf8ByteLength(body).toString());
}

function toEngineRequest(
  baseRequest: EngineRequest,
  forge: HttpForge,
  context: RequestContext,
): EngineRequest {
  const path = forge.getPath() ?? baseRequest.path;
  const query = forge.getQuery() ?? "";
  const headers: HeaderMap =
    forge.getHeaders() ?? cloneHeaders(baseRequest.headers);
  const body = forge.getBody() ?? "";
  const method = forge.getMethod() ?? baseRequest.method;

  return {
    ...baseRequest,
    method,
    path,
    query,
    headers,
    body,
    raw: forge.build(),
    url: buildUrl({
      host: baseRequest.host,
      port: baseRequest.port,
      tls: baseRequest.tls,
      path,
      query,
    }),
    context,
  };
}

function extractMultipartBoundary(
  contentType?: string | null,
): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const match = contentType.match(
    /(?:^|;)\s*boundary\s*=\s*(?:"((?:\\.|[^"])*)"|([^;\s]+))/i,
  );
  const boundary = match?.[1]?.replace(/\\(.)/g, "$1") ?? match?.[2];
  return boundary || undefined;
}

function getContentType(forge: HttpForge): string | null {
  return forge.getHeader("Content-Type") ?? forge.getHeader("content-type");
}

function resolveBodyKind(
  forge: HttpForge,
  contentType: string | null,
): InspectableBodyKind {
  const bodyKind = normalizeBodyKind(forge.getBodyType());
  if (bodyKind !== "text") {
    return bodyKind;
  }

  return inferBodyKindFromContentType(contentType) ?? bodyKind;
}

function inferBodyKindFromContentType(
  contentType?: string | null,
): InspectableBodyKind | undefined {
  if (!contentType) {
    return undefined;
  }

  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();

  if (mediaType === "multipart/form-data") {
    return "multipart";
  }

  if (mediaType === "application/json" || mediaType?.endsWith("+json")) {
    return "json";
  }

  if (mediaType === "application/x-www-form-urlencoded") {
    return "urlencoded";
  }

  return undefined;
}

function normalizeBodyKind(bodyType: string | null): InspectableBodyKind {
  switch (bodyType) {
    case "json":
      return "json";
    case "urlencoded":
      return "urlencoded";
    case "multipart":
      return "multipart";
    case "text":
      return "text";
    default:
      return "text";
  }
}

function isMutableBodyKind(
  bodyKind: InspectableBodyKind,
): bodyKind is MutableBodyKind {
  return MUTABLE_BODY_KINDS.includes(bodyKind as MutableBodyKind);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toJsonParameterValue(
  value: string,
  customValueType: ParameterValueType | undefined,
): string | number {
  if (customValueType === "integer") {
    return Number.parseInt(value, 10);
  }

  return value;
}

function defineJsonParameter(
  target: Record<string, unknown>,
  name: string,
  value: string | number,
): void {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function findClosingBoundaryIndex(body: string, delimiter: string): number {
  let searchFrom = 0;

  while (searchFrom < body.length) {
    const index = body.indexOf(delimiter, searchFrom);
    if (index === -1) {
      return -1;
    }

    const startsLine = index === 0 || body[index - 1] === "\n";
    let suffixIndex = index + delimiter.length;
    while (body[suffixIndex] === " " || body[suffixIndex] === "\t") {
      suffixIndex += 1;
    }
    const endsLine =
      suffixIndex === body.length ||
      body[suffixIndex] === "\n" ||
      (body[suffixIndex] === "\r" && body[suffixIndex + 1] === "\n");

    if (startsLine && endsLine) {
      return index;
    }

    searchFrom = index + delimiter.length;
  }

  return -1;
}
