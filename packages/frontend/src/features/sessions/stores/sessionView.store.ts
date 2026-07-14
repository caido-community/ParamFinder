import { defineStore } from "pinia";
import type { RequestResponse } from "shared";
import { ref } from "vue";

export type SessionRequestsTab = "requests" | "findings";
export type SessionTabPlacement = "before" | "after";

export type RequestDetailState =
  | { status: "loading" }
  | { status: "success"; response: RequestResponse }
  | { status: "error"; error: string };

export const useSessionViewStore = defineStore("session-view", () => {
  const activeSessionId = ref<string>();
  const selectedRequestId = ref<string>();
  const selectedFindingKey = ref<string>();
  const requestsTab = ref<SessionRequestsTab>("findings");
  const requestDetails = ref<Record<string, RequestDetailState>>({});
  const sessionTabOrder = ref<string[]>([]);

  const clearRequestDetails = () => {
    requestDetails.value = {};
  };

  const setActiveSession = (id: string | undefined) => {
    activeSessionId.value = id;
    selectedRequestId.value = undefined;
    selectedFindingKey.value = undefined;
    clearRequestDetails();
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
    clearRequestDetails();
  };

  const setSelectedFinding = (requestId: string, findingKey: string) => {
    selectedRequestId.value = requestId;
    selectedFindingKey.value = findingKey;
    clearRequestDetails();
  };

  const setRequestsTab = (tab: SessionRequestsTab) => {
    requestsTab.value = tab;
  };

  const openFinding = (requestId: string, findingKey: string) => {
    setRequestsTab("findings");
    setSelectedFinding(requestId, findingKey);
  };

  const getRequestDetailState = (requestId: string | undefined) =>
    requestId === undefined ? undefined : requestDetails.value[requestId];

  const startRequestDetail = (requestId: string) => {
    requestDetails.value[requestId] = { status: "loading" };
  };

  const completeRequestDetail = (
    requestId: string,
    response: RequestResponse,
  ) => {
    requestDetails.value[requestId] = { status: "success", response };
  };

  const failRequestDetail = (requestId: string, error: string) => {
    requestDetails.value[requestId] = { status: "error", error };
  };

  return {
    activeSessionId,
    selectedRequestId,
    selectedFindingKey,
    requestsTab,
    requestDetails,
    sessionTabOrder,
    clearRequestDetails,
    setActiveSession,
    moveSessionTab,
    resetSessionTabOrder,
    setSelectedRequest,
    setSelectedFinding,
    setRequestsTab,
    openFinding,
    getRequestDetailState,
    startRequestDetail,
    completeRequestDetail,
    failRequestDetail,
  };
});
