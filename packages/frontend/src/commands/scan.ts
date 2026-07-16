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
import { toErrorMessage } from "@/shared/utils/backend";
import { parseRequest } from "@/shared/utils/request";
import type { FrontendSDK } from "@/types";

export async function runAdvancedScan(
  sdk: FrontendSDK,
  context: CommandContext,
) {
  const requests = await resolveRequestsOrNotify(sdk, context);
  if (requests.length === 0) return;

  const dialog = useScanDialogStore();
  const result = await dialog.open({
    jsonBody: parseRequest(requests[0]?.raw ?? "").body,
  });
  if (result === undefined) return;

  const { attackType, ...options } = result;
  await runForRequests(sdk, requests, attackType, options);
}

export async function runScan(
  sdk: FrontendSDK,
  context: CommandContext,
  attackType: AttackType,
) {
  const requests = await resolveRequestsOrNotify(sdk, context);
  if (requests.length > 0) {
    await runForRequests(sdk, requests, attackType, {});
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
  } catch (error: unknown) {
    sdk.window.showToast(
      error instanceof Error ? error.message : "Failed to resolve the request.",
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
) {
  let settings: Settings;
  try {
    const result = await sdk.backend.getSettings();
    if (!result.success) {
      sdk.window.showToast(result.error.message, {
        variant: "error",
        duration: 10_000,
      });
      return;
    }
    settings = result.value;
  } catch (error: unknown) {
    sdk.window.showToast(toErrorMessage(error), {
      variant: "error",
      duration: 10_000,
    });
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
    } catch (error: unknown) {
      failures.push(toErrorMessage(error));
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
    } catch (error: unknown) {
      failures.push(toErrorMessage(error));
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
) {
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

function formatRequestCount(count: number) {
  return `${count} request${count === 1 ? "" : "s"}`;
}

function summarizeFailures(failures: string[]) {
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
