import { describe, expect, it, vi } from "vitest";

import type { BackendSDK } from "../types/types";

import { getRequest } from "./requests";

describe("getRequest", () => {
  it("uses Caido's structured request fields while parsing raw headers", async () => {
    const spec = {
      getTls: () => true,
      getHost: () => "canonical.example",
      getPort: () => 8443,
      getPath: () => "/canonical",
      getQuery: () => "source=caido",
      getMethod: () => "PATCH",
      getHeaders: () => ({ "X-Caido": "structured" }),
      getBody: () => ({ toText: () => "structured-body" }),
    };
    const sdk = {
      requests: {
        get: vi.fn(async () => ({
          request: {
            toSpec: () => spec,
            getRaw: () => ({
              toText: () =>
                "GET /raw?source=message HTTP/1.1\r\nX-Raw: ignored\r\n\r\nraw-body",
            }),
          },
        })),
      },
    } as unknown as BackendSDK;

    const result = await getRequest(sdk, "caido-request-id");

    expect(result).toMatchObject({
      success: true,
      value: {
        host: "canonical.example",
        port: 8443,
        url: "https://canonical.example:8443/canonical?source=caido",
        path: "/canonical",
        query: "source=caido",
        method: "PATCH",
        headers: { "X-Caido": ["structured"] },
        body: "structured-body",
        tls: true,
        raw: expect.stringContaining("GET /raw?source=message"),
        context: "discovery",
      },
    });
    if (result.success) expect(result.value.id).toEqual(expect.any(String));
    expect(sdk.requests.get).toHaveBeenCalledWith("caido-request-id");
  });
});
