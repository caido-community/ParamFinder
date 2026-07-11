import { computed } from "vue";

import { useSessionActions } from "@/features/sessions/composables/useSessionActions";
import {
  getSessionCapabilities,
  type SessionCapabilities,
} from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";

type ActionKey = "pause" | "resume" | "rerun" | "cancel" | "delete";

export type ActionButton = {
  key: ActionKey;
  label: string;
  icon: string;
  severity: "secondary" | "info" | "danger";
  handler: () => Promise<void>;
};

export function useActions() {
  const store = useSessionsStore();
  const actions = useSessionActions();

  const session = computed(() => store.activeSession);
  const capabilities = computed(() => getSessionCapabilities(session.value));
  const controlsDisabled = computed(
    () => store.activeActionLoading !== undefined,
  );

  const deleteActive = async () => {
    const current = session.value;
    if (current !== undefined) {
      await actions.deleteSession(current.id);
    }
  };

  const buttons = computed<ActionButton[]>(() =>
    buildButtons(capabilities.value, actions, deleteActive),
  );

  return {
    activeActionLoading: computed(() => store.activeActionLoading),
    controlsDisabled,
    buttons,
  };
}

function buildButtons(
  capabilities: SessionCapabilities,
  actions: ReturnType<typeof useSessionActions>,
  deleteActive: () => Promise<void>,
): ActionButton[] {
  const candidates: (ActionButton & { show: boolean })[] = [
    {
      show: capabilities.isRunning,
      key: "pause",
      label: "Pause",
      icon: "fas fa-pause",
      severity: "secondary",
      handler: actions.pauseActive,
    },
    {
      show: capabilities.isPaused,
      key: "resume",
      label: "Resume",
      icon: "fas fa-play",
      severity: "info",
      handler: actions.resumeActive,
    },
    {
      show: capabilities.canRerun,
      key: "rerun",
      label: "Rerun",
      icon: "fas fa-redo",
      severity: "info",
      handler: actions.rerunActive,
    },
    {
      show: capabilities.canCancel,
      key: "cancel",
      label: "Cancel",
      icon: "fas fa-stop",
      severity: "danger",
      handler: actions.cancelActive,
    },
    {
      show: true,
      key: "delete",
      label: "Delete",
      icon: "fas fa-trash",
      severity: "danger",
      handler: deleteActive,
    },
  ];

  return candidates.filter((button) => button.show);
}
