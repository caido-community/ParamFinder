import { AttackType } from "shared";
import { describe, expect, it } from "vitest";

import {
  attackTypeOptions,
  attackTypes,
  attackTypeSelectOptions,
} from "./attackTypes";

describe("attack type options", () => {
  it("derives command and select values from the canonical metadata", () => {
    expect(attackTypes).toEqual(Object.values(AttackType));
    expect(attackTypeSelectOptions).toEqual(
      attackTypeOptions.map(({ label, value }) => ({ label, value })),
    );
  });
});
