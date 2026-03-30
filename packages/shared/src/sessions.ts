import { Anomaly, AnomalyType } from "./anomaly";
import { Parameter, RequestContext, RequestResponse } from "./requests";

export enum MiningSessionState {
  Pending = "pending",
  Learning = "learning",
  Running = "running",
  Completed = "completed",
  Error = "error",
  Paused = "paused",
  Canceled = "canceled",
  Timeout = "timeout",
}

export enum MiningSessionPhase {
  Learning = "learning",
  Discovery = "discovery",
  Idle = "idle",
}

export interface MiningSession {
  id: string;
  state: MiningSessionState;
  phase: MiningSessionPhase;
  sentRequests: {
    parametersSent: number;
    context: RequestContext;
    requestResponse?: RequestResponse;
  }[];
  findings: Finding[];
  logs: string[];
  totalParametersAmount: number;
  totalLearnRequests: number;
}

export type Finding = {
  requestResponse: RequestResponse;
  parameter: Parameter;
  anomalyType: AnomalyType;
  anomaly?: Anomaly;
};
