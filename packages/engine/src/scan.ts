import { createDiscoveryEngine } from "./engine";
import { toEngineError } from "./errors";
import type { EngineDependencies } from "./provider";
import { createScanEventProjection, summarizeFinding } from "./scan-events";
import type { ScanEvent, ScanSummary } from "./scan-events";
import type { EngineRunInput, EngineRunResult } from "./types";

export type {
  ScanEvent,
  ScanFindingSummary,
  ScanOutcomeState,
  ScanProgress,
  ScanRequestSummary,
  ScanSummary,
} from "./scan-events";

export interface RunDiscoveryScanOptions {
  onEvent?: (event: ScanEvent) => void;
}

export interface RunDiscoveryScanResult {
  result: EngineRunResult;
  summary: ScanSummary;
}

export async function runDiscoveryScan(
  dependencies: EngineDependencies,
  input: EngineRunInput,
  options?: RunDiscoveryScanOptions,
): Promise<RunDiscoveryScanResult> {
  const engine = createDiscoveryEngine(dependencies);
  const scanEvents = createScanEventProjection(input.words.length);
  const rawOnEvent = input.runOptions?.onEvent;

  const runInput: EngineRunInput = {
    ...input,
    runOptions: {
      ...input.runOptions,
      onEvent: (event) => {
        rawOnEvent?.(event);
        const scanEvent = scanEvents.handleDiscoveryEvent(event);
        if (scanEvent) {
          options?.onEvent?.(scanEvent);
        }
      },
    },
  };

  try {
    const result = await engine.run(runInput);
    const findings =
      scanEvents.findingSummaries.length === result.findings.length
        ? scanEvents.findingSummaries
        : result.findings.map(summarizeFinding);
    const summary = scanEvents.buildSummary(result, findings);
    return {
      result,
      summary,
    };
  } catch (error) {
    throw toEngineError(error);
  }
}
