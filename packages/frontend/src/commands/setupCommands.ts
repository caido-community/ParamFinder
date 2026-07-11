import type { CommandContext } from "@caido/sdk-frontend";
import type { AttackType, Request, Settings, SettingsDocument } from "shared";

import { resolveContextRequests } from "./requestSource";

import {
  type AdvancedScanOptions,
  buildMiningConfig,
} from "@/features/scan/lib/buildMiningConfig";
import { useScanDialogStore } from "@/features/scan/stores/scanDialog";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { attackTypes } from "@/shared/constants/attackTypes";
import { handleBackendCall } from "@/shared/utils/backend";
import { parseRequest } from "@/shared/utils/request";
import type { FrontendSDK } from "@/types";

type AdvancedOptions = AdvancedScanOptions;
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
  options: AdvancedOptions,
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
  options: AdvancedOptions,
): Promise<void> {
  const settingsDocument = await handleBackendCall<SettingsDocument>(
    sdk.backend.getSettings(),
    sdk,
  );
  for (const request of requests) {
    await startMining(
      sdk,
      request,
      settingsDocument.settings,
      attackType,
      options,
    );
  }
}

async function startMining(
  sdk: FrontendSDK,
  request: Request,
  settings: Settings,
  attackType: AttackType,
  options: AdvancedOptions,
): Promise<void> {
  const config = buildMiningConfig(settings, attackType, options);
  const sessions = useSessionsStore();
  await handleBackendCall(sessions.startSession(request, config), sdk);
  sdk.window.showToast(`Started Param Finder [${attackType.toUpperCase()}]`, {
    variant: "info",
    duration: 2000,
  });
}
