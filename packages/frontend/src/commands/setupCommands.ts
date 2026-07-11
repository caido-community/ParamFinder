import type { CommandContext } from "@caido/sdk-frontend";
import { validateMutationTarget } from "@paramfinder/engine";
import type { AttackType, Request, Settings } from "shared";

import { resolveContextRequests } from "./requestSource";

import {
  type AdvancedScanOptions,
  buildMiningConfig,
} from "@/features/scan/lib/buildMiningConfig";
import { useScanDialogStore } from "@/features/scan/stores/scanDialog";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { attackTypes } from "@/shared/constants/attackTypes";
import { handleBackendCall, toErrorMessage } from "@/shared/utils/backend";
import { parseRequest } from "@/shared/utils/request";
import type { FrontendSDK } from "@/types";

const requestMenuTypes = ["RequestRow", "Request"] as const;
const advancedScanCommandId = "paramfinder:advanced-scan";

export function setupCommands(sdk: FrontendSDK): void {
  for (const attackType of attackTypes) {
    const commandId = `paramfinder:start-${attackType}`;
    sdk.commands.register(commandId, {
      name: `Param Finder [${attackType.toUpperCase()}]`,
      group: "Param Finder",
      run: async (context: CommandContext) => {
        await runFromContext(sdk, context, attackType, {});
      },
    });
    registerRequestMenuItems(sdk, commandId);
    sdk.commandPalette.register(commandId);
  }

  sdk.commands.register(advancedScanCommandId, {
    name: "Param Finder [ADVANCED]",
    group: "Param Finder",
    run: async (context: CommandContext) => {
      await runAdvanced(sdk, context);
    },
  });
  registerRequestMenuItems(sdk, advancedScanCommandId);
  sdk.commandPalette.register(advancedScanCommandId);

  sdk.commands.register("paramfinder:quick-menu", {
    name: "Param Finder Quick Menu",
    group: "Param Finder",
    run: async (context: CommandContext) => {
      await runAdvanced(sdk, context);
    },
  });
  sdk.shortcuts.register("paramfinder:quick-menu", ["Control", "Shift", "E"]);
}

function registerRequestMenuItems(sdk: FrontendSDK, commandId: string): void {
  for (const type of requestMenuTypes) {
    sdk.menu.registerItem({
      type,
      commandId,
      leadingIcon: "fas fa-search",
    });
  }
}

async function runAdvanced(
  sdk: FrontendSDK,
  context: CommandContext,
): Promise<void> {
  const dialog = useScanDialogStore();

  const requests = await resolveRequestsOrNotify(sdk, context);
  if (requests.length === 0) {
    return;
  }

  const jsonBody = parseRequest(requests[0]?.raw ?? "").body;

  const result = await dialog.open({ jsonBody });
  if (result === undefined) {
    return;
  }
  await runForRequests(sdk, requests, result.attackType, {
    customValue: result.customValue,
    jsonBodyPath: result.jsonBodyPath,
    cacheBusterParameter: result.cacheBusterParameter,
    maxParametersAmount: result.maxParametersAmount,
  });
}

async function runFromContext(
  sdk: FrontendSDK,
  context: CommandContext,
  attackType: AttackType,
  options: AdvancedScanOptions,
): Promise<void> {
  const requests = await resolveRequestsOrNotify(sdk, context);
  if (requests.length > 0) {
    await runForRequests(sdk, requests, attackType, options);
  }
}

async function resolveRequestsOrNotify(
  sdk: FrontendSDK,
  context: CommandContext,
): Promise<Request[]> {
  try {
    const requests = await resolveContextRequests(sdk, context);
    if (requests.length === 0) {
      sdk.window.showToast(
        "No reliable request selection is available in this context.",
        { variant: "error", duration: 10_000 },
      );
    }
    return requests;
  } catch (err: unknown) {
    sdk.window.showToast(
      err instanceof Error ? err.message : "Failed to resolve the request.",
      { variant: "error", duration: 10_000 },
    );
    return [];
  }
}

async function runForRequests(
  sdk: FrontendSDK,
  requests: Request[],
  attackType: AttackType,
  options: AdvancedScanOptions,
): Promise<void> {
  let settings: Settings;
  try {
    settings = await handleBackendCall<Settings>(
      sdk.backend.getSettings(),
      sdk,
    );
  } catch {
    return;
  }

  const config = buildMiningConfig(settings, attackType, options);
  const sessions = useSessionsStore();
  const failures: string[] = [];
  const validRequests: Request[] = [];

  for (const request of requests) {
    try {
      validateMutationTarget({
        baseRequest: request,
        attackType,
        customValueType: config.customValueType,
        jsonBodyPath: config.jsonBodyPath,
      });
      validRequests.push(request);
    } catch (err: unknown) {
      failures.push(toErrorMessage(err));
    }
  }

  let started = 0;
  for (const request of validRequests) {
    try {
      const result = await sessions.startSession(request, config);
      if (result.success) {
        started += 1;
      } else {
        failures.push(result.error.message);
      }
    } catch (err: unknown) {
      failures.push(toErrorMessage(err));
    }
  }

  showStartSummary(sdk, attackType, requests.length, started, failures);
}

function showStartSummary(
  sdk: FrontendSDK,
  attackType: AttackType,
  total: number,
  started: number,
  failures: string[],
): void {
  const scanLabel = `Param Finder [${attackType.toUpperCase()}]`;
  if (failures.length === 0) {
    const message =
      started === 1
        ? `Started ${scanLabel}`
        : `Started ${started} ${scanLabel} scans`;
    sdk.window.showToast(message, { variant: "info", duration: 2000 });
    return;
  }

  const prefix =
    started === 0
      ? `Could not start ${scanLabel} for ${formatRequestCount(total)}`
      : `Started ${started} of ${total} ${scanLabel} scans`;
  sdk.window.showToast(`${prefix}. ${summarizeFailures(failures)}`, {
    variant: started === 0 ? "error" : "warning",
    duration: 10_000,
  });
}

function formatRequestCount(count: number): string {
  return `${count} request${count === 1 ? "" : "s"}`;
}

function summarizeFailures(failures: string[]): string {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    counts.set(failure, (counts.get(failure) ?? 0) + 1);
  }

  return [...counts]
    .map(([message, count]) =>
      count === 1 ? message : `${message} (${count} requests)`,
    )
    .join("; ");
}
