import { type ApiResult, error, ok, type RequestResponse } from "shared";

import { parseRequest, parseResponse } from "@/shared/utils/request";
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

    const parsedRequest = parseRequest(request.raw);
    const parsedResponse = parseResponse(response.raw);
    const protocol = request.isTls ? "https" : "http";
    return ok({
      request: {
        id: request.id,
        host: request.host,
        port: request.port,
        url: `${protocol}://${request.host}:${request.port}${request.path}${request.query ? `?${request.query}` : ""}`,
        path: request.path,
        query: request.query,
        method: request.method,
        headers: parsedRequest.headers,
        body: parsedRequest.body,
        tls: request.isTls,
        raw: request.raw,
        context: "discovery",
      },
      response: {
        requestId: request.id,
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
