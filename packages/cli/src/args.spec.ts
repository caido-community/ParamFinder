import { describe, expect, it } from "vitest";

import { getCliHelpText, parseCliArgs } from "./args";

describe("parseCliArgs", () => {
  it("matches the original default learning and cache-buster behavior", () => {
    const options = parseCliArgs(["https://example.com"]);

    expect(options.learnRequestsCount).toBe(6);
    expect(options.addCacheBusterParameter).toBe(true);
  });

  it("parses repeatable options and explicit boolean flags", () => {
    const options = parseCliArgs([
      "https://example.com",
      "-H",
      "Authorization: Bearer token",
      "--header",
      "X-Test: one",
      "--word",
      "alpha",
      "--word",
      "beta",
      "--no-default-words",
      "--no-waf-detection",
      "--no-additional-checks",
      "--no-autopilot",
      "--cache-buster",
      "--attack",
      "headers",
      "--delay",
      "25",
      "--update-content-length",
    ]);

    expect(options).toMatchObject({
      url: "https://example.com",
      headers: ["Authorization: Bearer token", "X-Test: one"],
      words: ["alpha", "beta"],
      useDefaultWords: false,
      wafDetection: false,
      additionalChecks: false,
      autopilotEnabled: false,
      addCacheBusterParameter: true,
      attackType: "headers",
      delayMs: 25,
      updateContentLength: true,
    });
  });

  it("keeps help mode available without a target url", () => {
    const options = parseCliArgs(["--help"]);

    expect(options.help).toBe(true);
    expect(options.url).toBe("");
    expect(getCliHelpText()).toContain("Usage: paramfinder");
    expect(getCliHelpText()).toContain("--json-stream");
  });

  it("rejects conflicting output modes", () => {
    expect(() =>
      parseCliArgs(["https://example.com", "--json", "--json-stream"]),
    ).toThrowError("Use either --json or --json-stream, not both");
  });

  it("rejects combining --data with --json-body", () => {
    expect(() =>
      parseCliArgs([
        "https://example.com",
        "--data",
        "a=1",
        "--json-body",
        '{"a":1}',
      ]),
    ).toThrowError("Use either --data or --json-body, not both");
  });

  it("supports disabling content-length updates explicitly", () => {
    const options = parseCliArgs([
      "https://example.com",
      "--no-update-content-length",
    ]);

    expect(options.updateContentLength).toBe(false);
  });

  it("supports disabling cache-buster parameters explicitly", () => {
    const options = parseCliArgs(["https://example.com", "--no-cache-buster"]);

    expect(options.addCacheBusterParameter).toBe(false);
  });

  it("rejects combining a custom value prefix with integer generation", () => {
    expect(() =>
      parseCliArgs([
        "https://example.com",
        "--custom-value",
        "prefix",
        "--custom-value-type",
        "integer",
      ]),
    ).toThrowError(
      "Use either --custom-value or --custom-value-type integer, not both",
    );
  });
});
