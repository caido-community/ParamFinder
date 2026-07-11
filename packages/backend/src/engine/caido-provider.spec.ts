import type { EngineRequest } from "@paramfinder/engine";
import type { SDK } from "caido:plugin";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaidoRequestProvider } from "./caido-provider";

const { requestSpecs, MockRequestSpec } = vi.hoisted(() => {
  class HoistedRequestSpec {
    readonly bodyCalls: Array<{
      body: string;
      options: { updateContentLength: boolean } | undefined;
    }> = [];

    constructor(readonly url: string) {
      requestSpecs.push(this);
    }

    setTls() {}
    setHost() {}
    setPort() {}
    setMethod() {}
    setPath() {}
    setQuery() {}
    setHeader() {}
    setBody(body: string, options?: { updateContentLength: boolean }) {
      this.bodyCalls.push({ body, options });
    }
  }

  const requestSpecs: HoistedRequestSpec[] = [];
  return { requestSpecs, MockRequestSpec: HoistedRequestSpec };
});

vi.mock("caido:utils", () => ({ RequestSpec: MockRequestSpec }));

function createRequest(): EngineRequest {
  return {
    id: "source",
    host: "example.com",
    port: 443,
    url: "https://example.com/test",
    path: "/test",
    query: "a=1",
    method: "POST",
    headers: {
      Host: ["example.com"],
      "Content-Type": ["application/json"],
      "Content-Length": ["999"],
    },
    body: '{"ok":true}',
    tls: true,
    raw: "POST /test HTTP/1.1\r\nHost: example.com\r\n\r\n{}",
    context: "discovery",
  };
}

function createPayload() {
  const createdAt = new Date();
  return {
    request: {
      getCreatedAt: () => createdAt,
      getId: () => "saved-request",
    },
    response: {
      getBody: () => ({ toText: () => "response", length: 8 }),
      getCode: () => 200,
      getCreatedAt: () => createdAt,
      getHeaders: () => ({ Server: ["test"] }),
      getRoundtripTime: () => 12,
    },
  };
}

function createSdk(send: ReturnType<typeof vi.fn>): SDK {
  return {
    requests: { send },
    console: { log: vi.fn(), error: vi.fn() },
  } as unknown as SDK;
}

beforeEach(() => {
  requestSpecs.length = 0;
});

describe("CaidoRequestProvider", () => {
  it("supports Caido's runtime and typed timeout option names", async () => {
    const send = vi.fn(async () => createPayload());
    const provider = new CaidoRequestProvider(createSdk(send));

    await expect(
      provider.send(createRequest(), { timeoutMs: 25 }),
    ).resolves.toMatchObject({
      request: { id: "saved-request" },
      response: { status: 200, length: 8, time: 12 },
    });

    expect(send).toHaveBeenCalledWith(expect.any(MockRequestSpec), {
      timeout: { global: 25 },
      timeouts: { global: 25 },
    });
    expect(requestSpecs[0]?.bodyCalls).toEqual([
      {
        body: '{"ok":true}',
        options: { updateContentLength: false },
      },
    ]);
  });

  it("leaves the global timeout unset when the engine supplies none", async () => {
    const send = vi.fn(async () => createPayload());
    const provider = new CaidoRequestProvider(createSdk(send));

    await provider.send(createRequest());

    expect(send).toHaveBeenCalledWith(expect.any(MockRequestSpec), undefined);
  });

  it("throws when Caido returns no response", async () => {
    const send = vi.fn(async () => ({
      request: { getCreatedAt: () => new Date(), getId: () => "id" },
    }));
    const provider = new CaidoRequestProvider(createSdk(send));

    await expect(provider.send(createRequest())).rejects.toThrow(
      "Caido did not return a response",
    );
  });
});
