import type {
  SentRequest,
  Sequenced,
  SessionDescriptor,
  SessionEntryKind,
  SessionFinding,
  SessionRef,
} from "shared";

import type { SessionEntryCache } from "./sessionEntryCache";

export type SessionAction = "pause" | "resume" | "cancel" | "rerun";

export type SessionView = SessionDescriptor & {
  id: string;
  sentRequests: Sequenced<SentRequest>[];
  findings: Sequenced<SessionFinding>[];
  logs: string[];
};

export type SessionsModel = {
  sessions: Record<string, SessionDescriptor>;
  caches: Record<string, SessionEntryCache>;
  currentProjectId?: string;
  revision: number;
  hydrated: boolean;
  noProjectSelected: boolean;
  actionLoading: Record<string, SessionAction>;
  generation: number;
};

export const initialModel: SessionsModel = {
  sessions: {},
  caches: {},
  revision: 0,
  hydrated: false,
  noProjectSelected: false,
  actionLoading: {},
  generation: 0,
};

export function cacheKey(ref: SessionRef, kind: SessionEntryKind) {
  return `${ref.projectId}\u0000${ref.sessionId}\u0000${kind}`;
}
