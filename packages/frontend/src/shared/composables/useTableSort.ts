import { computed, ref } from "vue";

import {
  createInitialSortState,
  getSortIcon as getSortIconForState,
  nextSortState,
  type SortDirection,
  sortRows as sortRowsForState,
  type SortValue,
} from "@/shared/utils/tableSort";

export type { SortDirection };

export const useTableSort = <T extends string>(initialColumn?: T) => {
  const initialState = createInitialSortState(initialColumn);
  const sortColumn = ref<T | undefined>(initialState.column);
  const sortDirection = ref<SortDirection>(initialState.direction);
  const sortState = computed(() => ({
    column: sortColumn.value,
    direction: sortDirection.value,
  }));

  const toggleSort = (column: T) => {
    const next = nextSortState(sortState.value, column);
    sortColumn.value = next.column;
    sortDirection.value = next.direction;
  };

  const getSortIcon = (column: T) => {
    return getSortIconForState(sortState.value, column);
  };

  const sortRows = <Row>(
    rows: Row[],
    getValue: (row: Row, column: T) => SortValue,
  ): Row[] => {
    return sortRowsForState(rows, sortState.value, getValue);
  };

  return {
    sortColumn,
    sortDirection,
    toggleSort,
    getSortIcon,
    sortRows,
  };
};
