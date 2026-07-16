<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { SessionEntrySort } from "shared";
import { computed } from "vue";

import {
  createRequestRows,
  type RequestRow,
} from "@/features/sessions/lib/sessionRows";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useSessionViewStore } from "@/features/sessions/stores/sessionView.store";
import type { VirtualSortColumn } from "@/shared/components/virtualSortTable";
import VirtualSortTable from "@/shared/components/VirtualSortTable.vue";

defineOptions({ name: "RequestList" });

const sessionsStore = useSessionsStore();
const viewStore = useSessionViewStore();
const { selectedRequestId } = storeToRefs(viewStore);

const requests = computed(() => createRequestRows(sessionsStore.activeSession));
const loading = computed(
  () => sessionsStore.activeEntryState("request")?.loading ?? false,
);

const columns: VirtualSortColumn<RequestRow>[] = [
  { field: "requestId", label: "ID", width: 64, cellClass: "font-mono" },
  { field: "status", label: "Status", width: 76 },
  { field: "length", label: "Length", width: 88 },
  {
    field: "time",
    label: "Time",
    width: 84,
    format: (row) => `${row.time}ms`,
  },
  { field: "parametersTested", label: "Parameters", width: 104 },
  { field: "context", label: "Context", width: 96 },
];

const onRowClick = (event: MouseEvent, row: RequestRow) => {
  if (event.button !== 0) return;

  viewStore.setSelectedRequest(
    selectedRequestId.value === row.requestId ? undefined : row.requestId,
  );
};

const sortFields: Record<keyof RequestRow, SessionEntrySort["field"]> = {
  requestId: "requestId",
  status: "responseStatus",
  length: "responseLength",
  time: "responseTime",
  parametersTested: "parametersTested",
  context: "context",
};

const sort = (field: keyof RequestRow, direction: "asc" | "desc") =>
  sessionsStore.loadEntries("request", {
    reset: true,
    sort: { field: sortFields[field], direction },
  });

const loadMore = () => sessionsStore.loadEntries("request");
</script>

<template>
  <VirtualSortTable
    :rows="requests"
    :columns="columns"
    key-field="requestId"
    :selected-key="selectedRequestId"
    empty-icon="fas fa-inbox"
    empty-message="No requests recorded yet."
    :loading="loading"
    @row-click="onRowClick"
    @sort-change="sort"
    @load-more="loadMore"
  />
</template>
