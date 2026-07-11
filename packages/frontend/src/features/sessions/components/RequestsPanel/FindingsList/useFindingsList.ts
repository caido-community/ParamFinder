import type { SessionEntrySort } from "shared";
import { computed } from "vue";

import { createFindingRows } from "@/features/sessions/lib/sessionRows";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import type {
  VirtualSortColumn,
  VirtualSortRow,
} from "@/shared/components/virtualSortTable";

export function useFindingsList() {
  const store = useSessionsStore();

  const findings = computed(() => createFindingRows(store.activeSession));
  const loading = computed(
    () => store.activeEntryState("finding")?.loading ?? false,
  );

  const columns: VirtualSortColumn[] = [
    {
      field: "parameter",
      label: "Parameter",
      width: "160px",
      cellClass: "font-mono",
    },
    { field: "anomaly", label: "Anomaly", width: "140px" },
    {
      field: "requestId",
      label: "Request ID",
      width: "120px",
      cellClass: "font-mono",
      format: (row) => String(row.requestId ?? "") || "-",
    },
    { field: "status", label: "Status", width: "80px" },
    { field: "length", label: "Length", width: "100px" },
  ];

  const onRowClick = (event: MouseEvent, row: VirtualSortRow) => {
    if (event.button !== 0) {
      return;
    }

    const requestId = String(row.requestId ?? "");
    const findingKey = String(row.key ?? "");
    if (requestId === "" || findingKey === "") {
      return;
    }

    if (store.selectedFindingKey === findingKey) {
      store.setSelectedRequest(undefined);
    } else {
      store.setSelectedFinding(requestId, findingKey);
    }
  };

  const fieldMap: Record<string, SessionEntrySort["field"]> = {
    parameter: "parameter",
    anomaly: "anomaly",
    requestId: "requestId",
    status: "responseStatus",
    length: "responseLength",
  };

  const sort = (field: string, direction: "asc" | "desc") => {
    void store.loadEntries("finding", {
      reset: true,
      sort: { field: fieldMap[field] ?? "sequence", direction },
    });
  };

  const loadMore = () => void store.loadEntries("finding");

  return { store, findings, columns, loading, onRowClick, sort, loadMore };
}
