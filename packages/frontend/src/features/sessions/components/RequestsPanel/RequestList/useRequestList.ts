import type { SessionEntrySort } from "shared";
import { computed } from "vue";

import { createRequestRows } from "@/features/sessions/lib/sessionRows";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import type {
  VirtualSortColumn,
  VirtualSortRow,
} from "@/shared/components/virtualSortTable";

export function useRequestList() {
  const store = useSessionsStore();

  const requests = computed(() => createRequestRows(store.activeSession));
  const loading = computed(
    () => store.activeEntryState("request")?.loading ?? false,
  );

  const columns: VirtualSortColumn[] = [
    { field: "requestId", label: "ID", width: "64px", cellClass: "font-mono" },
    { field: "status", label: "Status", width: "76px" },
    { field: "length", label: "Length", width: "88px" },
    {
      field: "time",
      label: "Time",
      width: "84px",
      format: (row) => `${row.time ?? ""}ms`,
    },
    { field: "parametersTested", label: "Parameters", width: "104px" },
    { field: "context", label: "Context", width: "96px" },
  ];

  const onRowClick = (event: MouseEvent, row: VirtualSortRow) => {
    if (event.button !== 0) {
      return;
    }

    const requestId = String(row.requestId ?? "");
    if (store.selectedRequestId === requestId) {
      store.setSelectedRequest(undefined);
    } else {
      store.setSelectedRequest(requestId);
    }
  };

  const fieldMap: Record<string, SessionEntrySort["field"]> = {
    requestId: "requestId",
    status: "responseStatus",
    length: "responseLength",
    time: "responseTime",
    parametersTested: "parametersTested",
    context: "context",
  };

  const sort = (field: string, direction: "asc" | "desc") => {
    void store.loadEntries("request", {
      reset: true,
      sort: { field: fieldMap[field] ?? "sequence", direction },
    });
  };

  const loadMore = () => void store.loadEntries("request");

  return { store, requests, columns, loading, onRowClick, sort, loadMore };
}
