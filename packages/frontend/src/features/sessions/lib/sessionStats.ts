import {
  MiningSessionPhase,
  MiningSessionState,
  type SessionDescriptor,
} from "shared";

export type SessionStats = {
  requestsSent: number;
  parametersTested: number;
  findings: number;
  remaining: number;
  progress: number;
  progressCurrent: number;
  progressTotal: number;
};

export type StatusTone = "info" | "warning" | "success" | "danger" | "neutral";

export type StateMeta = {
  label: string;
  tone: StatusTone;
};

export type SessionCapabilities = {
  isRunning: boolean;
  isPaused: boolean;
  canCancel: boolean;
  canRerun: boolean;
};

export const statusToneClasses: Record<StatusTone, string> = {
  info: "bg-blue-400",
  warning: "bg-yellow-400",
  success: "bg-success-400",
  danger: "bg-danger-400",
  neutral: "bg-surface-400",
};

export function getSessionCapabilities(
  session: SessionDescriptor | undefined,
): SessionCapabilities {
  const isRunning =
    session?.state === MiningSessionState.Running ||
    session?.state === MiningSessionState.Learning;
  const isPaused = session?.state === MiningSessionState.Paused;
  const canRerun =
    session !== undefined &&
    session.rerun !== undefined &&
    (session.state === MiningSessionState.Completed ||
      session.state === MiningSessionState.Canceled ||
      session.state === MiningSessionState.Error ||
      session.state === MiningSessionState.Timeout);

  return {
    isRunning,
    isPaused,
    canCancel: isRunning || isPaused,
    canRerun,
  };
}

export function getSessionStats(
  session: SessionDescriptor | undefined,
): SessionStats | undefined {
  if (session === undefined) {
    return undefined;
  }

  const progressCounts = {
    learningRequests:
      session.phase === MiningSessionPhase.Learning ? session.requestsSent : 0,
    parametersTested: session.parametersSent,
  };

  const inLearning = session.phase === MiningSessionPhase.Learning;
  const progressTotal = inLearning
    ? session.totalLearnRequests
    : session.totalParametersAmount;
  const rawProgressCurrent = inLearning
    ? progressCounts.learningRequests
    : progressCounts.parametersTested;
  const progressCurrent =
    progressTotal > 0
      ? Math.min(rawProgressCurrent, progressTotal)
      : rawProgressCurrent;
  const progress =
    progressTotal > 0
      ? Math.min((progressCurrent / progressTotal) * 100, 100)
      : 0;
  const remaining =
    progressTotal > 0 ? Math.max(progressTotal - progressCurrent, 0) : 0;

  return {
    requestsSent: session.requestsSent,
    parametersTested: progressCounts.parametersTested,
    findings: session.findingsCount,
    remaining,
    progress,
    progressCurrent,
    progressTotal,
  };
}

export function getSessionStateMeta(
  state: SessionDescriptor["state"] | undefined,
): StateMeta {
  switch (state) {
    case MiningSessionState.Running:
      return { label: "Running", tone: "info" };
    case MiningSessionState.Learning:
      return { label: "Learning", tone: "info" };
    case MiningSessionState.Paused:
      return { label: "Paused", tone: "neutral" };
    case MiningSessionState.Completed:
      return { label: "Completed", tone: "success" };
    case MiningSessionState.Error:
      return { label: "Errored", tone: "danger" };
    case MiningSessionState.Timeout:
      return { label: "Timeout", tone: "danger" };
    case MiningSessionState.Canceled:
      return { label: "Canceled", tone: "danger" };
    case MiningSessionState.Pending:
      return { label: "Pending", tone: "neutral" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}

export function getSessionStateTitle(session: SessionDescriptor): string {
  const label = getSessionStateMeta(session.state).label;
  return session.error === undefined
    ? label
    : `${label}: ${session.error.message}`;
}

export function getProgressLabel(
  session: SessionDescriptor | undefined,
  stats: SessionStats | undefined,
): string {
  if (session === undefined || stats === undefined) {
    return "";
  }

  if (session.phase === MiningSessionPhase.Learning) {
    return `${stats.progressCurrent} / ${stats.progressTotal} learn requests`;
  }

  if (session.phase === MiningSessionPhase.Discovery) {
    return `${stats.progressCurrent} / ${stats.progressTotal} parameters`;
  }

  return "Awaiting work";
}
