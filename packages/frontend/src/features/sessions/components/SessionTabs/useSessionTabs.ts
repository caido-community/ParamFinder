import { storeToRefs } from "pinia";
import type { MenuItem } from "primevue/menuitem";
import type { ApiResult, SessionDescriptor } from "shared";
import { computed, ref } from "vue";

import {
  findSessionTabDropTarget,
  type SessionTabBounds,
  type SessionTabDropTarget,
} from "./sessionTabDrag";

import {
  getSessionCapabilities,
  getSessionStateMeta,
  getSessionStateTitle,
  statusToneClasses,
} from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useSessionViewStore } from "@/features/sessions/stores/sessionView.store";
import { useActionResult } from "@/shared/composables/useActionResult";

export function useSessionTabs() {
  const store = useSessionsStore();
  const viewStore = useSessionViewStore();
  const { activeSessionId } = storeToRefs(viewStore);
  const { showResult } = useActionResult();

  const sessions = computed(() => store.list);
  const contextMenu = ref();
  const contextSessionId = ref<string | undefined>(undefined);
  const draggedSessionId = ref<string>();
  const dropTarget = ref<SessionTabDropTarget>();

  const execute = async (result: Promise<ApiResult<void>>) => {
    showResult(await result);
  };

  const menuItems = computed((): MenuItem[] => {
    const id = contextSessionId.value;
    if (id === undefined) {
      return [];
    }

    const hasOtherSessions = store.list.some(
      (session) => session.ref.sessionId !== id,
    );
    const session = store.list.find(
      (candidate) => candidate.ref.sessionId === id,
    );
    const { canRerun } = getSessionCapabilities(session);

    return [
      {
        label: "Close",
        icon: "fas fa-fw fa-times",
        command: () => execute(store.deleteSession(id)),
      },
      {
        label: "Close others",
        icon: "fas fa-fw fa-trash-can",
        disabled: !hasOtherSessions,
        command: () => execute(store.deleteOtherSessions(id)),
      },
      {
        label: "Rerun",
        icon: "fas fa-fw fa-redo",
        disabled: !canRerun,
        command: () => execute(store.rerunActive()),
      },
    ];
  });

  const select = (id: string) => {
    store.setActiveSession(id);
  };

  const remove = async (event: MouseEvent, id: string) => {
    event.stopPropagation();
    await execute(store.deleteSession(id));
  };

  const onContextMenu = (event: MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    store.setActiveSession(id);
    contextSessionId.value = id;
    contextMenu.value?.show(event);
  };

  const onDragStart = (event: DragEvent, id: string) => {
    if ((event.target as Element | null)?.closest("button")) {
      event.preventDefault();
      return;
    }

    draggedSessionId.value = id;
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  };

  const onDragOver = (event: DragEvent) => {
    const sourceId = draggedSessionId.value;
    if (sourceId === undefined) return;

    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = "move";
    }
    const tabBar = event.currentTarget as HTMLElement;
    const tabs = Array.from(
      tabBar.querySelectorAll<HTMLElement>("[data-session-tab-id]"),
    ).flatMap((tab): SessionTabBounds[] => {
      const sessionId = tab.dataset.sessionTabId;
      if (sessionId === undefined) return [];
      const { left, right, top, bottom } = tab.getBoundingClientRect();
      return [{ sessionId, left, right, top, bottom }];
    });
    dropTarget.value = findSessionTabDropTarget(tabs, sourceId, {
      x: event.clientX,
      y: event.clientY,
    });
  };

  const onDragLeave = (event: DragEvent) => {
    const tabBar = event.currentTarget as HTMLElement;
    if (
      event.relatedTarget instanceof Node &&
      tabBar.contains(event.relatedTarget)
    ) {
      return;
    }
    dropTarget.value = undefined;
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const sourceId = draggedSessionId.value;
    const target = dropTarget.value;
    if (sourceId !== undefined && target !== undefined) {
      viewStore.moveSessionTab(
        sessions.value.map((session) => session.ref.sessionId),
        sourceId,
        target.sessionId,
        target.kind,
      );
    }
    draggedSessionId.value = undefined;
    dropTarget.value = undefined;
  };

  const onDragEnd = () => {
    draggedSessionId.value = undefined;
    dropTarget.value = undefined;
  };

  const statusLabel = (session: SessionDescriptor) =>
    getSessionStateMeta(session.state).label;

  const statusDotClasses = (session: SessionDescriptor) => {
    const meta = getSessionStateMeta(session.state);
    const { isRunning } = getSessionCapabilities(session);
    return [statusToneClasses[meta.tone], isRunning ? "animate-pulse" : ""];
  };

  return {
    activeSessionId,
    sessions,
    contextMenu,
    menuItems,
    draggedSessionId,
    dropTarget,
    select,
    remove,
    onContextMenu,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    statusLabel,
    statusTitle: getSessionStateTitle,
    statusDotClasses,
  };
}
