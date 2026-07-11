import {
  AnomalyType,
  type SentRequest,
  type Sequenced,
  type SessionFinding,
} from "shared";
import { describe, expect, it } from "vitest";

import { createFindingRows, createRequestRows } from "./sessionRows";

function createSession(
  overrides: {
    findings?: Sequenced<SessionFinding>[];
    sentRequests?: Sequenced<SentRequest>[];
  } = {},
) {
  return { findings: [], sentRequests: [], ...overrides };
}

describe("sessionRows", () => {
  it("returns empty rows for an undefined session", () => {
    expect(createRequestRows(undefined)).toEqual([]);
    expect(createFindingRows(undefined)).toEqual([]);
  });

  it("maps sent requests to table rows", () => {
    const rows = createRequestRows(
      createSession({
        sentRequests: [
          {
            sequence: 10,
            requestId: "request-1",
            responseStatus: 200,
            responseTime: 12,
            responseLength: 100,
            parametersSent: 4,
            parametersTested: 6,
            context: "discovery",
          },
        ],
      }),
    );

    expect(rows).toEqual([
      {
        requestId: "request-1",
        status: 200,
        length: 100,
        time: 12,
        parametersTested: 6,
        context: "discovery",
      },
    ]);
  });

  it("falls back to parametersSent when parametersTested is missing", () => {
    const rows = createRequestRows(
      createSession({
        sentRequests: [
          {
            sequence: 11,
            requestId: "request-1",
            responseStatus: 200,
            responseTime: 1,
            responseLength: 10,
            parametersSent: 3,
            context: "learning",
          },
        ],
      }),
    );

    expect(rows[0]?.parametersTested).toBe(3);
  });

  it("maps findings to rows with stable keys", () => {
    const rows = createFindingRows(
      createSession({
        findings: [
          {
            sequence: 41,
            requestId: "request-1",
            responseStatus: 200,
            responseLength: 10,
            parameter: { name: "id", value: "x" },
            anomaly: { type: AnomalyType.StatusCode, from: 200, to: 404 },
          },
          {
            sequence: 99,
            requestId: "request-2",
            responseStatus: 500,
            responseLength: 20,
            parameter: { name: "id", value: "y" },
            anomaly: { type: AnomalyType.StatusCode, from: 200, to: 500 },
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.key).toBe("41");
    expect(rows[1]?.key).toBe("99");
    expect(rows[0]?.parameter).toBe("id");
    expect(rows[0]?.anomaly).toBe(AnomalyType.StatusCode);
  });
});
