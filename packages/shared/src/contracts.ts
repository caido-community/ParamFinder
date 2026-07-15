import type { DefinePluginPackageSpec } from "@caido/sdk-shared";

import type { ApiResult, CursorPage } from "./api";
import type {
  ParamMinerConfig,
  ProjectSessionSnapshot,
  SessionChangeEnvelope,
  SessionDescriptor,
  SessionEntriesQuery,
  SessionEntry,
  SessionRef,
  Settings,
  SettingsChanges,
  Wordlist,
} from "./mining";
import type { AttackType, Request } from "./primitives";

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
  deleteWordlist: (path: string) => Promise<ApiResult<void>>;
  setWordlistEnabled: (
    path: string,
    enabled: boolean,
  ) => Promise<ApiResult<void>>;
  setWordlistAttackTypes: (
    path: string,
    attackTypes: AttackType[],
  ) => Promise<ApiResult<void>>;
  getSettings: () => Promise<ApiResult<Settings>>;
  patchSettings: (changes: SettingsChanges) => Promise<ApiResult<Settings>>;
};

export type Events = {
  "paramfinder:session_change": (envelope: SessionChangeEnvelope) => void;
};

export type Spec = DefinePluginPackageSpec<{
  manifestId: "paramfinder-plugin";
  api: API;
  events: Events;
}>;
