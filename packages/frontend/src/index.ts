import { Classic } from "@caido/primevue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import Tooltip from "primevue/tooltip";
import type { ApiResult, SessionChangeEnvelope } from "shared";
import { createApp, watch } from "vue";

import App from "@/app/App.vue";
import { runAdvancedScan, runScan } from "@/commands/scan";
import { useSessionsStore } from "@/features/sessions/stores/sessions.store";
import { triggerPageEnter } from "@/plugins/lifecycle";
import { SDKPlugin } from "@/plugins/sdk";
import { attackTypes } from "@/shared/constants/attackTypes";
import { toErrorMessage } from "@/shared/utils/backend";
import "@/styles/index.css";
import type { FrontendSDK } from "@/types";

const requestMenuTypes = ["RequestRow", "Request"] as const;
const advancedScanCommandId = "paramfinder:advanced-scan";

function registerRequestMenuItems(sdk: FrontendSDK, commandId: string) {
  for (const type of requestMenuTypes) {
    sdk.menu.registerItem({
      type,
      commandId,
      leadingIcon: "fas fa-search",
    });
  }
}

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
  const sidebarItem = sdk.sidebar.registerItem("Param Finder", "/paramfinder", {
    icon: "fas fa-search",
  });
  let sidebarCount = 0;
  const notifiedSessions = new Set<string>();
  let pendingNotificationEnvelopes: SessionChangeEnvelope[] = [];

  const clearSidebarCount = () => {
    sidebarCount = 0;
    sidebarItem.setCount(0);
  };

  const resetSessionNotifications = () => {
    clearSidebarCount();
    notifiedSessions.clear();
    pendingNotificationEnvelopes = [];
  };

  const countNewSessions = (envelope: SessionChangeEnvelope) => {
    if (envelope.projectId !== sessionsStore.currentProjectId) return;

    let added = 0;
    for (const change of envelope.changes) {
      if (change.type !== "upsert") continue;

      const key = `${change.session.ref.projectId}:${change.session.ref.sessionId}`;
      if (notifiedSessions.has(key)) continue;

      notifiedSessions.add(key);
      added += 1;
    }

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
      .catch((error: unknown) => {
        sdk.window.showToast(
          `Failed to load sessions: ${toErrorMessage(error)}`,
          {
            variant: "error",
            duration: 10_000,
          },
        );
      });
  };

  watch(
    () => sessionsStore.hydrated,
    (hydrated) => {
      if (hydrated) flushSessionNotifications();
    },
    { flush: "sync" },
  );

  // Register before loading the initial snapshot so the store can buffer events
  // that arrive while it hydrates.
  sdk.backend.onEvent("paramfinder:session_change", (envelope) => {
    sessionsStore.acceptEnvelope(envelope);
    if (!sessionsStore.hydrated) {
      pendingNotificationEnvelopes.push(envelope);
      return;
    }
    countNewSessions(envelope);
  });

  for (const attackType of attackTypes) {
    const commandId = `paramfinder:start-${attackType}`;
    sdk.commands.register(commandId, {
      name: `Param Finder [${attackType.toUpperCase()}]`,
      group: "Param Finder",
      run: (context) => runScan(sdk, context, attackType),
    });
    registerRequestMenuItems(sdk, commandId);
    sdk.commandPalette.register(commandId);
  }

  sdk.commands.register(advancedScanCommandId, {
    name: "Param Finder [ADVANCED]",
    group: "Param Finder",
    run: (context) => runAdvancedScan(sdk, context),
  });
  registerRequestMenuItems(sdk, advancedScanCommandId);
  sdk.commandPalette.register(advancedScanCommandId);

  sdk.commands.register("paramfinder:quick-menu", {
    name: "Param Finder Quick Menu",
    group: "Param Finder",
    run: (context) => runAdvancedScan(sdk, context),
  });
  sdk.shortcuts.register("paramfinder:quick-menu", ["Control", "Shift", "E"]);

  reportSessionLoad(sessionsStore.initialize());

  sdk.navigation.addPage("/paramfinder", {
    body: root,
    onEnter: () => {
      clearSidebarCount();
      triggerPageEnter();
    },
  });

  sdk.projects.onCurrentProjectChange((event) => {
    resetSessionNotifications();
    reportSessionLoad(sessionsStore.reloadForProject(event.projectId));
  });
};
