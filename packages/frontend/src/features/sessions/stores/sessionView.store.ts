import { defineStore } from "pinia";
import type { RequestResponse } from "shared";
import { ref } from "vue";

export type SessionRequestsTab = "requests" | "findings";
export type SessionTabPlacement = "before" | "after";

export type RequestDetailState =
  | { kind: "idle" }
  | { kind: "loading"; requestId: string }
  | { kind: "success"; requestId: string; response: RequestResponse }
  | { kind: "error"; requestId: string; error: string };

export const useSessionViewStore = defineStore("session-view", () => {
  const activeSessionId = ref<string>();
  const selectedRequestId = ref<string>();
  const selectedFindingKey = ref<string>();
  const requestsTab = ref<SessionRequestsTab>("findings");
  const requestDetail = ref<RequestDetailState>({ kind: "idle" });
  const sessionTabOrder = ref<string[]>([]);

  const clearRequestDetail = () => {
    requestDetail.value = { kind: "idle" };
  };

  const setActiveSession = (id: string | undefined) => {
    activeSessionId.value = id;
    selectedRequestId.value = undefined;
    selectedFindingKey.value = undefined;
    clearRequestDetail();
  };

  const moveSessionTab = (
    sessionIds: string[],
    sourceId: string,
    targetId: string,
    placement: SessionTabPlacement,
  ) => {
    if (sourceId === targetId || !sessionIds.includes(sourceId)) {
      return;
    }

    const nextOrder = sessionIds.filter((id) => id !== sourceId);
    const targetIndex = nextOrder.indexOf(targetId);
    if (targetIndex === -1) {
      return;
    }

    const insertionIndex =
      placement === "after" ? targetIndex + 1 : targetIndex;
    nextOrder.splice(insertionIndex, 0, sourceId);
    sessionTabOrder.value = nextOrder;
  };

  const resetSessionTabOrder = () => {
    sessionTabOrder.value = [];
  };

  const setSelectedRequest = (id: string | undefined) => {
    selectedRequestId.value = id;
    selectedFindingKey.value = undefined;
    clearRequestDetail();
  };

  const setSelectedFinding = (requestId: string, findingKey: string) => {
    selectedRequestId.value = requestId;
    selectedFindingKey.value = findingKey;
    clearRequestDetail();
  };

  const setRequestsTab = (tab: SessionRequestsTab) => {
    requestsTab.value = tab;
  };

  const openFinding = (requestId: string, findingKey: string) => {
    setRequestsTab("findings");
    setSelectedFinding(requestId, findingKey);
  };

  const startRequestDetail = (requestId: string) => {
    requestDetail.value = { kind: "loading", requestId };
  };

  const completeRequestDetail = (
    requestId: string,
    response: RequestResponse,
  ) => {
    requestDetail.value = { kind: "success", requestId, response };
  };

  const failRequestDetail = (requestId: string, error: string) => {
    requestDetail.value = { kind: "error", requestId, error };
  };

  return {
    activeSessionId,
    selectedRequestId,
    selectedFindingKey,
    requestsTab,
    requestDetail,
    sessionTabOrder,
    clearRequestDetail,
    setActiveSession,
    moveSessionTab,
    resetSessionTabOrder,
    setSelectedRequest,
    setSelectedFinding,
    setRequestsTab,
    openFinding,
    startRequestDetail,
    completeRequestDetail,
    failRequestDetail,
  };
});
