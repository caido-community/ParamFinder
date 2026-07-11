import { Classic } from "@caido/primevue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import Tooltip from "primevue/tooltip";
import type { ApiResult } from "shared";
import { createApp } from "vue";

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

  setupEvents(sdk);
  setupCommands(sdk);
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

  reportSessionLoad(sessionsStore.initialize());

  const lifecycle = usePageLifecycle();
  let sidebarCount = 0;
  let isOnPage = false;

  sdk.navigation.onPageChange((event) => {
    isOnPage = event.path === "/paramfinder";
  });

  sdk.navigation.addPage("/paramfinder", {
    body: root,
    onEnter: () => {
      isOnPage = true;
      sidebarCount = 0;
      sidebarItem.setCount(sidebarCount);
      lifecycle.triggerPageEnter();
    },
  });

  const sidebarItem = sdk.sidebar.registerItem("Param Finder", "/paramfinder", {
    icon: "fas fa-search",
  });

  const notifiedSessions = new Set<string>();
  sdk.projects.onCurrentProjectChange((event) => {
    sidebarCount = 0;
    notifiedSessions.clear();
    sidebarItem.setCount(sidebarCount);
    reportSessionLoad(sessionsStore.reloadForProject(event.projectId));
  });

  sdk.backend.onEvent("paramfinder:session_change", (envelope) => {
    if (envelope.projectId !== sessionsStore.currentProjectId) {
      return;
    }
    const added = envelope.changes.filter((change) => {
      if (change.type !== "upsert") {
        return false;
      }
      const key = `${change.session.ref.projectId}:${change.session.ref.sessionId}`;
      if (notifiedSessions.has(key)) {
        return false;
      }
      notifiedSessions.add(key);
      return true;
    }).length;
    if (added > 0 && !isOnPage) {
      sidebarCount += added;
      sidebarItem.setCount(sidebarCount);
    }
  });
};
