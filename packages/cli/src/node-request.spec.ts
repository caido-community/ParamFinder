import { afterEach, describe, expect, it, vi } from "vitest";

import type { CliOptions } from "./args";
import { createRunInputFromCli, NodeRequestProvider } from "./node-request";

function createOptions(overrides?: Partial<CliOptions>): CliOptions {
  return {
    url: "https://example.com/scan",
    method: undefined,
    headers: [],
    attackType: undefined,
    data: undefined,
    jsonBody: undefined,
    jsonPath: undefined,
    wordlistPath: undefined,
    words: [],
    useDefaultWords: true,
    delayMs: undefined,
    timeoutMs: undefined,
    maxParametersAmount: undefined,
    learnRequestsCount: 6,
    autoDetectMaxSize: true,
    maxQuerySize: undefined,
    maxBodySize: undefined,
    maxHeaderSize: undefined,
    updateContentLength: undefined,
    addCacheBusterParameter: true,
    wafDetection: true,
    additionalChecks: true,
    autopilotEnabled: true,
    customValue: undefined,
    customValueType: "string",
    ignoreAnomalyTypes: [],
    outputMode: "human",
    quiet: false,
    verbose: false,
    help: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createRunInputFromCli", () => {
  it("rejects unsupported URL protocols", () => {
    expect(() =>
      createRunInputFromCli(
        createOptions({
          url: "ftp://example.com/scan",
        }),
      ),
    ).toThrowError("Unsupported URL protocol: ftp:");
  });

  it("uses the default HTTP port for plain HTTP targets", () => {
    const { request } = createRunInputFromCli(
      createOptions({
        url: "http://example.com/scan",
      }),
    );

    expect(request.port).toBe(80);
    expect(request.method).toBe("GET");
    expect(request.tls).toBe(false);
  });

  it("builds body scans as POST JSON requests by default", () => {
    const { request, engineConfig } = createRunInputFromCli(
      createOptions({
        attackType: "body",
        jsonBody: "{}",
      }),
    );

    expect(request.port).toBe(443);
    expect(request.method).toBe("POST");
    expect(request.body).toBe("{}");
    expect(request.headers["Content-Type"]).toEqual(["application/json"]);
    expect(request.headers["Content-Length"]).toEqual(["2"]);
    expect(request.raw).toContain("POST /scan HTTP/1.1");
    expect(engineConfig.updateContentLength).toBe(true);
  });

  it("uses UTF-8 byte length for CLI request content length", () => {
    const { request } = createRunInputFromCli(
      createOptions({
        jsonBody: '{"currency":"€"}',
      }),
    );

    expect(request.body.length).toBe(16);
    expect(request.headers["Content-Length"]).toEqual(["18"]);
    expect(request.raw).toContain("Content-Length: 18");
  });

  it("rejects methods that cannot carry a request body", () => {
    expect(() =>
      createRunInputFromCli(
        createOptions({
          method: "HEAD",
          data: "alpha=1",
        }),
      ),
    ).toThrowError("HTTP method HEAD does not support a request body");
  });

  it("treats supplied headers case-insensitively and avoids duplicate defaults", () => {
    const { request } = createRunInputFromCli(
      createOptions({
        data: "payload",
        headers: [
          "host: api.example.com",
          "user-agent: custom-agent",
          "content-type: text/plain",
          "content-length: 7",
        ],
      }),
    );

    expect(Object.keys(request.headers)).toEqual([
      "host",
      "user-agent",
      "content-type",
      "content-length",
    ]);
    expect(request.headers.host).toEqual(["api.example.com"]);
    expect(request.headers["user-agent"]).toEqual(["custom-agent"]);
    expect(request.headers["content-type"]).toEqual(["text/plain"]);
    expect(request.headers["content-length"]).toEqual(["7"]);
    expect(request.raw).toContain("host: api.example.com");
    expect(request.raw).not.toContain("Host: example.com");
  });

  it("uses form encoding by default for --data payloads", () => {
    const { request } = createRunInputFromCli(
      createOptions({
        data: "alpha=1",
      }),
    );

    expect(request.headers["Content-Type"]).toEqual([
      "application/x-www-form-urlencoded",
    ]);
    expect(request.raw).toContain(
      "Content-Type: application/x-www-form-urlencoded",
    );
    expect(request.raw).toContain("\r\n\r\nalpha=1");
  });
});

describe("NodeRequestProvider", () => {
  it.each(["GET", "HEAD"])(
    "omits the request body for %s requests",
    async (method) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("", {
          status: 200,
          statusText: "OK",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const provider = new NodeRequestProvider();
      await provider.send({
        id: "request-1",
        host: "example.com",
        port: 443,
        url: "https://example.com/test",
        path: "/test",
        query: "",
        method,
        headers: {
          Host: ["example.com"],
        },
        body: "ignored",
        tls: true,
        raw: `${method} /test HTTP/1.1\r\nHost: example.com\r\n\r\nignored`,
        context: "discovery",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.com/test",
        expect.objectContaining({
          method,
          body: undefined,
          redirect: "manual",
        }),
      );
    },
  );

  it("maps fetch responses into engine responses with body byte length", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("created", {
        status: 201,
        statusText: "Created",
        headers: {
          "x-test": "one",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(42);

    const provider = new NodeRequestProvider();
    const result = await provider.send({
      id: "request-1",
      host: "example.com",
      port: 443,
      url: "https://example.com/test",
      path: "/test",
      query: "",
      method: "POST",
      headers: {
        Host: ["example.com"],
        "Content-Type": ["application/json"],
      },
      body: "{}",
      tls: true,
      raw: "POST /test HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{}",
      context: "discovery",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/test",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        redirect: "manual",
      }),
    );
    expect(result.response.status).toBe(201);
    expect(result.response.headers["x-test"]).toEqual(["one"]);
    expect(result.response.body).toBe("created");
    expect(result.response.time).toBe(32);
    expect(result.response.length).toBe(Buffer.byteLength("created"));
  });
});
