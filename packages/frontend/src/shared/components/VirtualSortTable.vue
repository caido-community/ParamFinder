<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import { computed, nextTick, ref, watch } from "vue";

import type { VirtualSortColumn, VirtualSortRow } from "./virtualSortTable";

import EmptyMessage from "@/shared/components/EmptyMessage.vue";
import { useTableSort } from "@/shared/composables/useTableSort";

const ROW_HEIGHT = 30;

const {
  rows,
  columns,
  keyField,
  initialSortColumn = undefined,
  selectedKey = undefined,
  selectionField = undefined,
  serverSide = false,
  loading = false,
} = defineProps<{
  rows: VirtualSortRow[];
  columns: VirtualSortColumn[];
  keyField: string;
  initialSortColumn?: string;
  selectedKey?: string;
  selectionField?: string;
  emptyIcon: string;
  emptyMessage: string;
  serverSide?: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (event: "row-click", mouseEvent: MouseEvent, row: VirtualSortRow): void;
  (event: "sort-change", field: string, direction: "asc" | "desc"): void;
  (event: "load-more"): void;
}>();

const { sortColumn, toggleSort, getSortIcon, sortRows, sortDirection } =
  useTableSort<string>(initialSortColumn);

const sortedRows = computed(() => {
  if (serverSide) {
    return rows;
  }
  const columnByField = new Map(
    columns.map((column) => [column.field, column]),
  );
  return sortRows(rows, (row, column) => {
    const columnDefinition = columnByField.get(column);
    return columnDefinition?.sortValue?.(row) ?? row[column];
  });
});

const changeSort = (field: string) => {
  if (serverSide) {
    const direction =
      sortColumn.value === field && sortDirection.value === "asc"
        ? "desc"
        : "asc";
    sortColumn.value = field;
    sortDirection.value = direction;
    emit("sort-change", field, direction);
  } else {
    toggleSort(field);
  }
};

const onScroll = (event: Event) => {
  if (loading) {
    return;
  }
  const element = event.currentTarget as HTMLElement;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 300) {
    emit("load-more");
  }
};

const columnWidths = computed(() =>
  Object.fromEntries(columns.map((column) => [column.field, column.width])),
);

const tableMinWidth = computed(() =>
  columns.reduce(
    (total, column) => total + Number.parseInt(column.width, 10),
    0,
  ),
);

const rowSelectionField = computed(() => selectionField ?? keyField);

const getRowKey = (row: VirtualSortRow) => String(row[keyField] ?? "");
const getSelectionKey = (row: VirtualSortRow) =>
  String(row[rowSelectionField.value] ?? "");

const getCellText = (row: VirtualSortRow, column: VirtualSortColumn) => {
  return column.format?.(row) ?? String(row[column.field] ?? "");
};

const rowClass = (row: VirtualSortRow, index: number) => {
  const isSelected = selectedKey === getSelectionKey(row);
  return [
    "cursor-pointer text-white/80",
    {
      "bg-highlight": isSelected,
      "bg-surface-800": index % 2 === 0 && !isSelected,
      "bg-surface-900": index % 2 === 1 && !isSelected,
      "hover:bg-surface-700/50": !isSelected,
    },
  ];
};

const scrollParent = ref<HTMLElement | null>(null);

const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: sortedRows.value.length,
    getScrollElement: () => scrollParent.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index: number) => {
      const row = sortedRows.value[index];
      return row === undefined ? index : getRowKey(row);
    },
  })),
);

watch(
  () => sortedRows.value.length,
  async (rowCount, previousRowCount) => {
    if (rowCount <= previousRowCount) {
      return;
    }

    await nextTick();
    rowVirtualizer.value.measure();
  },
);

const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

const virtualRows = computed(() => {
  const items = sortedRows.value;
  return rowVirtualizer.value.getVirtualItems().flatMap((virtualItem) => {
    const row = items[virtualItem.index];
    if (row === undefined) {
      return [];
    }
    return [
      {
        key: String(virtualItem.key),
        index: virtualItem.index,
        start: virtualItem.start,
        size: virtualItem.size,
        row,
      },
    ];
  });
});
</script>

<template>
  <div class="flex flex-1 flex-col min-h-0 overflow-x-auto">
    <div class="table-header-gutter">
      <table
        class="w-full border-spacing-0 border-separate table-fixed"
        :style="{ minWidth: `${tableMinWidth}px` }"
      >
        <thead class="bg-surface-900">
          <tr class="bg-surface-800/50 text-surface-0/50">
            <th
              v-for="column in columns"
              :key="column.field"
              class="font-semibold dark:font-normal leading-[normal] overflow-hidden text-ellipsis whitespace-nowrap text-left border-y-2 border-x-0 border-solid border-surface-900 py-[0.375rem] px-2 cursor-pointer hover:bg-surface-700/50"
              :style="{ width: columnWidths[column.field] }"
              @click="changeSort(column.field)"
            >
              <span class="flex items-center gap-2">
                {{ column.label }}
                <i :class="getSortIcon(column.field)" class="text-xs" />
              </span>
            </th>
          </tr>
        </thead>
      </table>
    </div>

    <div
      v-if="sortedRows.length > 0"
      ref="scrollParent"
      class="table-body-gutter flex-1 min-h-0 overflow-y-auto bg-surface-800"
      :style="{ minWidth: `${tableMinWidth}px` }"
      @scroll.passive="onScroll"
    >
      <div class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="virtualRow in virtualRows"
          :key="virtualRow.key"
          class="absolute top-0 left-0 w-full"
          :style="{
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start}px)`,
          }"
        >
          <table
            class="w-full border-spacing-0 border-separate table-fixed h-[30px]"
            :style="{ minWidth: `${tableMinWidth}px` }"
          >
            <tbody>
              <tr
                :class="rowClass(virtualRow.row, virtualRow.index)"
                @mousedown="emit('row-click', $event, virtualRow.row)"
              >
                <td
                  v-for="column in columns"
                  :key="`${getRowKey(virtualRow.row)}-${column.field}`"
                  class="leading-[normal] overflow-hidden text-ellipsis whitespace-nowrap text-left border-0 py-[0.375rem] px-2"
                  :class="column.cellClass"
                  :style="{ width: columnWidths[column.field] }"
                >
                  {{ getCellText(virtualRow.row, column) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div
        v-if="loading"
        class="sticky bottom-0 py-2 text-center text-xs text-surface-400 bg-surface-900/90"
      >
        <i class="fas fa-spinner fa-spin mr-1" /> Loading more…
      </div>
    </div>

    <EmptyMessage v-else :icon="emptyIcon">
      {{ emptyMessage }}
    </EmptyMessage>
  </div>
</template>

<style scoped>
.table-header-gutter,
.table-body-gutter {
  scrollbar-gutter: stable;
}

.table-header-gutter {
  overflow-y: hidden;
}
</style>
