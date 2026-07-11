import type { Settings } from "shared";
import { describe, expect, it } from "vitest";

import { initialModel } from "./store.model";
import { update } from "./store.update";

const settings = { delay: 10 } as Settings;

describe("settings update", () => {
  it("replaces settings with the validated backend response", () => {
    const saving = update(
      { ...initialModel, data: settings },
      { type: "SAVE_REQUEST" },
    );
    const saved = update(saving, {
      type: "SAVE_SUCCESS",
      data: { ...settings, delay: 20 },
    });

    expect(saved).toMatchObject({ saving: false, data: { delay: 20 } });
    expect(settings.delay).toBe(10);
  });

  it("keeps confirmed settings after a failed save", () => {
    const failed = update(
      { ...initialModel, data: settings, saving: true },
      { type: "SAVE_FAILURE", error: "failed" },
    );

    expect(failed).toMatchObject({
      data: settings,
      saving: false,
      error: "failed",
    });
  });
});
