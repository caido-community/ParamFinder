// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";

import SessionErrorPopover from "./SessionErrorPopover.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SessionErrorPopover", () => {
  it("reveals a persisted error on hover and keyboard focus", async () => {
    const wrapper = mount(SessionErrorPopover, {
      attachTo: document.body,
      props: { title: "Errored", message: "Connection reset" },
      slots: { default: "Errored" },
      global: { plugins: [PrimeVue] },
    });
    const trigger = wrapper.get("button");

    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.attributes("aria-label")).toBe("Errored: Connection reset");

    await trigger.trigger("mouseenter");
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Connection reset");

    await trigger.trigger("mouseleave");
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("false");

    await trigger.trigger("focus");
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("true");

    await trigger.trigger("keydown", { key: "Escape" });
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });
});
