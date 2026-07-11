import type { Request as CaidoRequest } from "caido:utils";
import { type ApiResult, error, ok, type Request } from "shared";

import { type BackendSDK } from "../types/types";
import { generateID } from "../util/helper";

export async function getRequest(
  sdk: BackendSDK,
  id: string,
): Promise<ApiResult<Request>> {
  try {
    const requestResponse = await sdk.requests.get(id);
    if (!requestResponse) {
      return error("Request not found", "NOT_FOUND");
    }

    return ok(toRequest(requestResponse.request, generateID()));
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

function toRequest(request: CaidoRequest, id: string): Request {
  const spec = request.toSpec();
  const query = spec.getQuery();
  const url = `${spec.getTls() ? "https" : "http"}://${spec.getHost()}:${spec.getPort()}${spec.getPath()}${query !== "" ? `?${query}` : ""}`;

  return {
    id,
    host: spec.getHost(),
    port: spec.getPort(),
    url,
    path: spec.getPath(),
    query,
    method: spec.getMethod(),
    headers: normalizeHeaders(spec.getHeaders()),
    body: spec.getBody()?.toText() ?? "",
    tls: spec.getTls(),
    context: "discovery",
    raw: request.getRaw().toText(),
  };
}

function normalizeHeaders(
  headers: Record<string, string | string[]>,
): Request["headers"] {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value : [value],
    ]),
  );
}
