<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { SessionEntrySort } from "shared";
import { computed } from "vue";

import {
  createFindingRows,
  type FindingRow,
} from "@/features/sessions/lib/sessionRows";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useSessionViewStore } from "@/features/sessions/stores/sessionView.store";
import type { VirtualSortColumn } from "@/shared/components/virtualSortTable";
import VirtualSortTable from "@/shared/components/VirtualSortTable.vue";

defineOptions({ name: "FindingsList" });

const sessionsStore = useSessionsStore();
const viewStore = useSessionViewStore();
const { selectedFindingKey } = storeToRefs(viewStore);

const findings = computed(() => createFindingRows(sessionsStore.activeSession));
const loading = computed(
  () => sessionsStore.activeEntryState("finding")?.loading ?? false,
);

const columns: VirtualSortColumn<FindingRow>[] = [
  {
    field: "parameter",
    label: "Parameter",
    width: 160,
    cellClass: "font-mono",
  },
  { field: "anomaly", label: "Anomaly", width: 140 },
  {
    field: "requestId",
    label: "Request ID",
    width: 120,
    cellClass: "font-mono",
    format: (row) => row.requestId || "-",
  },
  { field: "status", label: "Status", width: 80 },
  { field: "length", label: "Length", width: 100 },
];

const onRowClick = (event: MouseEvent, row: FindingRow) => {
  if (event.button !== 0 || row.requestId === "" || row.key === "") return;

  if (selectedFindingKey.value === row.key) {
    viewStore.setSelectedRequest(undefined);
  } else {
    viewStore.setSelectedFinding(row.requestId, row.key);
  }
};

const sortFields: Record<keyof FindingRow, SessionEntrySort["field"]> = {
  key: "sequence",
  parameter: "parameter",
  anomaly: "anomaly",
  requestId: "requestId",
  status: "responseStatus",
  length: "responseLength",
};

const sort = (field: keyof FindingRow, direction: "asc" | "desc") =>
  sessionsStore.loadEntries("finding", {
    reset: true,
    sort: { field: sortFields[field], direction },
  });

const loadMore = () => sessionsStore.loadEntries("finding");
</script>

<template>
  <VirtualSortTable
    :rows="findings"
    :columns="columns"
    key-field="key"
    :selected-key="selectedFindingKey"
    empty-icon="fas fa-bug"
    empty-message="No findings yet."
    :loading="loading"
    @row-click="onRowClick"
    @sort-change="sort"
    @load-more="loadMore"
  />
</template>
