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

export function useRequestList() {
  const sessionsStore = useSessionsStore();
  const viewStore = useSessionViewStore();
  const { selectedRequestId } = storeToRefs(viewStore);

  const requests = computed(() =>
    createRequestRows(sessionsStore.activeSession),
  );
  const loading = computed(
    () => sessionsStore.activeEntryState("request")?.loading ?? false,
  );

  const columns: VirtualSortColumn<RequestRow>[] = [
    { field: "requestId", label: "ID", width: "64px", cellClass: "font-mono" },
    { field: "status", label: "Status", width: "76px" },
    { field: "length", label: "Length", width: "88px" },
    {
      field: "time",
      label: "Time",
      width: "84px",
      format: (row) => `${row.time}ms`,
    },
    { field: "parametersTested", label: "Parameters", width: "104px" },
    { field: "context", label: "Context", width: "96px" },
  ];

  const onRowClick = (event: MouseEvent, row: RequestRow) => {
    if (event.button !== 0) {
      return;
    }

    const requestId = row.requestId;
    if (selectedRequestId.value === requestId) {
      viewStore.setSelectedRequest(undefined);
    } else {
      viewStore.setSelectedRequest(requestId);
    }
  };

  const fieldMap: Record<keyof RequestRow, SessionEntrySort["field"]> = {
    requestId: "requestId",
    status: "responseStatus",
    length: "responseLength",
    time: "responseTime",
    parametersTested: "parametersTested",
    context: "context",
  };

  const sort = (field: keyof RequestRow, direction: "asc" | "desc") => {
    void sessionsStore.loadEntries("request", {
      reset: true,
      sort: { field: fieldMap[field], direction },
    });
  };

  const loadMore = () => void sessionsStore.loadEntries("request");

  return {
    selectedRequestId,
    requests,
    columns,
    loading,
    onRowClick,
    sort,
    loadMore,
  };
}
