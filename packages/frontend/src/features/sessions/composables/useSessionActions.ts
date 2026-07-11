import { useSessionsStore } from "../stores/sessions.store";

import { useActionResult } from "@/shared/composables/useActionResult";

export function useSessionActions() {
  const sessionsStore = useSessionsStore();
  const { showResult } = useActionResult();

  async function pauseActive() {
    showResult(await sessionsStore.pauseActive(), {
      successMessage: "Session paused.",
    });
  }

  async function resumeActive() {
    showResult(await sessionsStore.resumeActive(), {
      successMessage: "Session resumed.",
    });
  }

  async function cancelActive() {
    showResult(await sessionsStore.cancelActive(), {
      successMessage: "Session canceled.",
    });
  }

  async function rerunActive() {
    showResult(await sessionsStore.rerunActive(), {
      successMessage: "Session rerun started.",
    });
  }

  async function deleteSession(
    id: string,
    successMessage = "Session deleted.",
  ) {
    showResult(await sessionsStore.deleteSession(id), { successMessage });
  }

  async function deleteOtherSessions(id: string) {
    showResult(await sessionsStore.deleteOtherSessions(id), {
      successMessage: "Other sessions closed.",
    });
  }

  return {
    pauseActive,
    resumeActive,
    cancelActive,
    rerunActive,
    deleteSession,
    deleteOtherSessions,
  };
}
