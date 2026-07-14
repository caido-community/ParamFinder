import { describe, expect, it } from "vitest";

import {
  createAdvancedScanCache,
  createAdvancedScanFormValues,
  createAdvancedScanResult,
} from "./advancedScanForm";
import { evaluateJsonBody } from "./evaluateJsonBody";

const request = {
  jsonBody: '{"user":{"id":1}}',
  resolve: () => undefined,
};

describe("evaluateJsonBody", () => {
  it("classifies empty bodies", () => {
    expect(evaluateJsonBody("  ")).toEqual({ kind: "empty" });
    expect(evaluateJsonBody()).toEqual({ kind: "empty" });
  });

  it("accepts object JSON bodies and rejects root arrays", () => {
    expect(evaluateJsonBody('{"ok":true}')).toEqual({
      kind: "valid",
      value: { ok: true },
    });
    expect(evaluateJsonBody("[1,2]")).toEqual({
      kind: "not-json",
      reason: "Body must be a JSON object at the root.",
    });
  });

  it("rejects scalar JSON and invalid JSON", () => {
    expect(evaluateJsonBody('"value"')).toEqual({
      kind: "not-json",
      reason: "Body must be a JSON object at the root.",
    });
    expect(evaluateJsonBody("{").kind).toBe("not-json");
  });
});

describe("advanced scan form helpers", () => {
  it("uses request attack type before cached attack type", () => {
    expect(
      createAdvancedScanFormValues(
        { ...request, initialAttackType: "body" },
        { attackType: "headers", customValue: "cached" },
      ),
    ).toMatchObject({ attackType: "body", customValue: "cached" });
  });

  it("stores only fields relevant to the selected attack type", () => {
    expect(
      createAdvancedScanCache({
        attackType: "headers",
        customValue: "x",
        jsonBodyPath: "$.ignored",
        cacheBusterParameter: true,
        maxParametersAmount: undefined,
      }),
    ).toEqual({
      attackType: "headers",
      customValue: "x",
      jsonBodyPath: undefined,
      cacheBusterParameter: true,
      maxParametersAmount: undefined,
    });
  });

  it("creates submit payloads without empty optional strings", () => {
    expect(
      createAdvancedScanResult({
        attackType: "body",
        customValue: "",
        jsonBodyPath: "$.user",
        cacheBusterParameter: true,
        maxParametersAmount: 5,
      }),
    ).toEqual({
      attackType: "body",
      customValue: undefined,
      jsonBodyPath: "$.user",
      cacheBusterParameter: undefined,
      maxParametersAmount: 5,
    });
  });

  it("normalizes an empty max parameters value", () => {
    const values = {
      attackType: "headers" as const,
      customValue: "test",
      jsonBodyPath: "",
      cacheBusterParameter: false,
      maxParametersAmount: null,
    };

    expect(createAdvancedScanCache(values)).toMatchObject({
      maxParametersAmount: undefined,
    });
    expect(createAdvancedScanResult(values)).toMatchObject({
      maxParametersAmount: undefined,
    });
  });
});
