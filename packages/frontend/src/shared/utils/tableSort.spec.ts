import { describe, expect, it } from "vitest";

import {
  createInitialSortState,
  getSortIcon,
  nextSortState,
  sortRows,
} from "./tableSort";

describe("table sort helpers", () => {
  it("cycles sort state", () => {
    const initial = createInitialSortState("name");
    const descending = nextSortState(initial, "name");
    const cleared = nextSortState(descending, "name");

    expect(initial).toEqual({ column: "name", direction: "asc" });
    expect(descending).toEqual({ column: "name", direction: "desc" });
    expect(cleared).toEqual({ column: undefined, direction: undefined });
    expect(nextSortState(cleared, "status")).toEqual({
      column: "status",
      direction: "asc",
    });
  });

  it("returns icons for each state", () => {
    expect(getSortIcon({ column: "name", direction: "asc" }, "name")).toBe(
      "fas fa-sort-up",
    );
    expect(getSortIcon({ column: "name", direction: "desc" }, "name")).toBe(
      "fas fa-sort-down",
    );
    expect(
      getSortIcon({ column: undefined, direction: undefined }, "name"),
    ).toBe("fas fa-sort");
  });

  it("sorts numbers, strings, and undefined values", () => {
    const rows = [
      { name: "b", score: 2 },
      { name: "a", score: undefined },
      { name: "c", score: 1 },
    ];

    expect(
      sortRows(
        rows,
        { column: "score", direction: "asc" },
        (row, column) => row[column],
      ).map((row) => row.name),
    ).toEqual(["c", "b", "a"]);
  });
});
