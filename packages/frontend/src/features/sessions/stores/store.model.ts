import type {
  RequestResponse,
  SentRequest,
  Sequenced,
  SessionDescriptor,
  SessionEntryKind,
  SessionFinding,
  SessionRef,
} from "shared";

import type { SessionEntryCache } from "./sessionEntryCache";

export type SessionRequestsTab = "requests" | "findings";
export type SessionAction = "pause" | "resume" | "cancel" | "delete" | "rerun";

export type RequestDetailState = {
  response?: RequestResponse;
  error?: string;
  loading: boolean;
};

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
  activeSessionId?: string;
  selectedRequestId?: string;
  selectedFindingKey?: string;
  requestsTab: SessionRequestsTab;
  actionLoading: Record<string, SessionAction>;
  requestDetails: Record<string, RequestDetailState>;
  generation: number;
};

export const initialModel: SessionsModel = {
  sessions: {},
  caches: {},
  revision: 0,
  hydrated: false,
  noProjectSelected: false,
  requestsTab: "findings",
  actionLoading: {},
  requestDetails: {},
  generation: 0,
};

export function cacheKey(ref: SessionRef, kind: SessionEntryKind) {
  return `${ref.projectId}\u0000${ref.sessionId}\u0000${kind}`;
}
