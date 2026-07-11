import { useScroll } from "@vueuse/core";
import { computed, nextTick, ref, watch } from "vue";

import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useSDK } from "@/plugins/sdk";
import { useCopyText } from "@/shared/composables/useCopyText";
import { toErrorMessage } from "@/shared/utils/backend";

export function useLogs() {
  const sdk = useSDK();
  const store = useSessionsStore();

  const logs = computed(() => store.activeSession?.logs ?? []);
  const logCount = computed(() => store.activeDescriptor?.logsCount ?? 0);
  const canLoadMore = computed(
    () => store.activeEntryState("log")?.nextCursor !== undefined,
  );
  const scrollRef = ref<HTMLElement>();
  const { arrivedState } = useScroll(scrollRef, { offset: { bottom: 4 } });
  const { copyText } = useCopyText();

  watch(
    () => logs.value.length,
    async () => {
      if (!arrivedState.bottom) {
        return;
      }

      await nextTick();
      const element = scrollRef.value;
      if (element !== undefined) {
        element.scrollTop = element.scrollHeight;
      }
    },
  );

  const copy = async () => {
    if (logCount.value === 0) {
      return;
    }

    try {
      const result = await store.exportEntries("log");
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await copyText(result.value.join("\n"));
      sdk.window.showToast(
        `Copied ${result.value.length} log line(s) to clipboard`,
        { variant: "success" },
      );
    } catch (err: unknown) {
      sdk.window.showToast(`Failed to copy logs: ${toErrorMessage(err)}`, {
        variant: "error",
        duration: 10_000,
      });
    }
  };

  const loadMore = () => void store.loadEntries("log");

  return {
    logs,
    logCount,
    canLoadMore,
    scrollRef,
    copy,
    loadMore,
  };
}
