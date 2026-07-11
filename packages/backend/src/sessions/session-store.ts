import { access, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import {
  compareSessionIds,
  type CursorPage,
  enginePhaseSchema,
  engineStateSchema,
  type ProjectSessionSnapshot,
  sentRequestSchema,
  type SessionDescriptor,
  sessionDescriptorSchema,
  type SessionEntriesQuery,
  type SessionEntry,
  type SessionEntryInput,
  type SessionEntryKind,
  sessionEntrySchema,
  sessionFindingSchema,
  type SessionRef,
  type SessionRerun,
  sessionRerunSchema,
} from "shared";
import { z } from "zod";

import type { BackendSDK } from "../types/types";

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1_000;
const SNAPSHOT_VERSION = 2 as const;
const SNAPSHOT_FILENAME = "sessions-v2.json";

const legacySessionSchema = z.object({
  id: z.string().optional(),
  findings: z.array(sessionFindingSchema),
  sentRequests: z.array(sentRequestSchema),
  state: engineStateSchema,
  phase: enginePhaseSchema,
  totalParametersAmount: z.number().int().nonnegative(),
  totalLearnRequests: z.number().int().nonnegative(),
  parametersSent: z.number().int().nonnegative(),
  requestsSent: z.number().int().nonnegative(),
  logs: z.array(z.string()),
  rerun: sessionRerunSchema.optional(),
});
type LegacySession = z.infer<typeof legacySessionSchema>;

const storedSessionSchema = z.object({
  descriptor: sessionDescriptorSchema,
  entries: z.array(sessionEntrySchema),
});
const fileSnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  projects: z.array(
    z.object({
      projectId: z.string().min(1),
      revision: z.number().int().nonnegative(),
      sessions: z.array(storedSessionSchema),
    }),
  ),
});

type StoredSession = {
  descriptor: SessionDescriptor;
  entries: SessionEntry[];
  nextSequence: number;
};
type ProjectState = {
  revision: number;
  sessions: Map<string, StoredSession>;
};

export type SessionFilePersistence = {
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, contents: string) => Promise<void>;
  replaceFile: (from: string, to: string) => Promise<void>;
  exists: (filePath: string) => Promise<boolean>;
};

const filePersistence: SessionFilePersistence = {
  readFile: async (filePath) => String(await readFile(filePath)),
  writeFile,
  replaceFile: rename,
  exists,
};

/**
 * Sessions live in indexed memory and are checkpointed as one atomic JSON file.
 * Entry batches deliberately do not rewrite the growing snapshot. State changes
 * (including pause and terminal transitions) checkpoint all entries accumulated
 * since the previous state change.
 */
export class SessionStore {
  private projects = new Map<string, ProjectState>();
  private operationQueue: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(
    private readonly sdk: BackendSDK,
    private readonly persistence: SessionFilePersistence = filePersistence,
  ) {
    this.ready = this.initialize();
  }

  async getCurrentProjectId(): Promise<string | undefined> {
    await this.ready;
    return (await this.sdk.projects.getCurrent())?.getId();
  }

  async listSessions(projectId: string): Promise<ProjectSessionSnapshot> {
    return this.serialized(async () => {
      const project = await this.ensureProject(projectId);
      const sessions = [...project.sessions.values()]
        .map(({ descriptor }) => copyDescriptor(descriptor))
        .sort(
          (left, right) =>
            right.createdAt - left.createdAt ||
            compareSessionIds(right.ref.sessionId, left.ref.sessionId),
        );
      return {
        version: SNAPSHOT_VERSION,
        projectId,
        revision: project.revision,
        sessions,
      };
    });
  }

  async createSession(
    ref: SessionRef,
    totalParametersAmount: number,
    totalLearnRequests: number,
    rerun: SessionRerun,
  ): Promise<{ revision: number; session: SessionDescriptor }> {
    return this.serialized(async () => {
      const project = await this.ensureProject(ref.projectId);
      return this.createSessionInProject(
        project,
        ref,
        totalParametersAmount,
        totalLearnRequests,
        rerun,
      );
    });
  }

  async createNextSession(
    projectId: string,
    totalParametersAmount: number,
    totalLearnRequests: number,
    rerun: SessionRerun,
  ): Promise<{ revision: number; session: SessionDescriptor }> {
    return this.serialized(async () => {
      const project = await this.ensureProject(projectId);
      const ref = {
        projectId,
        sessionId: nextNumericSessionId(project.sessions.keys()),
      };
      return this.createSessionInProject(
        project,
        ref,
        totalParametersAmount,
        totalLearnRequests,
        rerun,
      );
    });
  }

  private async createSessionInProject(
    project: ProjectState,
    ref: SessionRef,
    totalParametersAmount: number,
    totalLearnRequests: number,
    rerun: SessionRerun,
  ): Promise<{ revision: number; session: SessionDescriptor }> {
    if (project.sessions.has(ref.sessionId)) {
      throw new Error(`Session ${ref.sessionId} already exists.`);
    }
    const now = Date.now();
    const descriptor = sessionDescriptorSchema.parse({
      ref,
      state: "pending",
      phase: "idle",
      totalParametersAmount,
      totalLearnRequests,
      parametersSent: 0,
      requestsSent: 0,
      findingsCount: 0,
      logsCount: 0,
      createdAt: now,
      updatedAt: now,
      rerun: sessionRerunSchema.parse(rerun),
    });
    project.sessions.set(ref.sessionId, {
      descriptor,
      entries: [],
      nextSequence: 1,
    });
    project.revision += 1;
    try {
      await this.persist();
    } catch (cause) {
      project.sessions.delete(ref.sessionId);
      project.revision -= 1;
      throw cause;
    }
    return {
      revision: project.revision,
      session: copyDescriptor(descriptor),
    };
  }

  async updateSession(
    ref: SessionRef,
    changes: Partial<
      Pick<
        SessionDescriptor,
        | "state"
        | "phase"
        | "totalParametersAmount"
        | "parametersSent"
        | "requestsSent"
        | "error"
      >
    >,
  ): Promise<{ revision: number; session: SessionDescriptor } | undefined> {
    return this.serialized(async () => {
      const project = await this.ensureProject(ref.projectId);
      const stored = project.sessions.get(ref.sessionId);
      if (stored === undefined) return undefined;
      const previous = stored.descriptor;
      const next = sessionDescriptorSchema.parse({
        ...previous,
        ...changes,
        updatedAt: Date.now(),
      });
      stored.descriptor = next;
      project.revision += 1;
      try {
        await this.persist();
      } catch (cause) {
        stored.descriptor = previous;
        project.revision -= 1;
        throw cause;
      }
      return { revision: project.revision, session: copyDescriptor(next) };
    });
  }

  async appendEntries(
    ref: SessionRef,
    values: SessionEntryInput[],
    counterChanges: Partial<
      Pick<SessionDescriptor, "totalParametersAmount">
    > = {},
  ): Promise<
    | { revision: number; session: SessionDescriptor; entries: SessionEntry[] }
    | undefined
  > {
    if (values.length === 0) return undefined;
    return this.serialized(async () => {
      const project = await this.ensureProject(ref.projectId);
      const stored = project.sessions.get(ref.sessionId);
      if (stored === undefined) return undefined;

      let sequence = stored.nextSequence;
      const entries = values.map((value) =>
        sessionEntrySchema.parse({ ...value, sequence: sequence++ }),
      );
      let requests = 0;
      let parameters = 0;
      let findings = 0;
      let logs = 0;
      for (const entry of entries) {
        if (entry.kind === "request") {
          requests += 1;
          parameters += entry.value.parametersSent;
        } else if (entry.kind === "finding") findings += 1;
        else logs += 1;
      }
      stored.entries.push(...entries);
      stored.nextSequence = sequence;
      stored.descriptor = sessionDescriptorSchema.parse({
        ...stored.descriptor,
        totalParametersAmount:
          counterChanges.totalParametersAmount ??
          stored.descriptor.totalParametersAmount,
        parametersSent: stored.descriptor.parametersSent + parameters,
        requestsSent: stored.descriptor.requestsSent + requests,
        findingsCount: stored.descriptor.findingsCount + findings,
        logsCount: stored.descriptor.logsCount + logs,
        updatedAt: Date.now(),
      });
      project.revision += 1;
      return {
        revision: project.revision,
        session: copyDescriptor(stored.descriptor),
        entries: entries.map(copyEntry),
      };
    });
  }

  async getSession(ref: SessionRef): Promise<SessionDescriptor | undefined> {
    return this.serialized(async () => {
      const stored = (await this.ensureProject(ref.projectId)).sessions.get(
        ref.sessionId,
      );
      return stored === undefined
        ? undefined
        : copyDescriptor(stored.descriptor);
    });
  }

  async getEntries(
    query: SessionEntriesQuery,
  ): Promise<CursorPage<SessionEntry> | undefined> {
    return this.serialized(async () => {
      const stored = (
        await this.ensureProject(query.ref.projectId)
      ).sessions.get(query.ref.sessionId);
      if (stored === undefined) return undefined;
      const cursor = parseCursor(query.cursor);
      const currentMax = maximumSequence(stored.entries, query.kind);
      const snapshotMaxSequence = cursor?.snapshotMaxSequence ?? currentMax;
      const offset = cursor?.offset ?? 0;
      const filter = query.filter?.trim().toLowerCase();
      const matching = stored.entries.filter(
        (entry) =>
          entry.kind === query.kind &&
          entry.sequence <= snapshotMaxSequence &&
          (!filter ||
            JSON.stringify(entry.value).toLowerCase().includes(filter)),
      );
      const sort = query.sort ?? {
        field: "sequence",
        direction: "asc" as const,
      };
      matching.sort((left, right) => compareEntries(left, right, sort));
      const limit = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE),
      );
      const items = matching.slice(offset, offset + limit).map(copyEntry);
      const nextOffset = offset + items.length;
      return {
        items,
        total: matching.length,
        snapshotMaxSequence,
        nextCursor:
          nextOffset < matching.length
            ? formatCursor({ snapshotMaxSequence, offset: nextOffset })
            : undefined,
      };
    });
  }

  async deleteSessions(refs: SessionRef[]): Promise<Map<string, number>> {
    return this.serialized(async () => {
      const affected = new Map<
        string,
        {
          project: ProjectState;
          revision: number;
          sessions: Map<string, StoredSession>;
        }
      >();
      for (const ref of refs) {
        const project = await this.ensureProject(ref.projectId);
        const stored = project.sessions.get(ref.sessionId);
        if (stored === undefined) continue;
        let rollback = affected.get(ref.projectId);
        if (rollback === undefined) {
          rollback = {
            project,
            revision: project.revision,
            sessions: new Map(project.sessions),
          };
          affected.set(ref.projectId, rollback);
        }
        project.sessions.delete(ref.sessionId);
      }
      if (affected.size === 0) return new Map();
      for (const { project } of affected.values()) project.revision += 1;
      try {
        await this.persist();
      } catch (cause) {
        for (const rollback of affected.values()) {
          rollback.project.revision = rollback.revision;
          rollback.project.sessions = rollback.sessions;
        }
        throw cause;
      }
      return new Map(
        [...affected].map(([projectId, { project }]) => [
          projectId,
          project.revision,
        ]),
      );
    });
  }

  private async initialize(): Promise<void> {
    const snapshotPath = this.snapshotPath();
    if (await this.persistence.exists(snapshotPath)) {
      try {
        this.projects = parseSnapshot(
          JSON.parse(await this.persistence.readFile(snapshotPath)),
        );
      } catch (cause) {
        this.sdk.console.error(
          `[SESSIONS] Quarantining invalid session snapshot: ${String(cause)}`,
        );
        await this.persistence
          .replaceFile(snapshotPath, `${snapshotPath}.quarantine-${Date.now()}`)
          .catch(() => undefined);
        this.projects = new Map();
        await this.persist();
      }
    }

    let changed = false;
    for (const project of this.projects.values()) {
      const interrupted = [...project.sessions.values()].filter(
        ({ descriptor }) =>
          ["pending", "learning", "running", "paused"].includes(
            descriptor.state,
          ),
      );
      if (interrupted.length === 0) continue;
      const now = Date.now();
      for (const stored of interrupted) {
        stored.descriptor = sessionDescriptorSchema.parse({
          ...stored.descriptor,
          state: "error",
          updatedAt: now,
          error: {
            code: "INTERNAL",
            message:
              "Scan interrupted because the ParamFinder backend restarted.",
          },
        });
      }
      project.revision += 1;
      changed = true;
    }
    if (changed) await this.persist();
  }

  private async ensureProject(projectId: string): Promise<ProjectState> {
    let project = this.projects.get(projectId);
    if (project !== undefined) return project;
    project = { revision: 0, sessions: new Map() };
    this.projects.set(projectId, project);
    try {
      await this.importLegacy(projectId, project);
    } catch (cause) {
      this.projects.delete(projectId);
      throw cause;
    }
    return project;
  }

  private async importLegacy(
    projectId: string,
    project: ProjectState,
  ): Promise<void> {
    const primaryPath = path.join(
      this.sdk.meta.path(),
      `sessions-${safeFilename(projectId)}.json`,
    );
    const migratedPath = `${primaryPath}.migrated`;
    const legacyPath = (await this.persistence.exists(primaryPath))
      ? primaryPath
      : (await this.persistence.exists(migratedPath))
        ? migratedPath
        : undefined;
    if (legacyPath === undefined) return;
    let root: { version?: unknown; sessions?: unknown };
    try {
      root = JSON.parse(
        await this.persistence.readFile(legacyPath),
      ) as typeof root;
      if (
        root.version !== 1 ||
        typeof root.sessions !== "object" ||
        root.sessions === null
      ) {
        throw new Error("unsupported snapshot version");
      }
    } catch (cause) {
      this.sdk.console.error(
        `[SESSIONS] Quarantining invalid legacy snapshot for ${projectId}: ${String(cause)}`,
      );
      await this.persistence
        .replaceFile(legacyPath, `${legacyPath}.quarantine-${Date.now()}`)
        .catch(() => undefined);
      return;
    }

    const now = Date.now();
    for (const [sessionId, value] of Object.entries(
      root.sessions as Record<string, unknown>,
    )) {
      const parsed = legacySessionSchema.safeParse(value);
      if (!parsed.success) {
        this.sdk.console.error(
          `[SESSIONS] Skipped invalid legacy session ${sessionId}: ${parsed.error.message}`,
        );
        continue;
      }
      project.sessions.set(
        sessionId,
        createStoredLegacySession(projectId, sessionId, parsed.data, now),
      );
    }
    try {
      await this.persist();
    } catch (cause) {
      project.sessions.clear();
      throw cause;
    }
    if (legacyPath === primaryPath) {
      await this.persistence
        .replaceFile(legacyPath, migratedPath)
        .catch((cause) => {
          this.sdk.console.error(
            `[SESSIONS] Imported legacy snapshot but could not archive it: ${String(cause)}`,
          );
        });
    }
  }

  private snapshotPath(): string {
    return path.join(this.sdk.meta.path(), SNAPSHOT_FILENAME);
  }

  private async persist(): Promise<void> {
    const snapshotPath = this.snapshotPath();
    const temporaryPath = `${snapshotPath}.tmp`;
    await this.persistence.writeFile(
      temporaryPath,
      JSON.stringify(toSnapshot(this.projects)),
    );
    await this.persistence.replaceFile(temporaryPath, snapshotPath);
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async () => {
      await this.ready;
      return operation();
    };
    const result = this.operationQueue.then(execute, execute);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function nextNumericSessionId(sessionIds: Iterable<string>): string {
  let largest = 0n;
  for (const sessionId of sessionIds) {
    if (!/^\d+$/.test(sessionId)) continue;

    const value = BigInt(sessionId);
    if (value > largest) largest = value;
  }
  return String(largest + 1n);
}

let sessionStore: SessionStore | undefined;
export function initSessionStore(sdk: BackendSDK): SessionStore {
  sessionStore ??= new SessionStore(sdk);
  return sessionStore;
}
export function getSessionStore(): SessionStore {
  if (sessionStore === undefined)
    throw new Error("Session store not initialized");
  return sessionStore;
}

function toSnapshot(projects: Map<string, ProjectState>): unknown {
  return {
    version: SNAPSHOT_VERSION,
    projects: [...projects].map(([projectId, project]) => ({
      projectId,
      revision: project.revision,
      sessions: [...project.sessions.values()].map(
        ({ descriptor, entries }) => ({
          descriptor,
          entries,
        }),
      ),
    })),
  };
}

function parseSnapshot(value: unknown): Map<string, ProjectState> {
  const parsed = fileSnapshotSchema.parse(value);
  return new Map(
    parsed.projects.map((project) => [
      project.projectId,
      {
        revision: project.revision,
        sessions: new Map(
          project.sessions.map(({ descriptor, entries }) => [
            descriptor.ref.sessionId,
            {
              descriptor,
              entries,
              nextSequence:
                entries.reduce(
                  (maximum, entry) => Math.max(maximum, entry.sequence),
                  0,
                ) + 1,
            },
          ]),
        ),
      },
    ]),
  );
}

function createStoredLegacySession(
  projectId: string,
  sessionId: string,
  session: LegacySession,
  now: number,
): StoredSession {
  let sequence = 1;
  const entries: SessionEntry[] = [];
  for (const value of session.sentRequests) {
    entries.push(
      sessionEntrySchema.parse({
        sequence: sequence++,
        kind: "request",
        value,
      }),
    );
  }
  for (const value of session.findings) {
    entries.push(
      sessionEntrySchema.parse({
        sequence: sequence++,
        kind: "finding",
        value,
      }),
    );
  }
  for (const value of session.logs) {
    entries.push(
      sessionEntrySchema.parse({ sequence: sequence++, kind: "log", value }),
    );
  }
  return {
    descriptor: sessionDescriptorSchema.parse({
      ref: { projectId, sessionId },
      state: session.state,
      phase: session.phase,
      totalParametersAmount: session.totalParametersAmount,
      totalLearnRequests: session.totalLearnRequests,
      parametersSent: session.parametersSent,
      requestsSent: session.requestsSent,
      findingsCount: session.findings.length,
      logsCount: session.logs.length,
      createdAt: now,
      updatedAt: now,
      rerun: session.rerun,
    }),
    entries,
    nextSequence: sequence,
  };
}

function copyDescriptor(descriptor: SessionDescriptor): SessionDescriptor {
  return sessionDescriptorSchema.parse(descriptor);
}
function copyEntry(entry: SessionEntry): SessionEntry {
  return sessionEntrySchema.parse(entry);
}

type ParsedCursor = { snapshotMaxSequence: number; offset: number };
export class InvalidCursorError extends Error {}
function parseCursor(cursor: string | undefined): ParsedCursor | undefined {
  if (!cursor) return undefined;
  const match = /^v1:(\d+):(\d+)$/.exec(cursor);
  if (!match) throw new InvalidCursorError("Invalid session entry cursor");
  const snapshotMaxSequence = Number(match[1]);
  const offset = Number(match[2]);
  if (
    !Number.isSafeInteger(snapshotMaxSequence) ||
    !Number.isSafeInteger(offset) ||
    snapshotMaxSequence < 0 ||
    offset < 0
  ) {
    throw new InvalidCursorError("Invalid session entry cursor");
  }
  return { snapshotMaxSequence, offset };
}
function formatCursor(cursor: ParsedCursor): string {
  return `v1:${cursor.snapshotMaxSequence}:${cursor.offset}`;
}

function maximumSequence(
  entries: SessionEntry[],
  kind: SessionEntryKind,
): number {
  let maximum = 0;
  for (const entry of entries) {
    if (entry.kind === kind) maximum = Math.max(maximum, entry.sequence);
  }
  return maximum;
}

function compareEntries(
  left: SessionEntry,
  right: SessionEntry,
  sort: NonNullable<SessionEntriesQuery["sort"]>,
): number {
  const direction = sort.direction === "desc" ? -1 : 1;
  const compared = compareValues(
    sortValue(left, sort.field),
    sortValue(right, sort.field),
  );
  return (compared || left.sequence - right.sequence) * direction;
}

function sortValue(
  entry: SessionEntry,
  field: NonNullable<SessionEntriesQuery["sort"]>["field"],
): string | number | undefined {
  if (field === "sequence") return entry.sequence;
  if (typeof entry.value === "string") return undefined;
  switch (field) {
    case "requestId":
      return entry.value.requestId;
    case "responseStatus":
      return entry.value.responseStatus;
    case "responseLength":
      return entry.value.responseLength;
    case "responseTime":
      return "responseTime" in entry.value
        ? entry.value.responseTime
        : undefined;
    case "parametersSent":
      return "parametersSent" in entry.value
        ? entry.value.parametersSent
        : undefined;
    case "parametersTested":
      return "parametersSent" in entry.value
        ? (entry.value.parametersTested ?? entry.value.parametersSent)
        : undefined;
    case "context":
      return "context" in entry.value ? entry.value.context : undefined;
    case "parameter":
      return "parameter" in entry.value
        ? entry.value.parameter.name
        : undefined;
    case "anomaly":
      return "anomaly" in entry.value ? entry.value.anomaly.type : undefined;
  }
}

function compareValues(
  left: string | number | undefined,
  right: string | number | undefined,
): number {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return compareStrings(String(left), String(right));
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
