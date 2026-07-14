import {
  createEngineRequestFromRaw,
  createHeaderMap,
} from "@paramfinder/engine";
import type { Request as CaidoRequest } from "caido:utils";
import {
  type ApiResult,
  error,
  ok,
  type Request,
  requestIdSchema,
} from "shared";

import { type BackendSDK } from "../types/types";

export async function getRequest(
  sdk: BackendSDK,
  id: string,
): Promise<ApiResult<Request>> {
  const input = requestIdSchema.safeParse(id);
  if (!input.success) return error("Invalid request ID.", "VALIDATION");

  const requestResponse = await sdk.requests.get(input.data);
  if (!requestResponse) {
    return error("Request not found", "NOT_FOUND");
  }

  return ok(toRequest(requestResponse.request));
}

function toRequest(request: CaidoRequest): Request {
  const spec = request.toSpec();
  return createEngineRequestFromRaw({
    raw: request.getRaw().toText(),
    host: spec.getHost(),
    port: spec.getPort(),
    tls: spec.getTls(),
    path: spec.getPath(),
    query: spec.getQuery(),
    method: spec.getMethod(),
    headers: createHeaderMap(spec.getHeaders()),
    body: spec.getBody()?.toText() ?? "",
    context: "discovery",
  });
}
