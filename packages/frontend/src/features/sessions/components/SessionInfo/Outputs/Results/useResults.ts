import { useClipboard } from "@vueuse/core";
import type { Sequenced, SessionFinding } from "shared";
import { computed } from "vue";

import { getFindingKey } from "@/features/sessions/lib/sessionRows";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useSDK } from "@/plugins/sdk";
import { useDownloadText } from "@/shared/composables/useDownloadText";
import { toErrorMessage } from "@/shared/utils/backend";

export function useResults() {
  const sdk = useSDK();
  const store = useSessionsStore();

  const findings = computed(() => store.activeSession?.findings ?? []);
  const findingCount = computed(
    () => store.activeDescriptor?.findingsCount ?? 0,
  );
  const canLoadMore = computed(
    () => store.activeEntryState("finding")?.nextCursor !== undefined,
  );
  const { copy: copyText } = useClipboard();
  const { downloadText } = useDownloadText("paramfinder-findings.txt");

  const copy = async () => {
    if (findingCount.value === 0) {
      return;
    }

    try {
      const result = await store.exportEntries("finding");
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await copyText(
        result.value.map((finding) => finding.parameter.name).join("\n"),
      );
      sdk.window.showToast(
        `Copied ${result.value.length} parameter(s) to clipboard`,
        { variant: "success" },
      );
    } catch (err: unknown) {
      sdk.window.showToast(`Failed to copy findings: ${toErrorMessage(err)}`, {
        variant: "error",
        duration: 10_000,
      });
    }
  };

  const download = async () => {
    if (findingCount.value === 0) {
      return;
    }

    const result = await store.exportEntries("finding");
    if (!result.success) {
      sdk.window.showToast(
        `Failed to export findings: ${result.error.message}`,
        {
          variant: "error",
          duration: 10_000,
        },
      );
      return;
    }
    downloadText(
      result.value.map((finding) => finding.parameter.name).join("\n"),
    );
  };

  const loadMore = () => void store.loadEntries("finding");

  const openFinding = (finding: Sequenced<SessionFinding>) => {
    store.openFinding(finding.requestId, getFindingKey(finding));
  };

  return {
    store,
    findings,
    findingCount,
    canLoadMore,
    getFindingKey,
    copy,
    download,
    openFinding,
    loadMore,
  };
}
