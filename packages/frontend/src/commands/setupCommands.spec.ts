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

import { setupCommands } from "./setupCommands";

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

type CommandRun = (context: CommandContext) => Promise<void>;

function createSDK(getSettings = vi.fn(async () => ok(settings))): {
  sdk: FrontendSDK;
  commands: Map<string, CommandRun>;
  showToast: ReturnType<typeof vi.fn>;
} {
  const commands = new Map<string, CommandRun>();
  const showToast = vi.fn();
  const sdk = {
    backend: { getSettings },
    commands: {
      register: vi.fn(
        (
          id: string,
          definition: { run: (context: CommandContext) => Promise<void> },
        ) => {
          commands.set(id, async (context) => {
            await definition.run(context);
          });
        },
      ),
    },
    commandPalette: { register: vi.fn() },
    menu: { registerItem: vi.fn() },
    shortcuts: { register: vi.fn() },
    window: { showToast },
  } as unknown as FrontendSDK;
  setupCommands(sdk);
  return { sdk, commands, showToast };
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

function getRun(commands: Map<string, CommandRun>, id: string): CommandRun {
  const run = commands.get(id);
  if (run === undefined) {
    throw new Error(`Command ${id} was not registered`);
  }
  return run;
}

describe("scan command batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevalidates the batch, attempts every valid request, and summarizes once", async () => {
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
    const { commands, showToast } = createSDK();

    await expect(
      getRun(commands, "paramfinder:start-body")({} as CommandContext),
    ).resolves.toBeUndefined();

    expect(mocks.startSession).toHaveBeenCalledTimes(2);
    expect(mocks.startSession.mock.calls.map(([target]) => target.id)).toEqual([
      "first",
      "last",
    ]);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(
        /Started 1 of 3.*Unsupported body type.*No enabled wordlists/,
      ),
      { variant: "warning", duration: 10_000 },
    );
  });

  it("uses one plural success toast for a successful selection", async () => {
    const first = request(
      "first",
      "GET /one HTTP/1.1\r\nHost: example.com\r\n\r\n",
    );
    const second = request(
      "second",
      "GET /two HTTP/1.1\r\nHost: example.com\r\n\r\n",
    );
    mocks.resolveRequests.mockResolvedValue([first, second]);
    mocks.startSession.mockResolvedValue(ok(descriptor()));
    const { commands, showToast } = createSDK();

    await getRun(commands, "paramfinder:start-query")({} as CommandContext);

    expect(mocks.startSession.mock.calls.map(([target]) => target.id)).toEqual([
      "first",
      "second",
    ]);
    expect(showToast).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(
      "Started 2 Param Finder [QUERY] scans",
      { variant: "info", duration: 2000 },
    );
  });

  it("absorbs a settings failure after its single error toast", async () => {
    mocks.resolveRequests.mockResolvedValue([
      request("first", "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"),
    ]);
    const { commands, showToast } = createSDK(
      vi.fn(async () => error("Settings unavailable", "IO")),
    );

    await expect(
      getRun(commands, "paramfinder:start-query")({} as CommandContext),
    ).resolves.toBeUndefined();

    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith("Settings unavailable", {
      variant: "error",
      duration: 10_000,
    });
  });

  it("continues after a rejected start and resolves the command callback", async () => {
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
    const { commands, showToast } = createSDK();

    await expect(
      getRun(commands, "paramfinder:start-query")({} as CommandContext),
    ).resolves.toBeUndefined();

    expect(mocks.startSession).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/Started 1 of 2.*Transport failed/),
      { variant: "warning", duration: 10_000 },
    );
  });

  it("applies an advanced JSON path only to compatible selected requests", async () => {
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
    const { commands, showToast } = createSDK();

    await getRun(commands, "paramfinder:advanced-scan")({} as CommandContext);

    expect(mocks.openDialog).toHaveBeenCalledWith({
      jsonBody: '{"target":{}}',
    });
    expect(mocks.startSession).toHaveBeenCalledOnce();
    expect(mocks.startSession.mock.calls[0]?.[0].id).toBe("compatible");
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(
        /Started 1 of 2.*JSON body path did not resolve to an object/,
      ),
      { variant: "warning", duration: 10_000 },
    );
  });
});
