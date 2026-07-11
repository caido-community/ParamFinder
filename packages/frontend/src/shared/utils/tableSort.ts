export type SortDirection = "asc" | "desc" | undefined;

export type SortState<T extends string> = {
  column: T | undefined;
  direction: SortDirection;
};

export type SortValue = string | number | undefined;

export function createInitialSortState<T extends string>(
  initialColumn?: T,
): SortState<T> {
  return {
    column: initialColumn,
    direction: initialColumn !== undefined ? "asc" : undefined,
  };
}

export function nextSortState<T extends string>(
  state: SortState<T>,
  column: T,
): SortState<T> {
  if (state.column !== column) {
    return { column, direction: "asc" };
  }

  if (state.direction === "asc") {
    return { column, direction: "desc" };
  }

  if (state.direction === "desc") {
    return { column: undefined, direction: undefined };
  }

  return { column, direction: "asc" };
}

export function getSortIcon<T extends string>(
  state: SortState<T>,
  column: T,
): string {
  if (state.column !== column) {
    return "fas fa-sort";
  }

  if (state.direction === "asc") {
    return "fas fa-sort-up";
  }

  return "fas fa-sort-down";
}

export function sortRows<Row, T extends string>(
  rows: Row[],
  state: SortState<T>,
  getValue: (row: Row, column: T) => SortValue,
): Row[] {
  if (state.column === undefined || state.direction === undefined) {
    return rows;
  }

  const column = state.column;
  const direction = state.direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const aValue = getValue(a, column);
    const bValue = getValue(b, column);

    if (aValue === undefined && bValue === undefined) {
      return 0;
    }

    if (aValue === undefined) {
      return 1;
    }

    if (bValue === undefined) {
      return -1;
    }

    if (typeof aValue === "number" && typeof bValue === "number") {
      return (aValue - bValue) * direction;
    }

    return aValue.toString().localeCompare(bValue.toString()) * direction;
  });
}
