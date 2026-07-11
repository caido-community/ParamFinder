import { describe, expect, it } from "vitest";

import { mutateRequest, validateMutationTarget } from "./mutate-request";
import type { EngineRequest } from "./types";

function createRequest(overrides?: Partial<EngineRequest>): EngineRequest {
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
    },
    body: "",
    tls: true,
    raw: "POST /test HTTP/1.1\r\nHost: example.com\r\n\r\n",
    context: "discovery",
    ...overrides,
  };
}

describe("mutateRequest", () => {
  it("appends query parameters without mutating the base request", () => {
    const baseRequest = createRequest({
      method: "GET",
      url: "https://example.com/search?existing=1",
      path: "/search",
      query: "existing=1",
      raw: "GET /search?existing=1 HTTP/1.1\r\nHost: example.com\r\n\r\n",
    });

    const mutated = mutateRequest({
      baseRequest,
      attackType: "query",
      parameters: [{ name: "secret", value: "123" }],
      context: "narrower",
      updateContentLength: false,
    });

    expect(baseRequest.query).toBe("existing=1");
    expect(mutated.query).toBe("existing=1&secret=123");
    expect(mutated.url).toBe(
      "https://example.com/search?existing=1&secret=123",
    );
    expect(mutated.raw).toContain("GET /search?existing=1&secret=123 HTTP/1.1");
    expect(mutated.context).toBe("narrower");
  });

  it("adds header mutations and an optional cache buster for header attacks", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        method: "GET",
        raw: "GET /test HTTP/1.1\r\nHost: example.com\r\n\r\n",
      }),
      attackType: "headers",
      parameters: [{ name: "X-Secret", value: "value" }],
      context: "discovery",
      updateContentLength: false,
      addCacheBusterParameter: true,
      cacheBusterValue: "cb123",
    });

    expect(readHeader(mutated, "X-Secret")).toEqual(["value"]);
    expect(mutated.query).toBe("cb123=cb123");
    expect(mutated.raw).toContain("X-Secret: value");
  });

  it("does not add a cache buster when the value is missing", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        method: "GET",
        raw: "GET /test HTTP/1.1\r\nHost: example.com\r\n\r\n",
      }),
      attackType: "headers",
      parameters: [{ name: "X-Secret", value: "value" }],
      context: "discovery",
      updateContentLength: false,
      addCacheBusterParameter: true,
    });

    expect(mutated.query).toBe("");
  });

  it("writes integer values into JSON bodies without quotes", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/json"],
          "Content-Length": ["2"],
        },
        body: "{}",
        raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
      }),
      attackType: "body",
      parameters: [{ name: "secret", value: "12345678" }],
      context: "discovery",
      updateContentLength: false,
      customValueType: "integer",
    });

    expect(JSON.parse(mutated.body)).toEqual({
      secret: 12345678,
    });
  });

  it("injects JSON parameters into a nested object path", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/json"],
          "Content-Length": ["22"],
        },
        body: '{"nested":{"target":{}}}',
        raw: 'POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 22\r\n\r\n{"nested":{"target":{}}}',
      }),
      attackType: "body",
      parameters: [{ name: "secret", value: "value" }],
      context: "discovery",
      updateContentLength: false,
      jsonBodyPath: "nested.target",
    });

    expect(JSON.parse(mutated.body)).toEqual({
      nested: {
        target: {
          secret: "value",
        },
      },
    });
  });

  it("accepts JSON body paths with a root selector prefix", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/json"],
          "Content-Length": ["22"],
        },
        body: '{"nested":{"target":{}}}',
        raw: 'POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 22\r\n\r\n{"nested":{"target":{}}}',
      }),
      attackType: "body",
      parameters: [{ name: "secret", value: "value" }],
      context: "discovery",
      updateContentLength: false,
      jsonBodyPath: "$.nested.target",
    });

    expect(JSON.parse(mutated.body)).toEqual({
      nested: {
        target: {
          secret: "value",
        },
      },
    });
  });

  it("injects JSON parameters into an object inside an array", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/json"],
          "Content-Length": ["25"],
        },
        body: '{"items":[{"target":{}}]}',
        raw: 'POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 25\r\n\r\n{"items":[{"target":{}}]}',
      }),
      attackType: "body",
      parameters: [{ name: "secret", value: "value" }],
      context: "discovery",
      updateContentLength: false,
      jsonBodyPath: "$.items[0].target",
    });

    expect(JSON.parse(mutated.body)).toEqual({
      items: [
        {
          target: {
            secret: "value",
          },
        },
      ],
    });
  });

  it("rejects JSON body paths that do not resolve to an object", () => {
    expect(() =>
      mutateRequest({
        baseRequest: createRequest({
          headers: {
            Host: ["example.com"],
            "Content-Type": ["application/json"],
          },
          body: '{"nested":{"target":"value"}}',
          raw: 'POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{"nested":{"target":"value"}}',
        }),
        attackType: "body",
        parameters: [{ name: "secret", value: "value" }],
        context: "discovery",
        updateContentLength: false,
        jsonBodyPath: "nested.target",
      }),
    ).toThrowError("JSON body path did not resolve to an object");
  });

  it("rejects invalid JSON bodies", () => {
    expect(() =>
      mutateRequest({
        baseRequest: createRequest({
          headers: {
            Host: ["example.com"],
            "Content-Type": ["application/json"],
          },
          body: "{",
          raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{",
        }),
        attackType: "body",
        parameters: [{ name: "secret", value: "value" }],
        context: "discovery",
        updateContentLength: false,
      }),
    ).toThrowError("Failed to parse JSON request body");
  });

  it("rejects JSON bodies whose root is not an object", () => {
    expect(() =>
      mutateRequest({
        baseRequest: createRequest({
          headers: {
            Host: ["example.com"],
            "Content-Type": ["application/json"],
          },
          body: "[]",
          raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n[]",
        }),
        attackType: "body",
        parameters: [{ name: "secret", value: "value" }],
        context: "discovery",
        updateContentLength: false,
      }),
    ).toThrowError("JSON request body must be an object at the root");
  });

  it("serializes __proto__ as an own JSON parameter", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/json"],
        },
        body: "{}",
        raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{}",
      }),
      attackType: "body",
      parameters: [{ name: "__proto__", value: "value" }],
      context: "discovery",
      updateContentLength: false,
    });

    expect(mutated.body).toBe('{"__proto__":"value"}');
  });

  it("preserves an existing JSON media type", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/merge-patch+json; charset=utf-8"],
        },
        body: "{}",
        raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/merge-patch+json; charset=utf-8\r\n\r\n{}",
      }),
      attackType: "body",
      parameters: [{ name: "secret", value: "value" }],
      context: "discovery",
      updateContentLength: false,
    });

    expect(readHeader(mutated, "Content-Type")).toEqual([
      "application/merge-patch+json; charset=utf-8",
    ]);
  });

  it("rejects text bodies that cannot be mutated", () => {
    expect(() =>
      mutateRequest({
        baseRequest: createRequest({
          headers: {
            Host: ["example.com"],
            "Content-Type": ["text/plain"],
          },
          body: "plain-text",
          raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: text/plain\r\n\r\nplain-text",
        }),
        attackType: "body",
        parameters: [{ name: "secret", value: "value" }],
        context: "discovery",
        updateContentLength: false,
      }),
    ).toThrowError("Unsupported body type for mutation: text");
  });

  it("validates a mutation target without sending or changing the request", () => {
    const baseRequest = createRequest();

    expect(() =>
      validateMutationTarget({
        baseRequest,
        attackType: "body",
      }),
    ).toThrowError("Unsupported body type for mutation: text");
    expect(baseRequest).toEqual(createRequest());
  });

  it("rejects multipart requests without a boundary", () => {
    expect(() =>
      mutateRequest({
        baseRequest: createRequest({
          headers: {
            Host: ["example.com"],
            "Content-Type": ["multipart/form-data"],
          },
          body: "--missing--",
          raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: multipart/form-data\r\n\r\n--missing--",
        }),
        attackType: "body",
        parameters: [{ name: "secret", value: "value" }],
        context: "discovery",
        updateContentLength: false,
      }),
    ).toThrowError("Missing multipart boundary");
  });

  it("rejects multipart requests without a closing boundary", () => {
    const boundary = "abc123";

    expect(() =>
      mutateRequest({
        baseRequest: createRequest({
          headers: {
            Host: ["example.com"],
            "Content-Type": [`multipart/form-data; boundary=${boundary}`],
          },
          body: `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n`,
          raw: `POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\n\r\n--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n`,
        }),
        attackType: "body",
        parameters: [{ name: "secret", value: "value" }],
        context: "discovery",
        updateContentLength: false,
      }),
    ).toThrowError("Invalid multipart body: missing final boundary");
  });

  it.each([
    'multipart/form-data; boundary="abc123"',
    "multipart/form-data; boundary=abc123; charset=utf-8",
  ])(
    "mutates multipart bodies with standard boundary syntax: %s",
    (contentType) => {
      const boundary = "abc123";
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n--${boundary}--\r\nepilogue`;
      const mutated = mutateRequest({
        baseRequest: createRequest({
          headers: { Host: ["example.com"], "Content-Type": [contentType] },
          body,
          raw: `POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: ${contentType}\r\n\r\n${body}`,
        }),
        attackType: "body",
        parameters: [{ name: "secret", value: "injected" }],
        context: "discovery",
        updateContentLength: false,
      });
      const normalizedBody = mutated.body.replace(/\r\n/g, "\n");

      expect(normalizedBody).toContain(
        'value\n--abc123\nContent-Disposition: form-data; name="secret"\n\ninjected\n--abc123--\nepilogue',
      );
      expect(normalizedBody).not.toContain("value\n\n--abc123\n");
    },
  );

  it("does not mistake boundary-like part content for the closing delimiter", () => {
    const boundary = "abc123";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nprefix--${boundary}--suffix\r\n--${boundary}--\r\n`;
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": [`multipart/form-data; boundary=${boundary}`],
        },
        body,
        raw: `POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\n\r\n${body}`,
      }),
      attackType: "body",
      parameters: [{ name: "secret", value: "injected" }],
      context: "discovery",
      updateContentLength: false,
    });

    expect(mutated.body).toContain(`prefix--${boundary}--suffix`);
    expect(mutated.body).toContain('name="secret"');
  });

  it("recalculates content length after mutating form bodies", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/x-www-form-urlencoded"],
          "Content-Length": ["7"],
        },
        body: "alpha=1",
        raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 7\r\n\r\nalpha=1",
      }),
      attackType: "body",
      parameters: [{ name: "secret", value: "value" }],
      context: "discovery",
      updateContentLength: true,
    });

    expect(readHeader(mutated, "Content-Length")).toEqual([
      String(mutated.body.length),
    ]);
    expect(mutated.body).toContain("secret=value");
  });

  it("recalculates content length using UTF-8 bytes", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        headers: {
          Host: ["example.com"],
          "Content-Type": ["application/json"],
          "Content-Length": ["2"],
        },
        body: "{}",
        raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
      }),
      attackType: "body",
      parameters: [{ name: "currency", value: "€" }],
      context: "discovery",
      updateContentLength: true,
    });

    expect(mutated.body).toBe('{"currency":"€"}');
    expect(mutated.body.length).toBe(16);
    expect(readHeader(mutated, "Content-Length")).toEqual(["18"]);
    expect(mutated.raw).toContain("Content-Length: 18");
  });

  it("removes content length when the final body is empty", () => {
    const mutated = mutateRequest({
      baseRequest: createRequest({
        method: "POST",
        headers: {
          Host: ["example.com"],
          "Content-Length": ["4"],
        },
        body: "",
        raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Length: 4\r\n\r\n",
      }),
      attackType: "query",
      parameters: [{ name: "secret", value: "value" }],
      context: "discovery",
      updateContentLength: true,
    });

    expect(readHeader(mutated, "Content-Length")).toBeUndefined();
  });
});

function readHeader(
  request: EngineRequest,
  name: string,
): string[] | undefined {
  const key = Object.keys(request.headers).find(
    (headerName) => headerName.toLowerCase() === name.toLowerCase(),
  );
  return key ? request.headers[key] : undefined;
}
