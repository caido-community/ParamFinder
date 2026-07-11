import type { DefinePluginPackageSpec } from "@caido/sdk-shared";
import type { SDK } from "caido:plugin";
import type {
  ApiResult,
  AttackType,
  CursorPage,
  ParamMinerConfig,
  ProjectSessionSnapshot,
  Request,
  SessionChangeEnvelope,
  SessionDescriptor,
  SessionEntriesQuery,
  SessionEntry,
  SessionRef,
  SettingsDocument,
  SettingsPatch,
  Wordlist,
} from "shared";

export type API = {
  startMining: (
    target: Request,
    config: ParamMinerConfig,
  ) => Promise<ApiResult<SessionDescriptor>>;
  cancelSession: (ref: SessionRef) => Promise<ApiResult<void>>;
  pauseSession: (ref: SessionRef) => Promise<ApiResult<void>>;
  resumeSession: (ref: SessionRef) => Promise<ApiResult<void>>;
  deleteSessions: (refs: SessionRef[]) => Promise<ApiResult<void>>;
  listSessions: (
    projectId: string,
  ) => Promise<ApiResult<ProjectSessionSnapshot>>;
  getSessionEntries: (
    query: SessionEntriesQuery,
  ) => Promise<ApiResult<CursorPage<SessionEntry>>>;
  getCurrentProjectId: () => Promise<ApiResult<string | undefined>>;
  getRequest: (id: string) => Promise<ApiResult<Request>>;
  getWordlists: () => Promise<ApiResult<Wordlist[]>>;
  clearWordlists: () => Promise<ApiResult<void>>;
  importWordlist: (
    data: string,
    filename: string,
  ) => Promise<ApiResult<Wordlist>>;
  deleteWordlist: (id: string) => Promise<ApiResult<void>>;
  setWordlistEnabled: (
    id: string,
    enabled: boolean,
  ) => Promise<ApiResult<void>>;
  setWordlistAttackTypes: (
    id: string,
    attackTypes: AttackType[],
  ) => Promise<ApiResult<void>>;
  getSettings: () => Promise<ApiResult<SettingsDocument>>;
  patchSettings: (patch: SettingsPatch) => Promise<ApiResult<SettingsDocument>>;
  getSettingsPath: () => Promise<ApiResult<string>>;
};

export type Events = {
  "paramfinder:session_change": (envelope: SessionChangeEnvelope) => void;
  "paramfinder:update_available": () => void;
};

export type Spec = DefinePluginPackageSpec<{
  manifestId: "paramfinder-plugin";
  api: API;
  events: Events;
}>;
export type BackendEvents = Events;
export type BackendSDK = SDK<Spec>;
