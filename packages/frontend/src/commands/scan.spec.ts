import type { CommandContext } from "@caido/sdk-frontend";
import { createEngineRequestFromRaw } from "@paramfinder/engine";
import {
  error,
  ok,
  type Request,
  type SessionDescriptor,
  type Settings,
} from "shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAdvancedScan, runScan } from "./scan";

import type { FrontendSDK } from "@/types";

const mocks = vi.hoisted(() => ({
  resolveRequests: vi.fn(),
  startSession: vi.fn(),
  openDialog: vi.fn(),
}));

vi.mock("./requestSource", () => ({
  resolveContextRequests: mocks.resolveRequests,
}));
vi.mock("@/features/sessions/stores/sessions.store", () => ({
  useSessionsStore: () => ({ startSession: mocks.startSession }),
}));
vi.mock("@/features/scan/stores/scanDialog", () => ({
  useScanDialogStore: () => ({ open: mocks.openDialog }),
}));

const settings: Settings = {
  delay: 0,
  requestTimeoutSeconds: 30,
  autoDetectMaxSize: true,
  learnRequestsCount: 3,
  wafDetection: true,
  ignoreCloudflareBlocks: false,
  additionalChecks: true,
  debug: false,
  autopilotEnabled: true,
  updateContentLength: true,
  ignoreAnomalyTypes: [],
  addCacheBusterParameter: true,
};

const context = {} as CommandContext;

function createSDK() {
  const showToast = vi.fn();
  const sdk = {
    backend: { getSettings: vi.fn(async () => ok(settings)) },
    window: { showToast },
  } as unknown as FrontendSDK;
  return { sdk, showToast };
}

function request(id: string, raw: string): Request {
  return createEngineRequestFromRaw({
    id,
    raw,
    host: "example.com",
    port: 443,
    tls: true,
    context: "discovery",
  });
}

function descriptor(): SessionDescriptor {
  return {} as SessionDescriptor;
}

describe("scan commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevalidates a batch, attempts each valid request, and summarizes failures", async () => {
    const first = request(
      "first",
      "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{}",
    );
    const unsupported = request(
      "unsupported",
      "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Type: text/plain\r\n\r\nhello",
    );
    const last = request(
      "last",
      "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\na=1",
    );
    mocks.resolveRequests.mockResolvedValue([first, unsupported, last]);
    mocks.startSession
      .mockResolvedValueOnce(ok(descriptor()))
      .mockResolvedValueOnce(error("No enabled wordlists", "VALIDATION"));
    const { sdk, showToast } = createSDK();

    await runScan(sdk, context, "body");

    expect(mocks.startSession.mock.calls.map(([target]) => target.id)).toEqual([
      "first",
      "last",
    ]);
    expect(showToast).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(
        /Started 1 of 3.*Unsupported body type.*No enabled wordlists/,
      ),
      { variant: "warning", duration: 10_000 },
    );
  });

  it("continues after a rejected start and reports the partial result", async () => {
    const first = request(
      "first",
      "GET /one HTTP/1.1\r\nHost: example.com\r\n\r\n",
    );
    const second = request(
      "second",
      "GET /two HTTP/1.1\r\nHost: example.com\r\n\r\n",
    );
    mocks.resolveRequests.mockResolvedValue([first, second]);
    mocks.startSession
      .mockRejectedValueOnce(new Error("Transport failed"))
      .mockResolvedValueOnce(ok(descriptor()));
    const { sdk, showToast } = createSDK();

    await runScan(sdk, context, "query");

    expect(mocks.startSession).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/Started 1 of 2.*Transport failed/),
      { variant: "warning", duration: 10_000 },
    );
  });

  it("applies an advanced JSON path only to compatible requests", async () => {
    const compatible = request(
      "compatible",
      'POST /one HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{"target":{}}',
    );
    const incompatible = request(
      "incompatible",
      'POST /two HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\n\r\n{"other":{}}',
    );
    mocks.resolveRequests.mockResolvedValue([compatible, incompatible]);
    mocks.openDialog.mockResolvedValue({
      attackType: "body",
      jsonBodyPath: "$.target",
    });
    mocks.startSession.mockResolvedValue(ok(descriptor()));
    const { sdk, showToast } = createSDK();

    await runAdvancedScan(sdk, context);

    expect(mocks.openDialog).toHaveBeenCalledWith({
      jsonBody: '{"target":{}}',
    });
    expect(mocks.startSession.mock.calls[0]?.[0].id).toBe("compatible");
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(
        /Started 1 of 2.*JSON body path did not resolve to an object/,
      ),
      { variant: "warning", duration: 10_000 },
    );
  });
});
