// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { type Component, nextTick } from "vue";

import VirtualSortTable from "./VirtualSortTable.vue";

const VirtualSortTableForTest = VirtualSortTable as Component;

const virtualizer = vi.hoisted(() => ({
  getTotalSize: vi.fn(() => 0),
  getVirtualItems: vi.fn(() => []),
  measure: vi.fn(),
}));

vi.mock("@tanstack/vue-virtual", async () => {
  const { shallowRef } = await import("vue");
  return {
    useVirtualizer: () => shallowRef(virtualizer),
  };
});

const rows = [
  { requestId: "1", status: 200 },
  { requestId: "2", status: 404 },
];

describe("VirtualSortTable DOM behavior", () => {
  it("remeasures the virtual rows when the list grows", async () => {
    const wrapper = mount(VirtualSortTableForTest, {
      props: {
        rows,
        columns: [
          { field: "requestId", label: "ID", width: "80px" },
          { field: "status", label: "Status", width: "80px" },
        ],
        keyField: "requestId",
        emptyIcon: "fas fa-inbox",
        emptyMessage: "No requests",
      },
    });

    await wrapper.setProps({
      rows: [...rows, { requestId: "3", status: 201 }],
    });
    await nextTick();

    expect(virtualizer.measure).toHaveBeenCalledOnce();
  });

  it("emits backend sort direction and requests the next page near the end", async () => {
    const wrapper = mount(VirtualSortTableForTest, {
      props: {
        rows,
        columns: [
          { field: "requestId", label: "ID", width: "80px" },
          { field: "status", label: "Status", width: "80px" },
        ],
        keyField: "requestId",
        emptyIcon: "fas fa-inbox",
        emptyMessage: "No requests",
      },
    });

    const idHeader = wrapper.findAll("th")[0];
    await idHeader?.trigger("click");
    await idHeader?.trigger("click");
    expect(wrapper.emitted("sort-change")).toEqual([
      ["requestId", "asc"],
      ["requestId", "desc"],
    ]);

    const scrollBody = wrapper.find(".table-body-gutter");
    Object.defineProperties(scrollBody.element, {
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 750 },
      clientHeight: { configurable: true, value: 100 },
    });
    await scrollBody.trigger("scroll");

    expect(wrapper.emitted("load-more")).toHaveLength(1);
  });
});
