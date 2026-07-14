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

export function useFindingsList() {
  const sessionsStore = useSessionsStore();
  const viewStore = useSessionViewStore();
  const { selectedFindingKey } = storeToRefs(viewStore);

  const findings = computed(() =>
    createFindingRows(sessionsStore.activeSession),
  );
  const loading = computed(
    () => sessionsStore.activeEntryState("finding")?.loading ?? false,
  );

  const columns: VirtualSortColumn<FindingRow>[] = [
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
      format: (row) => row.requestId || "-",
    },
    { field: "status", label: "Status", width: "80px" },
    { field: "length", label: "Length", width: "100px" },
  ];

  const onRowClick = (event: MouseEvent, row: FindingRow) => {
    if (event.button !== 0) {
      return;
    }

    const { requestId, key: findingKey } = row;
    if (requestId === "" || findingKey === "") {
      return;
    }

    if (selectedFindingKey.value === findingKey) {
      viewStore.setSelectedRequest(undefined);
    } else {
      viewStore.setSelectedFinding(requestId, findingKey);
    }
  };

  const fieldMap: Record<keyof FindingRow, SessionEntrySort["field"]> = {
    key: "sequence",
    parameter: "parameter",
    anomaly: "anomaly",
    requestId: "requestId",
    status: "responseStatus",
    length: "responseLength",
  };

  const sort = (field: keyof FindingRow, direction: "asc" | "desc") => {
    void sessionsStore.loadEntries("finding", {
      reset: true,
      sort: { field: fieldMap[field], direction },
    });
  };

  const loadMore = () => void sessionsStore.loadEntries("finding");

  return {
    selectedFindingKey,
    findings,
    columns,
    loading,
    onRowClick,
    sort,
    loadMore,
  };
}
