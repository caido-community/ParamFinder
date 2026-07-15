import {
  createMiningHandlers,
  createRequestHandlers,
  createSessionHandlers,
  createSettingsHandlers,
  createWordlistHandlers,
  mapApiErrors,
} from "./api";
import {
  initializeSessionDatabase,
  SessionsRepository,
  SettingsRepository,
  WordlistsRepository,
} from "./repositories";
import {
  MiningService,
  SessionsService,
  SettingsService,
  WordlistsService,
} from "./services";
import { RunningSessionsStore } from "./stores";
import type { BackendSDK } from "./types";

export type { API, Events, Spec } from "shared";

export async function init(sdk: BackendSDK): Promise<void> {
  const database = await sdk.meta.db();
  const pluginDirectory = sdk.meta.path();

  await initializeSessionDatabase(database);

  const sessionsRepository = new SessionsRepository(database);
  const settingsRepository = new SettingsRepository(pluginDirectory);
  const wordlistsRepository = new WordlistsRepository(
    database,
    pluginDirectory,
  );

  const sessions = new SessionsService(sessionsRepository);
  const settings = new SettingsService(settingsRepository);
  const wordlists = new WordlistsService(wordlistsRepository);

  await settings.initialize();
  await wordlists.initialize();

  const activeProject = await sdk.projects.getCurrent();
  const runningSessions = new RunningSessionsStore();
  const mining = new MiningService(
    sdk,
    sessions,
    wordlists,
    runningSessions,
    activeProject?.getId(),
  );

  sdk.events.onProjectChange(async (sdk, project) => {
    const currentProject = await sdk.projects.getCurrent();
    const projectId = project?.getId();

    if (currentProject?.getId() !== projectId) {
      return;
    }

    const result = await mining.pauseOutsideProject(projectId);
    if (!result.success) {
      sdk.console.error(
        `[SESSIONS] Could not pause sessions after project change: ${result.error.message}`,
      );
    }
  });

  const miningHandlers = createMiningHandlers(mining);
  const requestHandlers = createRequestHandlers();
  const sessionHandlers = createSessionHandlers(sessions, mining);
  const settingsHandlers = createSettingsHandlers(settings);
  const wordlistHandlers = createWordlistHandlers(wordlists);

  sdk.api.register("startMining", mapApiErrors(miningHandlers.startMining));
  sdk.api.register("cancelSession", mapApiErrors(miningHandlers.cancelSession));
  sdk.api.register("pauseSession", mapApiErrors(miningHandlers.pauseSession));
  sdk.api.register("resumeSession", mapApiErrors(miningHandlers.resumeSession));
  sdk.api.register(
    "deleteSessions",
    mapApiErrors(sessionHandlers.deleteSessions),
  );
  sdk.api.register("listSessions", mapApiErrors(sessionHandlers.listSessions));
  sdk.api.register(
    "getSessionEntries",
    mapApiErrors(sessionHandlers.getSessionEntries),
  );
  sdk.api.register(
    "getCurrentProjectId",
    mapApiErrors(sessionHandlers.getCurrentProjectId),
  );
  sdk.api.register("getRequest", mapApiErrors(requestHandlers.getRequest));
  sdk.api.register("getWordlists", mapApiErrors(wordlistHandlers.getWordlists));
  sdk.api.register(
    "clearWordlists",
    mapApiErrors(wordlistHandlers.clearWordlists),
  );
  sdk.api.register(
    "importWordlist",
    mapApiErrors(wordlistHandlers.importWordlist),
  );
  sdk.api.register(
    "deleteWordlist",
    mapApiErrors(wordlistHandlers.deleteWordlist),
  );
  sdk.api.register(
    "setWordlistEnabled",
    mapApiErrors(wordlistHandlers.setWordlistEnabled),
  );
  sdk.api.register(
    "setWordlistAttackTypes",
    mapApiErrors(wordlistHandlers.setWordlistAttackTypes),
  );
  sdk.api.register("getSettings", mapApiErrors(settingsHandlers.getSettings));
  sdk.api.register(
    "patchSettings",
    mapApiErrors(settingsHandlers.patchSettings),
  );
}
