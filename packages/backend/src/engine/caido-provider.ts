import type {
  EngineRequest,
  EngineRequestResponse,
  HeaderMap,
  RequestProvider,
  RequestProviderSendOptions,
} from "@paramfinder/engine";
import type { SDK } from "caido:plugin";
import { RequestSpec } from "caido:utils";

/** The engine owns cancellation; Caido's global timeout stops the transport. */
export class CaidoRequestProvider implements RequestProvider {
  public constructor(private readonly sdk: SDK) {}

  public async send(
    request: EngineRequest,
    options?: RequestProviderSendOptions,
  ): Promise<EngineRequestResponse> {
    const sent = await this.sdk.requests.send(
      toRequestSpec(request),
      createSendOptions(options?.timeoutMs),
    );

    if (!sent.response) {
      throw new Error("Caido did not return a response for the request");
    }

    const requestId = sent.request.getId();
    const body = sent.response.getBody();

    return {
      request: {
        ...request,
        id: requestId,
      },
      response: {
        requestId,
        status: sent.response.getCode(),
        headers: normalizeHeaders(sent.response.getHeaders()),
        body: body?.toText(),
        length: body?.length ?? 0,
        time: sent.response.getRoundtripTime(),
      },
    };
  }
}

function createSendOptions(timeoutMs: number | undefined) {
  if (timeoutMs === undefined) {
    return undefined;
  }

  const timeouts = { global: timeoutMs };

  return {
    // Caido 0.57 reads `timeout`; its published SDK types expose `timeouts`.
    // Supplying both keeps the transport deadline working across that rename.
    timeout: timeouts,
    timeouts,
  };
}

function toRequestSpec(request: EngineRequest): RequestSpec {
  const spec = new RequestSpec(request.url);
  spec.setTls(request.tls);
  spec.setHost(request.host);
  spec.setPort(request.port);
  spec.setMethod(request.method);
  spec.setPath(request.path);

  if (request.query) {
    spec.setQuery(request.query);
  }

  for (const [name, values] of Object.entries(request.headers)) {
    if (values.length === 0) {
      continue;
    }

    const separator = name.toLowerCase() === "cookie" ? "; " : ", ";
    spec.setHeader(name, values.join(separator));
  }

  if (request.body) {
    // The engine has already applied the configured Content-Length policy.
    spec.setBody(request.body, { updateContentLength: false });
  }

  return spec;
}

function normalizeHeaders(headers: HeaderMap): HeaderMap {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value : [value],
    ]),
  );
}
