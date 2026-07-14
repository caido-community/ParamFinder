import { type ApiResult, ok } from "shared";
import { computed } from "vue";

import {
  getSessionCapabilities,
  type SessionCapabilities,
} from "@/features/sessions/lib/sessionStats";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { useActionResult } from "@/shared/composables/useActionResult";

type ActionKey = "pause" | "resume" | "rerun" | "cancel" | "delete";

export type ActionButton = {
  key: ActionKey;
  label: string;
  icon: string;
  severity: "secondary" | "info" | "danger";
  handler: () => Promise<ApiResult<void>>;
};

type ActionHandlers = Record<ActionKey, ActionButton["handler"]>;

export function useActions() {
  const store = useSessionsStore();
  const { showResult } = useActionResult();

  const session = computed(() => store.activeSession);
  const capabilities = computed(() => getSessionCapabilities(session.value));
  const controlsDisabled = computed(
    () => store.activeActionLoading !== undefined,
  );

  const deleteActive = () => {
    const current = session.value;
    return current === undefined
      ? Promise.resolve(ok(undefined))
      : store.deleteSession(current.id);
  };

  const handlers: ActionHandlers = {
    pause: store.pauseActive,
    resume: store.resumeActive,
    rerun: store.rerunActive,
    cancel: store.cancelActive,
    delete: deleteActive,
  };

  const buttons = computed<ActionButton[]>(() =>
    buildButtons(capabilities.value, handlers),
  );

  const execute = async (button: ActionButton) => {
    showResult(await button.handler());
  };

  return {
    activeActionLoading: computed(() => store.activeActionLoading),
    controlsDisabled,
    buttons,
    execute,
  };
}

function buildButtons(
  capabilities: SessionCapabilities,
  handlers: ActionHandlers,
): ActionButton[] {
  const candidates: (ActionButton & { show: boolean })[] = [
    {
      show: capabilities.isRunning,
      key: "pause",
      label: "Pause",
      icon: "fas fa-pause",
      severity: "secondary",
      handler: handlers.pause,
    },
    {
      show: capabilities.isPaused,
      key: "resume",
      label: "Resume",
      icon: "fas fa-play",
      severity: "info",
      handler: handlers.resume,
    },
    {
      show: capabilities.canRerun,
      key: "rerun",
      label: "Rerun",
      icon: "fas fa-redo",
      severity: "info",
      handler: handlers.rerun,
    },
    {
      show: capabilities.canCancel,
      key: "cancel",
      label: "Cancel",
      icon: "fas fa-stop",
      severity: "danger",
      handler: handlers.cancel,
    },
    {
      show: true,
      key: "delete",
      label: "Delete",
      icon: "fas fa-trash",
      severity: "danger",
      handler: handlers.delete,
    },
  ];

  return candidates.filter((button) => button.show);
}
