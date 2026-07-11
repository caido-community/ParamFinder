import type { SentRequest, SessionFinding } from "shared";

import type { VirtualSortRow } from "@/shared/components/virtualSortTable";

export type RequestRow = VirtualSortRow & {
  requestId: string;
  status: number;
  length: number;
  time: number;
  parametersTested: number;
  context: string;
};

export type FindingRow = VirtualSortRow & {
  key: string;
  requestId: string;
  parameter: string;
  anomaly: string;
  status: number;
  length: number;
};

export function getFindingKey(finding: SessionFinding, index: number): string {
  return `${finding.parameter.name}-${index}`;
}

export function createRequestRows(
  session: { sentRequests: SentRequest[] } | undefined,
): RequestRow[] {
  if (session === undefined) {
    return [];
  }

  return session.sentRequests.map((request) => ({
    requestId: request.requestId,
    status: request.responseStatus,
    length: request.responseLength,
    time: request.responseTime,
    parametersTested: request.parametersTested ?? request.parametersSent,
    context: request.context,
  }));
}

export function createFindingRows(
  session: { findings: SessionFinding[] } | undefined,
): FindingRow[] {
  if (session === undefined) {
    return [];
  }

  return session.findings.map((finding, index) => ({
    key: getFindingKey(finding, index),
    requestId: finding.requestId,
    parameter: finding.parameter.name,
    anomaly: finding.anomaly.type,
    status: finding.responseStatus,
    length: finding.responseLength,
  }));
}
