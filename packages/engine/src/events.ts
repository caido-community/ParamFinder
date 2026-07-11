import type {
  BaselineProfile,
  EnginePhase,
  EngineRequestResponse,
  EngineRunSummary,
  EngineState,
  Finding,
  LoggerLevel,
  RequestContext,
} from "./types";

export type DiscoveryEvent =
  | {
      type: "state";
      state: EngineState;
      phase: EnginePhase;
    }
  | {
      type: "log";
      level: LoggerLevel;
      message: string;
    }
  | {
      type: "request";
      parametersSent: number;
      parametersTested: number;
      context: RequestContext;
      requestResponse: EngineRequestResponse;
    }
  | {
      type: "finding";
      finding: Finding;
    }
  | {
      type: "adjustTotalParameters";
      totalParametersAmount: number;
    }
  | {
      type: "learnedProfile";
      profile: BaselineProfile;
    }
  | ({ type: "completed" } & EngineRunSummary);
