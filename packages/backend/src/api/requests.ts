import {
  createEngineRequestFromRaw,
  createHeaderMap,
} from "@paramfinder/engine";
import type { Request as CaidoRequest } from "caido:utils";
import { type ApiResult, error, ok, type Request } from "shared";

import { type BackendSDK } from "../types/types";
import { getErrorMessage } from "../util/errors";

export async function getRequest(
  sdk: BackendSDK,
  id: string,
): Promise<ApiResult<Request>> {
  try {
    const requestResponse = await sdk.requests.get(id);
    if (!requestResponse) {
      return error("Request not found", "NOT_FOUND");
    }

    return ok(toRequest(requestResponse.request));
  } catch (err) {
    return error(getErrorMessage(err));
  }
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
