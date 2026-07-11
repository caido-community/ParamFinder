import { describe, expect, it } from "vitest";

import { createEngineRequest, createEngineRequestFromRaw } from "./request";

describe("createEngineRequest", () => {
  it("derives request fields from a URL and body", () => {
    const request = createEngineRequest({
      url: "https://example.com/api/items?draft=true",
      body: '{"name":"test"}',
      headers: {
        "User-Agent": "paramfinder-tests",
      },
    });

    expect(request.method).toBe("POST");
    expect(request.host).toBe("example.com");
    expect(request.port).toBe(443);
    expect(request.url).toBe("https://example.com/api/items?draft=true");
    expect(request.path).toBe("/api/items");
    expect(request.query).toBe("draft=true");
    expect(request.tls).toBe(true);
    expect(request.context).toBe("discovery");
    expect(request.headers.Host).toEqual(["example.com"]);
    expect(request.headers["Content-Type"]).toEqual(["application/json"]);
    expect(request.headers["Content-Length"]).toEqual([
      '{"name":"test"}'.length.toString(),
    ]);
  });

  it("uses UTF-8 byte length for generated content length", () => {
    const request = createEngineRequest({
      url: "https://example.com/api/items",
      body: '{"currency":"€"}',
    });

    expect(request.body.length).toBe(16);
    expect(request.headers["Content-Length"]).toEqual(["18"]);
    expect(request.raw).toContain("Content-Length: 18");
  });

  it("preserves multi-value headers and explicit metadata", () => {
    const request = createEngineRequest({
      id: "custom-id",
      context: "learning",
      method: "PATCH",
      url: "http://example.com:8080/update",
      headers: {
        "X-Test": ["one", "two"],
        Host: ["custom-host"],
      },
    });

    expect(request.id).toBe("custom-id");
    expect(request.context).toBe("learning");
    expect(request.method).toBe("PATCH");
    expect(request.port).toBe(8080);
    expect(request.url).toBe("http://example.com:8080/update");
    expect(request.headers["X-Test"]).toEqual(["one", "two"]);
    expect(request.headers.Host).toEqual(["custom-host"]);
  });

  it("keeps explicit default ports out of generated URLs", () => {
    expect(
      createEngineRequest({
        url: "http://example.com:80/search?q=test",
      }).url,
    ).toBe("http://example.com/search?q=test");
    expect(
      createEngineRequest({
        url: "https://example.com:443/search?q=test",
      }).url,
    ).toBe("https://example.com/search?q=test");
  });

  it("rejects unsupported URL protocols", () => {
    expect(() =>
      createEngineRequest({
        url: "ftp://example.com/archive",
      }),
    ).toThrowError("Unsupported URL protocol: ftp:");
  });
});

describe("createEngineRequestFromRaw", () => {
  it("derives structured fields while preserving the raw request", () => {
    const raw =
      "PATCH /items?draft=true HTTP/1.1\nHost: example.com\nX-Test: one\nX-Test: two\n\nbody=value";
    const request = createEngineRequestFromRaw({
      raw,
      host: "example.com",
      port: 443,
      tls: true,
      id: "raw-request",
      context: "learning",
    });

    expect(request).toMatchObject({
      id: "raw-request",
      context: "learning",
      method: "PATCH",
      path: "/items",
      query: "draft=true",
      url: "https://example.com/items?draft=true",
      headers: {
        host: ["example.com"],
        "x-test": ["one", "two"],
      },
      body: "body=value",
      raw,
    });
  });

  it("allows authoritative transport path and query overrides", () => {
    const request = createEngineRequestFromRaw({
      raw: "GET /raw?a=1 HTTP/1.1\r\nHost: example.com\r\n\r\n",
      host: "example.com",
      port: 80,
      tls: false,
      path: "/selected",
      query: "b=2",
    });

    expect(request.path).toBe("/selected");
    expect(request.query).toBe("b=2");
    expect(request.url).toBe("http://example.com/selected?b=2");
  });
});
