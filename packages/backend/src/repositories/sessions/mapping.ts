import {
  type SessionDescriptor,
  sessionDescriptorSchema,
  type SessionEntry,
  type SessionEntryInput,
  sessionEntrySchema,
  type SessionEntrySortField,
} from "shared";
import type { Parameter } from "sqlite";

export const SESSION_COLUMNS = `
  project_id, session_id, state, phase, total_parameters_amount,
  total_learn_requests, parameters_sent, requests_sent, findings_count,
  logs_count, created_at, error_json, rerun_json
`;

export type SessionRow = {
  project_id: string;
  session_id: string;
  state: string;
  phase: string;
  total_parameters_amount: number;
  total_learn_requests: number;
  parameters_sent: number;
  requests_sent: number;
  findings_count: number;
  logs_count: number;
  created_at: number;
  error_json: string | null | undefined;
  rerun_json: string | null | undefined;
};

export type EntryRow = {
  sequence: number;
  kind: string;
  value_json: string;
};

export function sessionParameters(session: SessionDescriptor): Parameter[] {
  return [
    session.ref.projectId,
    session.ref.sessionId,
    session.state,
    session.phase,
    session.totalParametersAmount,
    session.totalLearnRequests,
    session.parametersSent,
    session.requestsSent,
    session.findingsCount,
    session.logsCount,
    session.createdAt,
    session.error === undefined ? null : JSON.stringify(session.error),
    JSON.stringify(session.rerun),
  ];
}

export function descriptorFromRow(row: SessionRow): SessionDescriptor {
  return sessionDescriptorSchema.parse({
    ref: { projectId: row.project_id, sessionId: row.session_id },
    state: row.state,
    phase: row.phase,
    totalParametersAmount: row.total_parameters_amount,
    totalLearnRequests: row.total_learn_requests,
    parametersSent: row.parameters_sent,
    requestsSent: row.requests_sent,
    findingsCount: row.findings_count,
    logsCount: row.logs_count,
    createdAt: row.created_at,
    error: parseOptionalJson(row.error_json),
    rerun: parseOptionalJson(row.rerun_json),
  });
}

export function nextNumericSessionId(sessionIds: Iterable<string>): string {
  let largest = 0n;
  for (const sessionId of sessionIds) {
    if (!/^\d+$/.test(sessionId)) continue;
    const value = BigInt(sessionId);
    if (value > largest) largest = value;
  }
  return String(largest + 1n);
}

export function sequenceEntry(
  entry: SessionEntryInput,
  sequence: number,
): SessionEntry {
  switch (entry.kind) {
    case "request":
      return { ...entry, sequence };
    case "finding":
      return { ...entry, sequence };
    case "log":
      return { ...entry, sequence };
  }
}

export function entryFromRow(row: EntryRow): SessionEntry {
  return sessionEntrySchema.parse({
    sequence: row.sequence,
    kind: row.kind,
    value: JSON.parse(row.value_json),
  });
}

export function entryProjections(entry: SessionEntry) {
  if (typeof entry.value === "string") return {};
  return {
    requestId: entry.value.requestId,
    responseStatus: entry.value.responseStatus,
    responseLength: entry.value.responseLength,
    responseTime:
      "responseTime" in entry.value ? entry.value.responseTime : undefined,
    parametersSent:
      "parametersSent" in entry.value ? entry.value.parametersSent : undefined,
    parametersTested:
      "parametersSent" in entry.value
        ? (entry.value.parametersTested ?? entry.value.parametersSent)
        : undefined,
    context: "context" in entry.value ? entry.value.context : undefined,
    parameter:
      "parameter" in entry.value ? entry.value.parameter.name : undefined,
    anomaly: "anomaly" in entry.value ? entry.value.anomaly.type : undefined,
  };
}

export function sortColumn(field: SessionEntrySortField): string {
  const columns: Record<SessionEntrySortField, string> = {
    sequence: "sequence",
    requestId: "request_id",
    responseStatus: "response_status",
    responseLength: "response_length",
    responseTime: "response_time",
    parametersSent: "parameters_sent",
    parametersTested: "parameters_tested",
    context: "context",
    parameter: "parameter",
    anomaly: "anomaly",
  };
  return columns[field];
}

function parseOptionalJson(value: string | null | undefined): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  return JSON.parse(value);
}
