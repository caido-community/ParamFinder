import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const CLI_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/bin.js",
);
const servers = new Set<Server>();

afterEach(async () => {
  await Promise.all(Array.from(servers).map((server) => closeServer(server)));
  servers.clear();
});

describe("paramfinder CLI", () => {
  it("prints generated help output", async () => {
    const result = await runCli(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: paramfinder");
    expect(result.stdout).toContain("--custom-value-type");
    expect(result.stdout).toContain("--json-stream");
    expect(result.stdout).toContain("Arguments:");
  });

  it("prints human-readable live findings", async () => {
    const baseUrl = await startServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      respondText(
        response,
        url.searchParams.has("secret")
          ? "interesting response"
          : "baseline response",
      );
    });

    const result = await runCli([
      `${baseUrl}/scan`,
      "--no-default-words",
      "--word",
      "secret",
      "--no-additional-checks",
      "--no-waf-detection",
      "--no-auto-detect-max-size",
      "--max-query-size",
      "200",
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("Potential parameter");
    expect(result.stderr).toContain("secret");
    expect(result.stderr).toContain("Verifying candidate parameter");
    expect(result.stderr).toContain("Confirmed parameter");
    expect(result.stderr).toContain("Scan complete");
  });

  it("supports final JSON output", async () => {
    const baseUrl = await startServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      respondText(
        response,
        url.searchParams.has("secret")
          ? "interesting response"
          : "baseline response",
      );
    });

    const result = await runCli([
      `${baseUrl}/scan`,
      "--no-default-words",
      "--word",
      "secret",
      "--no-additional-checks",
      "--no-waf-detection",
      "--no-auto-detect-max-size",
      "--max-query-size",
      "200",
      "--json",
    ]);

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.attackType).toBe("query");
    expect(payload.summary.findings[0].parameter).toBe("secret");
  });

  it("streams NDJSON scan events", async () => {
    const baseUrl = await startServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      respondText(
        response,
        url.searchParams.has("secret")
          ? "interesting response"
          : "baseline response",
      );
    });

    const result = await runCli([
      `${baseUrl}/scan`,
      "--no-default-words",
      "--word",
      "secret",
      "--no-additional-checks",
      "--no-waf-detection",
      "--no-auto-detect-max-size",
      "--max-query-size",
      "200",
      "--json-stream",
    ]);

    expect(result.code).toBe(0);
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      lines.some(
        (entry) =>
          entry.type === "finding" && entry.finding.parameter === "secret",
      ),
    ).toBe(true);
    expect(lines.at(-1)?.type).toBe("result");
  });

  it("returns a clear error for invalid URLs", async () => {
    const result = await runCli(["not-a-url"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid URL");
  });

  it("reports rate limiting and auto-resumes after 429 responses", async () => {
    let discoveryAttempts = 0;
    const baseUrl = await startServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.searchParams.has("secret")) {
        discoveryAttempts += 1;
        if (discoveryAttempts === 1) {
          response.statusCode = 429;
          response.end("too many requests");
          return;
        }
      }

      respondText(
        response,
        url.searchParams.has("secret")
          ? "interesting response"
          : "baseline response",
      );
    });

    const result = await runCli([
      `${baseUrl}/scan`,
      "--no-default-words",
      "--word",
      "secret",
      "--no-additional-checks",
      "--no-waf-detection",
      "--no-auto-detect-max-size",
      "--max-query-size",
      "200",
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Rate limited, pausing discovery");
    expect(result.stderr).toContain("Scan complete");
  });

  it("reports provider failures as a failed scan instead of crashing", async () => {
    const baseUrl = await startServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.searchParams.has("secret")) {
        request.socket.destroy();
        return;
      }

      respondText(response, "baseline response");
    });

    const result = await runCli([
      `${baseUrl}/scan`,
      "--no-default-words",
      "--word",
      "secret",
      "--no-additional-checks",
      "--no-waf-detection",
      "--no-auto-detect-max-size",
      "--max-query-size",
      "200",
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Scan failed");
    expect(result.stderr).toContain("Reason");
    expect(result.stderr).not.toContain("Error: Request provider failed");
  });

  it("sends integer JSON values for body scans when requested", async () => {
    const baseUrl = await startServer(async (request, response) => {
      const body = await readRequestBody(request);
      const parsedBody = body
        ? (JSON.parse(body) as Record<string, unknown>)
        : {};
      const secretValue = parsedBody.secret;
      const hasIntegerSecret =
        typeof secretValue === "number" && Number.isInteger(secretValue);

      respondText(
        response,
        hasIntegerSecret ? "interesting response" : "baseline response",
      );
    });

    const result = await runCli([
      `${baseUrl}/scan`,
      "--attack",
      "body",
      "--json-body",
      "{}",
      "--custom-value-type",
      "integer",
      "--no-default-words",
      "--word",
      "secret",
      "--no-additional-checks",
      "--no-waf-detection",
      "--no-auto-detect-max-size",
      "--max-body-size",
      "200",
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("Potential parameter");
    expect(result.stderr).toContain("secret");
    expect(result.stderr).toContain("Verifying candidate parameter");
    expect(result.stderr).toContain("Confirmed parameter");
  });
});

async function startServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>,
): Promise<string> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  servers.add(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString();
}

async function runCli(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...process.env,
        PARAMFINDER_TEST_SKIP_SLEEP: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

function respondText(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain");
  response.end(body);
}
