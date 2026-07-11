import { computed } from "vue";

import {
  type SessionRequestsTab,
  useSessionsStore,
} from "@/features/sessions/stores/sessions.store";

export function useRequestsTab() {
  const store = useSessionsStore();

  const tab = computed({
    get: () => store.requestsTab,
    set: (value: SessionRequestsTab) => {
      store.setRequestsTab(value);
    },
  });

  const tabs: { label: string; value: SessionRequestsTab }[] = [
    { label: "Requests", value: "requests" },
    { label: "Findings", value: "findings" },
  ];

  return { tab, tabs };
}
