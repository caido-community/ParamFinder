import { createEngineRequestFromRaw } from "@paramfinder/engine";
import { type ApiResult, error, ok, type RequestResponse } from "shared";

import { parseResponse } from "@/shared/utils/request";
import type { FrontendSDK } from "@/types";

export async function loadRequestResponse(
  sdk: FrontendSDK,
  requestId: string,
): Promise<ApiResult<RequestResponse>> {
  try {
    const requestResult = await sdk.graphql.request({ id: requestId });
    const request = requestResult.request;
    if (request === undefined || request === null) {
      return error("Request not found.", "NOT_FOUND");
    }

    const responseId = request.response?.id;
    if (responseId === undefined) {
      return error("Response not found.", "NOT_FOUND");
    }

    const responseResult = await sdk.graphql.response({ id: responseId });
    const response = responseResult.response;
    if (response === undefined || response === null) {
      return error("Response not found.", "NOT_FOUND");
    }

    const parsedResponse = parseResponse(response.raw);
    return ok({
      request: createEngineRequestFromRaw({
        raw: request.raw,
        id: request.id,
        host: request.host,
        port: request.port,
        tls: request.isTls,
        path: request.path,
        query: request.query,
        method: request.method,
        context: "discovery",
      }),
      response: {
        status: response.statusCode,
        headers: parsedResponse.headers,
        body: parsedResponse.body,
        time: response.roundtripTime,
        length: response.length,
        raw: response.raw,
      },
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause), "IO");
  }
}
