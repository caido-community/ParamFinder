import { watchDebounced } from "@vueuse/core";
import { computed } from "vue";

import { useSessionsStore } from "@/features/sessions/stores/sessions.store";

const LOAD_DEBOUNCE_MS = 150;

export function useRequestDetails() {
  const store = useSessionsStore();
  const selectedRequestId = computed(() => store.selectedRequestId);
  const detailState = computed(() =>
    store.getRequestDetailState(selectedRequestId.value),
  );
  const requestResponse = computed(() => detailState.value?.response);
  const errorMessage = computed(() => detailState.value?.error);
  watchDebounced(
    selectedRequestId,
    (requestId) => {
      if (requestId === undefined) return;
      void store.loadRequestDetails(requestId);
    },
    { debounce: LOAD_DEBOUNCE_MS, immediate: true },
  );

  return { requestResponse, errorMessage, selectedRequestId };
}
