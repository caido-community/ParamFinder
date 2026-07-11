import { describe, expect, it, vi } from "vitest";

import { loadRequestResponse } from "./loadRequestResponse";

import type { FrontendSDK } from "@/types";

function createSDK(): FrontendSDK {
  return {
    graphql: {
      request: vi.fn(async () => ({
        request: {
          id: "request-1",
          host: "example.com",
          port: 443,
          path: "/search",
          query: "q=test",
          method: "POST",
          isTls: true,
          raw: "POST /search?q=test HTTP/1.1\r\nHost: example.com\r\nContent-Type: text/plain\r\n\r\nhello",
          response: { id: "response-1" },
        },
      })),
      response: vi.fn(async () => ({
        response: {
          id: "response-1",
          statusCode: 200,
          roundtripTime: 15,
          length: 5,
          raw: "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nworld",
        },
      })),
    },
  } as unknown as FrontendSDK;
}

describe("loadRequestResponse", () => {
  it("loads details through the frontend GraphQL API", async () => {
    const sdk = createSDK();

    await expect(loadRequestResponse(sdk, "request-1")).resolves.toEqual({
      success: true,
      value: {
        request: expect.objectContaining({
          id: "request-1",
          url: "https://example.com/search?q=test",
          body: "hello",
          raw: expect.stringContaining("POST /search?q=test"),
        }),
        response: expect.objectContaining({
          requestId: "request-1",
          status: 200,
          body: "world",
          raw: expect.stringContaining("HTTP/1.1 200 OK"),
        }),
      },
    });

    expect(sdk.graphql.request).toHaveBeenCalledWith({ id: "request-1" });
    expect(sdk.graphql.response).toHaveBeenCalledWith({ id: "response-1" });
  });

  it("keeps GraphQL request metadata authoritative over the raw request line", async () => {
    const sdk = createSDK();
    vi.mocked(sdk.graphql.request).mockResolvedValueOnce({
      request: {
        id: "stored-request-id",
        host: "canonical.example",
        port: 8443,
        path: "/canonical",
        query: "source=graphql",
        method: "PATCH",
        isTls: true,
        raw: "GET /raw?source=message HTTP/1.1\r\nX-Test: value\r\n\r\nraw-body",
        response: { id: "response-1" },
      },
    } as never);

    await expect(loadRequestResponse(sdk, "lookup-id")).resolves.toMatchObject({
      success: true,
      value: {
        request: {
          id: "stored-request-id",
          host: "canonical.example",
          port: 8443,
          url: "https://canonical.example:8443/canonical?source=graphql",
          path: "/canonical",
          query: "source=graphql",
          method: "PATCH",
          headers: { "x-test": ["value"] },
          body: "raw-body",
          tls: true,
        },
      },
    });
  });

  it("reports a request without a response", async () => {
    const sdk = createSDK();
    vi.mocked(sdk.graphql.request).mockResolvedValueOnce({
      request: {
        id: "request-1",
        host: "example.com",
        port: 443,
        path: "/",
        query: "",
        method: "GET",
        isTls: true,
        raw: "GET / HTTP/1.1\r\n\r\n",
      },
    } as never);

    await expect(loadRequestResponse(sdk, "request-1")).resolves.toMatchObject({
      success: false,
      error: { code: "NOT_FOUND", message: "Response not found." },
    });
  });
});
