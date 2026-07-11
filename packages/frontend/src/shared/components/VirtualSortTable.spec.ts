// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import VirtualSortTable from "./VirtualSortTable.vue";

const rows = [
  { requestId: "1", status: 200 },
  { requestId: "2", status: 404 },
];

describe("VirtualSortTable DOM behavior", () => {
  it("emits backend sort direction and requests the next page near the end", async () => {
    const wrapper = mount(VirtualSortTable, {
      props: {
        rows,
        columns: [
          { field: "requestId", label: "ID", width: "80px" },
          { field: "status", label: "Status", width: "80px" },
        ],
        keyField: "requestId",
        initialSortColumn: "requestId",
        emptyIcon: "fas fa-inbox",
        emptyMessage: "No requests",
        serverSide: true,
      },
    });

    const idHeader = wrapper.findAll("th")[0];
    await idHeader?.trigger("click");
    await idHeader?.trigger("click");
    expect(wrapper.emitted("sort-change")).toEqual([
      ["requestId", "desc"],
      ["requestId", "asc"],
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
