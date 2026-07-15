import {
  type CursorPage,
  type NonTerminalSessionLifecycle,
  type ProjectSessionSnapshot,
  type SessionDescriptor,
  sessionDescriptorSchema,
  type SessionEntriesQuery,
  type SessionEntry,
  type SessionEntryInput,
  type SessionLifecycle,
  type SessionRef,
  type SessionRerun,
  type TerminalSessionDescriptor,
  type TerminalSessionLifecycle,
} from "shared";

import {
  InvalidCursorError,
  type SessionsRepository,
} from "../repositories/sessions";
import { SerialTaskQueue } from "../util";

export { InvalidCursorError };

type SessionUpdate<T extends SessionDescriptor = SessionDescriptor> = {
  revision: number;
  session: T;
};

export type SessionsPersistence = Pick<
  SessionsRepository,
  | "list"
  | "find"
  | "nextSessionId"
  | "insert"
  | "update"
  | "appendEntries"
  | "queryEntries"
  | "delete"
>;

export class SessionsService {
  private readonly operations = new SerialTaskQueue();

  constructor(private readonly repository: SessionsPersistence) {}

  listSessions(projectId: string): Promise<ProjectSessionSnapshot> {
    return this.exclusive((repository) => repository.list(projectId));
  }

  createNextSession(
    projectId: string,
    totalParametersAmount: number,
    totalLearnRequests: number,
    rerun: SessionRerun,
  ): Promise<SessionUpdate> {
    return this.exclusive(async (repository) => {
      const sessionId = await repository.nextSessionId(projectId);
      return saveNewSession(
        repository,
        { projectId, sessionId },
        totalParametersAmount,
        totalLearnRequests,
        rerun,
      );
    });
  }

  async transitionSession(
    ref: SessionRef,
    lifecycle: TerminalSessionLifecycle,
  ): Promise<SessionUpdate<TerminalSessionDescriptor> | undefined>;
  async transitionSession(
    ref: SessionRef,
    lifecycle: NonTerminalSessionLifecycle,
  ): Promise<SessionUpdate | undefined>;
  async transitionSession(
    ref: SessionRef,
    lifecycle: SessionLifecycle,
  ): Promise<SessionUpdate | undefined> {
    return this.exclusive(async (repository) => {
      const previous = await repository.find(ref);
      if (previous === undefined) {
        return undefined;
      }

      const session = sessionDescriptorSchema.parse({
        ...previous,
        ...lifecycle,
      });
      const revision = await repository.update(session);

      return { revision, session };
    });
  }

  setTotalParametersAmount(
    ref: SessionRef,
    totalParametersAmount: number,
  ): Promise<SessionUpdate | undefined> {
    return this.exclusive(async (repository) => {
      const previous = await repository.find(ref);
      if (previous === undefined) {
        return undefined;
      }

      const session = sessionDescriptorSchema.parse({
        ...previous,
        totalParametersAmount,
      });
      const revision = await repository.update(session);

      return { revision, session };
    });
  }

  async appendEntries(
    ref: SessionRef,
    values: SessionEntryInput[],
  ): Promise<
    | (SessionUpdate & {
        entries: SessionEntry[];
      })
    | undefined
  > {
    if (values.length === 0) {
      return undefined;
    }

    return this.exclusive(async (repository) => {
      const previous = await repository.find(ref);
      if (previous === undefined) {
        return undefined;
      }

      const counts = countEntries(values);
      const session: SessionDescriptor = {
        ...previous,
        parametersSent: previous.parametersSent + counts.parameters,
        requestsSent: previous.requestsSent + counts.requests,
        findingsCount: previous.findingsCount + counts.findings,
        logsCount: previous.logsCount + counts.logs,
      };
      const saved = await repository.appendEntries(ref, values, session);

      return { ...saved, session };
    });
  }

  getSession(ref: SessionRef): Promise<SessionDescriptor | undefined> {
    return this.exclusive((repository) => repository.find(ref));
  }

  getEntries(
    query: SessionEntriesQuery,
  ): Promise<CursorPage<SessionEntry> | undefined> {
    return this.exclusive(async (repository) => {
      const session = await repository.find(query.ref);
      if (session === undefined) {
        return undefined;
      }

      return repository.queryEntries(query);
    });
  }

  deleteSessions(refs: SessionRef[]): Promise<Map<string, number>> {
    return this.exclusive((repository) => repository.delete(refs));
  }

  private exclusive<T>(
    operation: (repository: SessionsPersistence) => Promise<T>,
  ): Promise<T> {
    return this.operations.run(() => operation(this.repository));
  }
}

async function saveNewSession(
  repository: SessionsPersistence,
  ref: SessionRef,
  totalParametersAmount: number,
  totalLearnRequests: number,
  rerun: SessionRerun,
): Promise<SessionUpdate> {
  const session: SessionDescriptor = {
    ref,
    state: "pending",
    phase: "idle",
    totalParametersAmount,
    totalLearnRequests,
    parametersSent: 0,
    requestsSent: 0,
    findingsCount: 0,
    logsCount: 0,
    createdAt: Date.now(),
    rerun,
  };
  const revision = await repository.insert(session);

  return { revision, session };
}

function countEntries(entries: SessionEntryInput[]) {
  let requests = 0;
  let parameters = 0;
  let findings = 0;
  let logs = 0;

  for (const entry of entries) {
    switch (entry.kind) {
      case "request":
        requests += 1;
        parameters += entry.value.parametersSent;
        break;
      case "finding":
        findings += 1;
        break;
      case "log":
        logs += 1;
        break;
    }
  }

  return { requests, parameters, findings, logs };
}
