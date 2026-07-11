import { array, assert, property, string } from "fast-check";
import { describe, expect, it } from "vitest";

import { createParameterValue, getNextChunk, splitChunk } from "./discovery";
import type { EngineRequest } from "./types";

function createRequest(overrides?: Partial<EngineRequest>): EngineRequest {
  const body = overrides?.body ?? "";
  const raw =
    overrides?.raw ??
    `POST /test${overrides?.query ? `?${overrides.query}` : ""} HTTP/1.1\r\nHost: example.com\r\nContent-Type: ${
      overrides?.headers?.["Content-Type"]?.[0] ??
      "application/x-www-form-urlencoded"
    }\r\nContent-Length: ${body.length}\r\n\r\n${body}`;

  return {
    id: "request-1",
    host: "example.com",
    port: 443,
    url: "https://example.com/test",
    path: "/test",
    query: "",
    method: "POST",
    headers: {
      Host: ["example.com"],
      "Content-Type": ["application/x-www-form-urlencoded"],
      ...overrides?.headers,
    },
    body,
    tls: true,
    raw,
    context: "discovery",
    ...overrides,
  };
}

describe("getNextChunk", () => {
  it("respects header count limits", () => {
    const result = getNextChunk({
      words: ["a", "b", "c"],
      startIndex: 0,
      request: createRequest(),
      attackType: "headers",
      maxSize: 2,
      random: () => 0,
    });

    expect(result.parameters).toHaveLength(2);
    expect(result.nextIndex).toBe(2);
  });

  it("guarantees progress for oversized query parameters", () => {
    const result = getNextChunk({
      words: ["averyveryverylongparametername"],
      startIndex: 0,
      request: createRequest({ query: "" }),
      attackType: "query",
      maxSize: 1,
      random: () => 0,
    });

    expect(result.parameters).toHaveLength(1);
    expect(result.nextIndex).toBe(1);
  });

  it("skips blank words without throwing", () => {
    const result = getNextChunk({
      words: ["  ", "secret"],
      startIndex: 0,
      request: createRequest({ query: "" }),
      attackType: "query",
      maxSize: 200,
      random: () => 0,
    });

    expect(result.parameters.map((parameter) => parameter.name)).toEqual([
      "secret",
    ]);
    expect(result.nextIndex).toBe(2);
  });

  it("uses exact body length for JSON chunking", () => {
    const request = createRequest({
      body: '{"root":{}}',
      headers: {
        Host: ["example.com"],
        "Content-Type": ["application/json"],
      },
      raw: 'POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{"root":{}}',
    });

    const result = getNextChunk({
      words: ["alpha", "beta", "gamma"],
      startIndex: 0,
      request,
      attackType: "body",
      maxSize: 30,
      jsonBodyPath: "root",
      random: () => 0,
    });

    expect(result.parameters).toHaveLength(1);
    expect(result.nextIndex).toBe(1);
  });

  it("uses UTF-8 byte length for body chunking", () => {
    const request = createRequest({
      body: '{"root":{}}',
      headers: {
        Host: ["example.com"],
        "Content-Type": ["application/json"],
      },
      raw: 'POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{"root":{}}',
    });

    const result = getNextChunk({
      words: ["alpha", "beta"],
      startIndex: 0,
      request,
      attackType: "body",
      maxSize: 25,
      customValue: "€",
      jsonBodyPath: "root",
      random: () => 0,
    });

    expect(result.parameters).toHaveLength(1);
    expect(result.nextIndex).toBe(1);
  });

  it("uses integer JSON body length when requested", () => {
    const request = createRequest({
      body: '{"root":{}}',
      headers: {
        Host: ["example.com"],
        "Content-Type": ["application/json"],
      },
      raw: 'POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{"root":{}}',
    });

    const result = getNextChunk({
      words: ["alpha", "beta", "gamma"],
      startIndex: 0,
      request,
      attackType: "body",
      maxSize: 50,
      customValueType: "integer",
      jsonBodyPath: "root",
      random: () => 0,
    });

    expect(result.parameters).toHaveLength(2);
    expect(result.nextIndex).toBe(2);
  });

  it("never exceeds maxParametersAmount", () => {
    assert(
      property(
        array(string({ minLength: 1 }), { minLength: 1, maxLength: 20 }),
        (words) => {
          const result = getNextChunk({
            words,
            startIndex: 0,
            request: createRequest(),
            attackType: "headers",
            maxParametersAmount: 3,
            random: () => 0,
          });

          expect(result.parameters.length).toBeLessThanOrEqual(3);
        },
      ),
    );
  });

  it("always advances when there are remaining words", () => {
    assert(
      property(
        array(string({ minLength: 1 }), { minLength: 1, maxLength: 20 }),
        (words) => {
          const result = getNextChunk({
            words,
            startIndex: 0,
            request: createRequest(),
            attackType: "query",
            maxSize: 1,
            random: () => 0,
          });

          expect(result.nextIndex).toBeGreaterThan(0);
        },
      ),
    );
  });
});

describe("splitChunk", () => {
  it("preserves every parameter exactly once", () => {
    assert(
      property(
        array(string({ minLength: 1 }), { minLength: 2, maxLength: 20 }),
        (words) => {
          const parameters = words.map((word) => ({
            name: word,
            value: `${word}-value`,
          }));
          const [left, right] = splitChunk(parameters);

          expect(left.length + right.length).toBe(parameters.length);
          expect([...left, ...right]).toEqual(parameters);
        },
      ),
    );
  });
});

describe("createParameterValue", () => {
  it("generates integer values without leading zeroes", () => {
    expect(createParameterValue(undefined, "integer", () => 0)).toBe(
      "10000000",
    );
  });
});
