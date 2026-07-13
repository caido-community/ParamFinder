import type { MenuItem } from "primevue/menuitem";
import type { SessionDescriptor } from "shared";
import { computed, ref } from "vue";

import { useSessionActions } from "@/features/sessions/composables/useSessionActions";
import {
  getSessionCapabilities,
  getSessionStateMeta,
  statusToneClasses,
} from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";

export function useSessionTabs() {
  const store = useSessionsStore();
  const actions = useSessionActions();

  const sessions = computed(() => store.list);
  const contextMenu = ref();
  const contextSessionId = ref<string | undefined>(undefined);

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
        command: () => void actions.deleteSession(id),
      },
      {
        label: "Close others",
        icon: "fas fa-fw fa-trash-can",
        disabled: !hasOtherSessions,
        command: () => void actions.deleteOtherSessions(id),
      },
      {
        label: "Rerun",
        icon: "fas fa-fw fa-redo",
        disabled: !canRerun,
        command: () => void actions.rerunActive(),
      },
    ];
  });

  const select = (id: string) => {
    store.setActiveSession(id);
  };

  const remove = async (event: MouseEvent, id: string) => {
    event.stopPropagation();
    await actions.deleteSession(id);
  };

  const onContextMenu = (event: MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    store.setActiveSession(id);
    contextSessionId.value = id;
    contextMenu.value?.show(event);
  };

  const statusLabel = (session: SessionDescriptor) =>
    getSessionStateMeta(session.state).label;

  const statusDotClasses = (session: SessionDescriptor) => {
    const meta = getSessionStateMeta(session.state);
    const { isRunning } = getSessionCapabilities(session);
    return [statusToneClasses[meta.tone], isRunning ? "animate-pulse" : ""];
  };

  return {
    store,
    sessions,
    contextMenu,
    menuItems,
    select,
    remove,
    onContextMenu,
    statusLabel,
    statusDotClasses,
  };
}
