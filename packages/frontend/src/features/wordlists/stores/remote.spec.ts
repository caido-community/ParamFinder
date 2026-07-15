import { describe, expect, it } from "vitest";

import { fetchRemoteWordlist } from "./remote";

describe("remote wordlist downloads", () => {
  it("rejects a declared response larger than 10 MiB before reading it", async () => {
    const fetcher = async () =>
      new Response("ignored", {
        headers: { "content-length": String(10 * 1024 * 1024 + 1) },
      });

    const result = await fetchRemoteWordlist(
      "https://example.test/params.txt",
      fetcher,
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
  });

  it("enforces the limit while streaming when Content-Length is absent", async () => {
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    const fetcher = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          },
        }),
      );

    const result = await fetchRemoteWordlist(
      "https://example.test/params.txt",
      fetcher,
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: "VALIDATION" },
    });
  });
});
