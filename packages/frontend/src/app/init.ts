import { Classic } from "@caido/primevue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import Tooltip from "primevue/tooltip";
import type { ApiResult, SessionChangeEnvelope } from "shared";
import { createApp, watch } from "vue";

import App from "./App.vue";

import { setupCommands } from "@/commands/setupCommands";
import { setupEvents } from "@/events/setupEvents";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { usePageLifecycle } from "@/plugins/lifecycle";
import { SDKPlugin } from "@/plugins/sdk";
import { toErrorMessage } from "@/shared/utils/backend";
import "@/styles/index.css";
import type { FrontendSDK } from "@/types";

export const init = (sdk: FrontendSDK) => {
  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(PrimeVue, {
    unstyled: true,
    pt: Classic,
  });
  app.use(ConfirmationService);
  app.directive("tooltip", Tooltip);
  app.use(SDKPlugin, sdk);

  const root = document.createElement("div");
  Object.assign(root.style, {
    height: "100%",
    width: "100%",
  });
  root.id = "plugin--paramfinder-plugin";

  app.mount(root);

  const sessionsStore = useSessionsStore();

  const reportSessionLoad = (load: Promise<ApiResult<void>>) => {
    load
      .then((result) => {
        if (!result.success) {
          sdk.window.showToast(
            `Failed to load sessions: ${result.error.message}`,
            {
              variant: "error",
              duration: 10_000,
            },
          );
        }
      })
      .catch((err: unknown) => {
        sdk.window.showToast(
          `Failed to load sessions: ${toErrorMessage(err)}`,
          {
            variant: "error",
            duration: 10_000,
          },
        );
      });
  };

  const lifecycle = usePageLifecycle();
  let sidebarCount = 0;

  const sidebarItem = sdk.sidebar.registerItem("Param Finder", "/paramfinder", {
    icon: "fas fa-search",
  });

  const notifiedSessions = new Set<string>();
  let pendingNotificationEnvelopes: SessionChangeEnvelope[] = [];

  const countNewSessions = (envelope: SessionChangeEnvelope) => {
    if (envelope.projectId !== sessionsStore.currentProjectId) return;

    const added = envelope.changes.filter((change) => {
      if (change.type !== "upsert") return false;
      const key = `${change.session.ref.projectId}:${change.session.ref.sessionId}`;
      if (notifiedSessions.has(key)) return false;
      notifiedSessions.add(key);
      return true;
    }).length;

    if (added > 0 && location.hash !== "#/paramfinder") {
      sidebarCount += added;
      sidebarItem.setCount(sidebarCount);
    }
  };

  const flushSessionNotifications = () => {
    const pending = pendingNotificationEnvelopes;
    pendingNotificationEnvelopes = [];
    for (const envelope of pending) {
      countNewSessions(envelope);
    }
  };

  watch(
    () => sessionsStore.hydrated,
    (hydrated) => {
      if (hydrated) flushSessionNotifications();
    },
  );

  setupEvents(sdk, (envelope) => {
    if (!sessionsStore.hydrated) {
      pendingNotificationEnvelopes.push(envelope);
      return;
    }
    countNewSessions(envelope);
  });
  setupCommands(sdk);
  const initialize = sessionsStore.initialize();
  reportSessionLoad(initialize);
  void initialize.then((result) => {
    if (result.success) flushSessionNotifications();
  });

  sdk.navigation.addPage("/paramfinder", {
    body: root,
    onEnter: () => {
      sidebarCount = 0;
      sidebarItem.setCount(sidebarCount);
      lifecycle.triggerPageEnter();
    },
  });

  sdk.projects.onCurrentProjectChange((event) => {
    sidebarCount = 0;
    notifiedSessions.clear();
    pendingNotificationEnvelopes = [];
    sidebarItem.setCount(sidebarCount);
    const reload = sessionsStore.reloadForProject(event.projectId);
    reportSessionLoad(reload);
    void reload.then((result) => {
      if (result.success) flushSessionNotifications();
    });
  });
};
