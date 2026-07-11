import { describe, expect, it } from "vitest";

import {
  createRequestFromSelection,
  generateID,
  parseRequest,
  parseResponse,
  toCrlf,
} from "./request";

describe("request utils", () => {
  it("normalizes line endings to CRLF", () => {
    expect(toCrlf("GET / HTTP/1.1\nHost: example.com\r\n\rBody")).toBe(
      "GET / HTTP/1.1\r\nHost: example.com\r\n\r\nBody",
    );
  });

  it("parses request head, query, headers, and body", () => {
    expect(
      parseRequest(
        "POST /search?q=test HTTP/1.1\r\nHost: example.com\r\nX-Test: one\r\nX-Test: two\r\n\r\nbody=value",
      ),
    ).toEqual({
      path: "/search",
      query: "q=test",
      method: "POST",
      headers: {
        host: ["example.com"],
        "x-test": ["one", "two"],
      },
      body: "body=value",
    });
  });

  it("preserves question marks inside the query string", () => {
    expect(
      parseRequest("GET /search?q=what?still-query HTTP/1.1\r\n\r\n"),
    ).toMatchObject({
      path: "/search",
      query: "q=what?still-query",
    });
  });

  it("parses response headers and body", () => {
    expect(
      parseResponse(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\n\r\nhello",
      ),
    ).toEqual({
      headers: {
        "Content-Type": ["text/plain"],
        "Set-Cookie": ["a=1", "b=2"],
      },
      body: "hello",
    });
  });

  it("creates frontend request objects from selected raw requests", () => {
    expect(
      createRequestFromSelection({
        raw: "GET /from-raw?a=1 HTTP/1.1\nHost: example.com\n\n",
        isTls: true,
        host: "example.com",
        port: 443,
        path: "/override",
        query: "b=2",
      }),
    ).toMatchObject({
      host: "example.com",
      port: 443,
      url: "https://example.com/override?b=2",
      path: "/override",
      query: "b=2",
      method: "GET",
      tls: true,
      context: "discovery",
    });
  });

  it("generates non-empty ids", () => {
    expect(generateID()).toEqual(expect.any(String));
    expect(generateID().length).toBeGreaterThan(5);
  });
});
