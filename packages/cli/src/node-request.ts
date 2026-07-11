import {
  type AttackType,
  canSendRequestBody,
  createEngineConfig,
  createEngineRequest,
  createEngineRequestHeaders,
  createHeaderMap,
  type EngineConfig,
  type EngineRequest,
  type EngineRequestResponse,
  type RequestProvider,
} from "@paramfinder/engine";

import type { CliOptions } from "./args";

export class NodeRequestProvider implements RequestProvider {
  public async send(
    request: EngineRequest,
    options?: { signal?: AbortSignal },
  ): Promise<EngineRequestResponse> {
    const headers = new Headers();
    for (const [name, values] of Object.entries(request.headers)) {
      for (const value of values) {
        headers.append(name, value);
      }
    }

    const start = performance.now();
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body: canSendRequestBody(request.method) ? request.body : undefined,
      redirect: "manual",
      signal: options?.signal,
    });
    const body = await response.text();
    const responseHeaders = createHeaderMap(response.headers);
    const elapsedMs = Math.round(performance.now() - start);

    return {
      request,
      response: {
        requestId: request.id,
        status: response.status,
        headers: responseHeaders,
        body,
        time: elapsedMs,
        length: Buffer.byteLength(body),
      },
    };
  }
}

export function createRunInputFromCli(options: CliOptions): {
  request: EngineRequest;
  engineConfig: EngineConfig;
} {
  const attackType = resolveAttackType(options);
  const { method, body } = resolveMethodAndBody(options, attackType);
  const request = createEngineRequest({
    url: options.url,
    method,
    headers: createEngineRequestHeaders({
      headers: options.headers,
      defaults: {
        "User-Agent": "paramfinder-cli/0.1.0",
      },
      body,
      contentType: resolveCliContentType(options, body),
    }),
    body,
  });

  const engineConfig = createEngineConfig({
    attackType,
    learnRequestsCount: options.learnRequestsCount,
    autoDetectMaxSize: options.autoDetectMaxSize,
    maxQuerySize: options.maxQuerySize,
    maxBodySize: options.maxBodySize,
    maxHeaderSize: options.maxHeaderSize,
    updateContentLength: options.updateContentLength,
    autopilotEnabled: attackType === "query" ? options.autopilotEnabled : false,
    addCacheBusterParameter: options.addCacheBusterParameter,
    wafDetection: options.wafDetection,
    additionalChecks: options.additionalChecks,
    ignoreAnomalyTypes: options.ignoreAnomalyTypes,
    customValue: options.customValue,
    customValueType: options.customValueType,
    jsonBodyPath: options.jsonPath,
    maxParametersAmount: options.maxParametersAmount,
  });

  return {
    request,
    engineConfig,
  };
}

function resolveAttackType(options: CliOptions): AttackType {
  if (options.attackType) {
    return options.attackType;
  }

  if (options.data || options.jsonBody || options.jsonPath) {
    return "body";
  }

  return "query";
}

function resolveMethodAndBody(
  options: CliOptions,
  attackType: AttackType,
): { method: string; body: string } {
  let body = options.jsonBody ?? options.data ?? "";

  if (!body && attackType === "body") {
    body = "{}";
  }

  const method = (options.method ?? (body ? "POST" : "GET")).toUpperCase();
  if (!canSendRequestBody(method) && body) {
    throw new Error(`HTTP method ${method} does not support a request body`);
  }

  return {
    method,
    body,
  };
}

function resolveCliContentType(
  options: CliOptions,
  body: string,
): string | undefined {
  if (!body) {
    return undefined;
  }

  return options.jsonBody || (!options.data && body === "{}")
    ? "application/json"
    : "application/x-www-form-urlencoded";
}
