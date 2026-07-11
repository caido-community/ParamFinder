import { describeAnomaly } from "./discovery";
import type { DiscoveryEvent } from "./events";
import { EngineState } from "./types";
import type {
  AnomalyType,
  EnginePhase,
  EngineRunSummary,
  EngineRunSummaryBase,
  Finding,
  LoggerLevel,
  RequestContext,
} from "./types";

export interface ScanProgress {
  requestsSent: number;
  parametersSent: number;
  findingsCount: number;
  totalParametersAmount: number;
}

export interface ScanRequestSummary {
  context: RequestContext;
  parametersSent: number;
  parametersTested: number;
  responseStatus: number;
  responseTime: number;
}

export interface ScanFindingSummary {
  parameter: string;
  anomalyType: AnomalyType;
  anomaly: string;
  context: RequestContext;
  responseStatus: number;
  responseTime: number;
}

interface ScanSummaryBase extends ScanProgress {
  findings: ScanFindingSummary[];
}

export type ScanOutcomeState =
  | typeof EngineState.Completed
  | typeof EngineState.Canceled
  | typeof EngineState.Timeout
  | typeof EngineState.Error;

type ToScanSummary<T extends EngineRunSummary> = T extends EngineRunSummary
  ? ScanSummaryBase & Omit<T, keyof EngineRunSummaryBase>
  : never;

export type ScanSummary = ToScanSummary<EngineRunSummary>;

export type ScanEvent =
  | {
      type: "state";
      state: EngineState;
      phase: EnginePhase;
      progress: ScanProgress;
    }
  | {
      type: "log";
      level: LoggerLevel;
      message: string;
      progress: ScanProgress;
    }
  | {
      type: "request";
      request: ScanRequestSummary;
      progress: ScanProgress;
    }
  | {
      type: "finding";
      finding: ScanFindingSummary;
      progress: ScanProgress;
    }
  | {
      type: "progress";
      totalParametersAmount: number;
      progress: ScanProgress;
    }
  | {
      type: "summary";
      summary: ScanSummary;
      progress: ScanProgress;
    };

export interface ScanEventProjection {
  readonly progress: ScanProgress;
  readonly findingSummaries: readonly ScanFindingSummary[];
  handleDiscoveryEvent(event: DiscoveryEvent): ScanEvent | undefined;
  buildSummary(
    result: EngineRunSummary,
    findings?: readonly ScanFindingSummary[],
  ): ScanSummary;
  summarizeFinding(finding: Finding): ScanFindingSummary;
}

export function createScanEventProjection(
  totalParametersAmount: number,
): ScanEventProjection {
  const progress: ScanProgress = {
    requestsSent: 0,
    parametersSent: 0,
    findingsCount: 0,
    totalParametersAmount,
  };
  const findingSummaries: ScanFindingSummary[] = [];

  const handleDiscoveryEvent = (
    event: DiscoveryEvent,
  ): ScanEvent | undefined => {
    switch (event.type) {
      case "state":
        return {
          type: "state",
          state: event.state,
          phase: event.phase,
          progress: snapshotProgress(progress),
        };
      case "log":
        return {
          type: "log",
          level: event.level,
          message: event.message,
          progress: snapshotProgress(progress),
        };
      case "request":
        progress.requestsSent += 1;
        progress.parametersSent += event.parametersSent;
        return {
          type: "request",
          request: {
            context: event.context,
            parametersSent: event.parametersSent,
            parametersTested: event.parametersTested,
            responseStatus: event.requestResponse.response.status,
            responseTime: event.requestResponse.response.time,
          },
          progress: snapshotProgress(progress),
        };
      case "finding": {
        const finding = summarizeFinding(event.finding);
        findingSummaries.push(finding);
        progress.findingsCount = findingSummaries.length;
        return {
          type: "finding",
          finding,
          progress: snapshotProgress(progress),
        };
      }
      case "adjustTotalParameters":
        progress.totalParametersAmount = event.totalParametersAmount;
        return {
          type: "progress",
          totalParametersAmount: event.totalParametersAmount,
          progress: snapshotProgress(progress),
        };
      case "completed": {
        progress.findingsCount = event.findings.length;
        progress.totalParametersAmount = event.totalParametersAmount;
        return {
          type: "summary",
          summary: buildSummary(
            event,
            progress,
            findingSummaries.length > 0
              ? findingSummaries
              : event.findings.map(summarizeFinding),
          ),
          progress: snapshotProgress(progress),
        };
      }
      case "learnedProfile":
        return undefined;
      default: {
        const exhaustiveEvent: never = event;
        return exhaustiveEvent;
      }
    }
  };

  return {
    get progress() {
      return snapshotProgress(progress);
    },
    get findingSummaries() {
      return [...findingSummaries];
    },
    handleDiscoveryEvent,
    buildSummary: (result, findings = findingSummaries) =>
      buildSummary(result, progress, findings),
    summarizeFinding,
  };
}

export function summarizeFinding(finding: Finding): ScanFindingSummary {
  return {
    parameter: finding.parameter.name,
    anomalyType: finding.anomaly.type,
    anomaly: describeAnomaly(finding.anomaly),
    context: finding.requestResponse.request.context,
    responseStatus: finding.requestResponse.response.status,
    responseTime: finding.requestResponse.response.time,
  };
}

function buildSummary(
  result: EngineRunSummary,
  progress: ScanProgress,
  findings: readonly ScanFindingSummary[],
): ScanSummary {
  const baseSummary: ScanSummaryBase = {
    totalParametersAmount: result.totalParametersAmount,
    requestsSent: progress.requestsSent,
    parametersSent: progress.parametersSent,
    findingsCount: findings.length,
    findings: [...findings],
  };

  switch (result.state) {
    case EngineState.Error:
      return {
        ...baseSummary,
        state: result.state,
        phase: result.phase,
        failureReason: result.failureReason,
      };
    case EngineState.Completed:
      return {
        ...baseSummary,
        state: result.state,
        phase: result.phase,
      };
    case EngineState.Canceled:
      return {
        ...baseSummary,
        state: result.state,
        phase: result.phase,
      };
    case EngineState.Timeout:
      return {
        ...baseSummary,
        state: result.state,
        phase: result.phase,
      };
    default: {
      const exhaustiveResult: never = result;
      return exhaustiveResult;
    }
  }
}

function snapshotProgress(progress: ScanProgress): ScanProgress {
  return {
    requestsSent: progress.requestsSent,
    parametersSent: progress.parametersSent,
    findingsCount: progress.findingsCount,
    totalParametersAmount: progress.totalParametersAmount,
  };
}
