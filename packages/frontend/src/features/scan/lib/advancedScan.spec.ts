import { describe, expect, it } from "vitest";

import {
  createAdvancedScanFormValues,
  createAdvancedScanOptions,
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

  it("keeps only fields relevant to the selected attack type", () => {
    expect(
      createAdvancedScanOptions({
        attackType: "headers",
        customValue: "x",
        customValueType: "string",
        jsonBodyPath: "$.ignored",
        cacheBusterParameter: true,
        maxParametersAmount: undefined,
      }),
    ).toEqual({
      attackType: "headers",
      customValue: "x",
      customValueType: "string",
      jsonBodyPath: undefined,
      cacheBusterParameter: true,
      maxParametersAmount: undefined,
    });
  });

  it("normalizes empty optional values", () => {
    expect(
      createAdvancedScanOptions({
        attackType: "body",
        customValue: "",
        customValueType: "string",
        jsonBodyPath: "$.user",
        cacheBusterParameter: true,
        maxParametersAmount: null,
      }),
    ).toEqual({
      attackType: "body",
      customValue: undefined,
      customValueType: "string",
      jsonBodyPath: "$.user",
      cacheBusterParameter: undefined,
      maxParametersAmount: undefined,
    });
  });

  it("omits a custom value for the integer datatype", () => {
    expect(
      createAdvancedScanOptions({
        attackType: "body",
        customValue: "cached-prefix",
        customValueType: "integer",
        jsonBodyPath: "",
        cacheBusterParameter: false,
        maxParametersAmount: undefined,
      }),
    ).toMatchObject({
      customValue: undefined,
      customValueType: "integer",
    });
  });
});
