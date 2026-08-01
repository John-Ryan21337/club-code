import {
  COLLABORATION_PRESENCE_DELTA_REPLAY_MAX,
  COLLABORATION_PRESENCE_HEARTBEAT_INTERVAL_MILLIS,
  COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT,
  COLLABORATION_PRESENCE_MAX_SESSIONS_PER_DEVICE,
  COLLABORATION_PRESENCE_ROSTER_MAX,
  COLLABORATION_PRESENCE_SESSION_TTL_MILLIS,
  CollaborationPresenceCapabilities,
  CollaborationPresenceCloseRequest,
  CollaborationPresenceHeartbeatRequest,
  CollaborationPresenceOpenRequest,
  CollaborationPresenceSessionId,
  CollaborationPresenceSubscribeRequest,
  type CollaborationPresenceDelta,
  type CollaborationPresenceRosterEntry,
  type CollaborationPresenceSnapshot,
  type CollaborationPresenceUpdate,
  type CollaborationPrincipal,
  type SharedProjectId,
} from "@cafecode/contracts";
import { CollaborationDeviceKeyId } from "@cafecode/contracts";
import { createHash, createHmac, randomBytes } from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  authorizeCollaborationPermission,
  type CollaborationMembershipAuthorityShape,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";
import type { CollaborationDeviceKeyAuthorityShape } from "./CollaborationEventAdmission.ts";

export type CollaborationPresenceErrorCode =
  | "invalid-request"
  | "not-found"
  | "resource-exhausted"
  | "conflict"
  | "slow-consumer"
  | "unavailable";

/** Public callers only receive a generic code; detailed admission state is not enumerable. */
export class CollaborationPresenceError extends Data.TaggedError("CollaborationPresenceError")<{
  readonly code: CollaborationPresenceErrorCode;
}> {}

export interface CollaborationPresenceAuditEvent {
  readonly operation: "open" | "heartbeat" | "close" | "snapshot" | "subscribe" | "sweep";
  readonly outcome: "accepted" | CollaborationPresenceErrorCode;
  readonly projectRef: string;
  readonly actorRef: string | null;
}

/** Metadata-only audit boundary: no paths, prompt text, provider output, or raw IDs. */
export interface CollaborationPresenceAuditSink {
  readonly record: (event: CollaborationPresenceAuditEvent) => Effect.Effect<void, unknown>;
}

/** A binding owns its queue; false means it must disconnect or resync the slow peer. */
export interface CollaborationPresenceConsumer {
  readonly offer: (update: CollaborationPresenceUpdate) => boolean;
}

export interface CollaborationPresenceSubscription {
  readonly unsubscribe: () => void;
}

export interface CollaborationPresenceOpenInput {
  readonly principal: unknown;
  readonly deviceKeyId: unknown;
  readonly request: unknown;
}

export interface CollaborationPresenceSessionInput {
  readonly principal: unknown;
  readonly deviceKeyId: unknown;
  readonly request: unknown;
}

export interface CollaborationPresenceSubscribeInput extends CollaborationPresenceSessionInput {
  readonly consumer: CollaborationPresenceConsumer;
}

export interface CollaborationPresenceOpenResult {
  readonly sessionId: typeof CollaborationPresenceSessionId.Type;
  readonly heartbeatIntervalMillis: number;
  readonly expiresAt: DateTime.Utc;
  readonly snapshot: CollaborationPresenceSnapshot;
}

export interface CollaborationPresenceAuthorityShape {
  readonly open: (
    input: CollaborationPresenceOpenInput,
  ) => Effect.Effect<CollaborationPresenceOpenResult, CollaborationPresenceError>;
  readonly heartbeat: (
    input: CollaborationPresenceSessionInput,
  ) => Effect.Effect<CollaborationPresenceSnapshot, CollaborationPresenceError>;
  readonly close: (
    input: CollaborationPresenceSessionInput,
  ) => Effect.Effect<void, CollaborationPresenceError>;
  readonly snapshot: (
    input: CollaborationPresenceSessionInput,
  ) => Effect.Effect<CollaborationPresenceSnapshot, CollaborationPresenceError>;
  readonly subscribe: (
    input: CollaborationPresenceSubscribeInput,
  ) => Effect.Effect<CollaborationPresenceSubscription, CollaborationPresenceError>;
  /** Call from membership/device revocation hooks to purge a whole project immediately. */
  readonly recheckProject: (
    sharedProjectId: SharedProjectId,
  ) => Effect.Effect<void, CollaborationPresenceError>;
  /** Timer-friendly expiry sweep; no timer or listener is started by this authority. */
  readonly sweepExpired: () => Effect.Effect<void, never>;
}

export class CollaborationPresenceAuthority extends Context.Service<
  CollaborationPresenceAuthority,
  CollaborationPresenceAuthorityShape
>()("cafecode/collaboration/CollaborationPresenceAuthority") {}

export interface CollaborationPresenceAuthorityOptions {
  readonly membershipAuthority: CollaborationMembershipAuthorityShape;
  readonly deviceKeyAuthority: CollaborationDeviceKeyAuthorityShape;
  readonly auditSink: CollaborationPresenceAuditSink;
  /** A process-local random secret used only to pseudonymize audit metadata. */
  readonly auditSecret: Uint8Array;
  readonly maxSessionsPerDevice?: number;
  readonly sessionTtlMillis?: number;
  readonly replayLimit?: number;
}

const decodeOpen = Schema.decodeUnknownEffect(CollaborationPresenceOpenRequest);
const decodeHeartbeat = Schema.decodeUnknownEffect(CollaborationPresenceHeartbeatRequest);
const decodeClose = Schema.decodeUnknownEffect(CollaborationPresenceCloseRequest);
const decodeSubscribe = Schema.decodeUnknownEffect(CollaborationPresenceSubscribeRequest);
const decodeDeviceKeyId = Schema.decodeUnknownEffect(CollaborationDeviceKeyId);
const decodeCapabilities = Schema.decodeUnknownEffect(CollaborationPresenceCapabilities);
const decodeGeneratedSessionId = Schema.decodeUnknownSync(CollaborationPresenceSessionId);

interface Session {
  readonly id: typeof CollaborationPresenceSessionId.Type;
  readonly principal: CollaborationPrincipal;
  readonly deviceKeyId: string;
  readonly openRequestId: string;
  entry: CollaborationPresenceRosterEntry;
  readonly heartbeatReceipts: Map<string, string>;
}

interface OpenReceipt {
  readonly sessionId: string;
  readonly fingerprint: string;
}

interface Subscriber {
  readonly sessionId: string;
  readonly consumer: CollaborationPresenceConsumer;
}

interface ProjectState {
  version: number;
  readonly sessions: Map<string, Session>;
  readonly openReceipts: Map<string, OpenReceipt>;
  readonly closeReceipts: Map<string, string>;
  readonly deltas: CollaborationPresenceDelta[];
  readonly subscribers: Map<number, Subscriber>;
}

function failure(code: CollaborationPresenceErrorCode): CollaborationPresenceError {
  return new CollaborationPresenceError({ code });
}

function isoRef(secret: Uint8Array, domain: string, value: string): string {
  return createHmac("sha256", secret)
    .update("cafecode-collaboration-presence-audit/v1\0")
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

function deviceReceiptKey(principal: CollaborationPrincipal, requestId: string): string {
  return `${principal.sharedProjectId}\0${principal.userId}\0${principal.deviceId}\0${requestId}`;
}

function requestFingerprint(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(`cafecode-collaboration-presence-${domain}/v1\0`)
    .update(JSON.stringify(value))
    .digest("hex");
}

function openFingerprint(request: typeof CollaborationPresenceOpenRequest.Type): string {
  return requestFingerprint("open", {
    sharedProjectId: request.sharedProjectId,
    state: request.state,
    capabilities: [...request.capabilities].toSorted(),
    supersedesSessionId: request.supersedesSessionId,
  });
}

function heartbeatFingerprint(request: typeof CollaborationPresenceHeartbeatRequest.Type): string {
  return requestFingerprint("heartbeat", {
    sharedProjectId: request.sharedProjectId,
    sessionId: request.sessionId,
    state: request.state,
    capabilities: [...request.capabilities].toSorted(),
  });
}

function sessionId(): typeof CollaborationPresenceSessionId.Type {
  return decodeGeneratedSessionId(randomBytes(32).toString("base64url"));
}

function snapshot(
  projectId: SharedProjectId,
  project: ProjectState,
  limit: number,
): CollaborationPresenceSnapshot {
  const entries = [...project.sessions.values()]
    .map((session) => session.entry)
    .toSorted((left, right) => left.sessionId.localeCompare(right.sessionId))
    .slice(0, limit);
  return { sharedProjectId: projectId, version: project.version, entries };
}

function copyRosterEntry(
  entry: CollaborationPresenceRosterEntry,
): CollaborationPresenceRosterEntry {
  return { ...entry, capabilities: [...entry.capabilities] };
}

function copySnapshot(value: CollaborationPresenceSnapshot): CollaborationPresenceSnapshot {
  return {
    ...value,
    entries: value.entries.map(copyRosterEntry),
  };
}

function copyDelta(value: CollaborationPresenceDelta): CollaborationPresenceDelta {
  return {
    ...value,
    upserts: value.upserts.map(copyRosterEntry),
    removedSessionIds: [...value.removedSessionIds],
  };
}

function copyUpdate(value: CollaborationPresenceUpdate): CollaborationPresenceUpdate {
  return value.kind === "snapshot"
    ? { kind: "snapshot", snapshot: copySnapshot(value.snapshot) }
    : { kind: "delta", delta: copyDelta(value.delta) };
}

/**
 * In-memory, server-authoritative presence. It deliberately has no network
 * listener, database table, durable activity feed, or UI dependency. A later
 * authenticated transport can supply the current server principal and call the
 * narrow methods below.
 */
export function makeCollaborationPresenceAuthority(
  options: CollaborationPresenceAuthorityOptions,
): CollaborationPresenceAuthorityShape {
  if (options.auditSecret.byteLength < 32) throw new Error("presence audit secret is too short");
  const maxSessions =
    options.maxSessionsPerDevice ?? COLLABORATION_PRESENCE_MAX_SESSIONS_PER_DEVICE;
  const ttlMillis = options.sessionTtlMillis ?? COLLABORATION_PRESENCE_SESSION_TTL_MILLIS;
  const replayLimit = options.replayLimit ?? COLLABORATION_PRESENCE_DELTA_REPLAY_MAX;
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1)
    throw new Error("presence session cap is invalid");
  if (
    !Number.isSafeInteger(ttlMillis) ||
    ttlMillis < COLLABORATION_PRESENCE_HEARTBEAT_INTERVAL_MILLIS
  )
    throw new Error("presence session ttl is invalid");
  if (!Number.isSafeInteger(replayLimit) || replayLimit < 1)
    throw new Error("presence replay limit is invalid");

  const projects = new Map<string, ProjectState>();
  let nextSubscriberId = 1;
  const projectFor = (id: SharedProjectId): ProjectState => {
    const existing = projects.get(id);
    if (existing) return existing;
    const created: ProjectState = {
      version: 0,
      sessions: new Map(),
      openReceipts: new Map(),
      closeReceipts: new Map(),
      deltas: [],
      subscribers: new Map(),
    };
    projects.set(id, created);
    return created;
  };
  const audit = (
    operation: CollaborationPresenceAuditEvent["operation"],
    outcome: CollaborationPresenceAuditEvent["outcome"],
    projectId: SharedProjectId,
    principal: CollaborationPrincipal | null,
  ) =>
    options.auditSink
      .record({
        operation,
        outcome,
        projectRef: isoRef(options.auditSecret, "project", projectId),
        actorRef: principal
          ? isoRef(
              options.auditSecret,
              "actor",
              `${projectId}\0${principal.userId}\0${principal.deviceId}`,
            )
          : null,
      })
      .pipe(Effect.catch(() => Effect.void));

  const authorize = (
    principal: unknown,
    deviceKeyId: unknown,
    projectId: SharedProjectId,
  ): Effect.Effect<CollaborationPrincipal, CollaborationPresenceError> =>
    Effect.gen(function* () {
      const grant = yield* authorizeCollaborationPermission({
        principal,
        targetProjectId: projectId,
        permission: "chat.read",
      }).pipe(
        Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
        Effect.mapError(() => failure("not-found")),
      );
      const decodedKey = yield* decodeDeviceKeyId(deviceKeyId).pipe(
        Effect.mapError(() => failure("not-found")),
      );
      const activeKey = yield* options.deviceKeyAuthority
        .getActiveEd25519PublicKey({
          sharedProjectId: projectId,
          userId: grant.principal.userId,
          deviceId: grant.principal.deviceId,
          deviceKeyId: decodedKey,
          membershipEpoch: grant.principal.membershipEpoch,
        })
        .pipe(Effect.mapError(() => failure("not-found")));
      if (activeKey === null) return yield* Effect.fail(failure("not-found"));
      return grant.principal;
    });

  const publish = (
    projectId: SharedProjectId,
    project: ProjectState,
    change: {
      readonly upserts?: ReadonlyArray<CollaborationPresenceRosterEntry>;
      readonly removed?: ReadonlyArray<typeof CollaborationPresenceSessionId.Type>;
    },
  ) => {
    project.version += 1;
    const delta: CollaborationPresenceDelta = {
      sharedProjectId: projectId,
      version: project.version as never,
      upserts: (change.upserts ?? []).map(copyRosterEntry),
      removedSessionIds: [...(change.removed ?? [])],
    };
    project.deltas.push(delta);
    if (project.deltas.length > replayLimit)
      project.deltas.splice(0, project.deltas.length - replayLimit);
    for (const [subscriberId, subscriber] of project.subscribers) {
      let accepted = false;
      try {
        accepted = subscriber.consumer.offer(copyUpdate({ kind: "delta", delta }));
      } catch {
        accepted = false;
      }
      if (!accepted) project.subscribers.delete(subscriberId);
    }
  };
  const remove = (
    projectId: SharedProjectId,
    project: ProjectState,
    id: typeof CollaborationPresenceSessionId.Type,
  ) => {
    if (!project.sessions.delete(id)) return;
    for (const [subscriberId, subscriber] of project.subscribers) {
      if (subscriber.sessionId === id) project.subscribers.delete(subscriberId);
    }
    publish(projectId, project, { removed: [id] });
  };
  const purge = (projectId: SharedProjectId, project: ProjectState, now: number) => {
    for (const session of project.sessions.values()) {
      if (DateTime.toEpochMillis(session.entry.expiresAt) <= now)
        remove(projectId, project, session.id);
    }
  };
  const checkSession = (
    principal: unknown,
    deviceKeyId: unknown,
    projectId: SharedProjectId,
    id: typeof CollaborationPresenceSessionId.Type,
    now?: number,
  ): Effect.Effect<
    { readonly project: ProjectState; readonly session: Session },
    CollaborationPresenceError
  > =>
    Effect.gen(function* () {
      const verified = yield* authorize(principal, deviceKeyId, projectId);
      const project = projects.get(projectId);
      if (!project) return yield* Effect.fail(failure("not-found"));
      if (now !== undefined) purge(projectId, project, now);
      const session = project.sessions.get(id);
      const decodedKey = yield* decodeDeviceKeyId(deviceKeyId).pipe(
        Effect.mapError(() => failure("not-found")),
      );
      if (
        !session ||
        session.principal.userId !== verified.userId ||
        session.principal.deviceId !== verified.deviceId ||
        session.principal.membershipEpoch !== verified.membershipEpoch ||
        session.deviceKeyId !== decodedKey
      ) {
        return yield* Effect.fail(failure("not-found"));
      }
      return { project, session };
    });

  const open: CollaborationPresenceAuthorityShape["open"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeOpen(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => failure("invalid-request")),
      );
      const deviceKeyId = yield* decodeDeviceKeyId(input.deviceKeyId).pipe(
        Effect.mapError(() => failure("not-found")),
      );
      const principal = yield* authorize(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
      );
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const project = projectFor(request.sharedProjectId);
      purge(request.sharedProjectId, project, now);
      const receiptKey = deviceReceiptKey(principal, request.requestId);
      const fingerprint = openFingerprint(request);
      const receipt = project.openReceipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) return yield* Effect.fail(failure("conflict"));
        const replayed = project.sessions.get(receipt.sessionId);
        if (replayed) {
          yield* audit("open", "accepted", request.sharedProjectId, principal);
          return {
            sessionId: replayed.id,
            heartbeatIntervalMillis: COLLABORATION_PRESENCE_HEARTBEAT_INTERVAL_MILLIS,
            expiresAt: replayed.entry.expiresAt,
            snapshot: copySnapshot(
              snapshot(
                request.sharedProjectId,
                project,
                COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT,
              ),
            ),
          };
        }
        return yield* Effect.fail(failure("conflict"));
      }
      if (request.supersedesSessionId !== null) {
        const superseded = project.sessions.get(request.supersedesSessionId);
        if (
          superseded &&
          superseded.principal.userId === principal.userId &&
          superseded.principal.deviceId === principal.deviceId
        ) {
          remove(request.sharedProjectId, project, superseded.id);
        }
      }
      const held = [...project.sessions.values()].filter(
        (session) =>
          session.principal.userId === principal.userId &&
          session.principal.deviceId === principal.deviceId,
      );
      if (held.length >= maxSessions) return yield* Effect.fail(failure("resource-exhausted"));
      if (project.sessions.size >= COLLABORATION_PRESENCE_ROSTER_MAX)
        return yield* Effect.fail(failure("resource-exhausted"));
      const expiresAt = DateTime.add(DateTime.makeUnsafe(now), { milliseconds: ttlMillis });
      let id = sessionId();
      while (project.sessions.has(id)) id = sessionId();
      const entry: CollaborationPresenceRosterEntry = {
        sessionId: id,
        userId: principal.userId,
        deviceId: principal.deviceId,
        membershipEpoch: principal.membershipEpoch,
        state: request.state,
        capabilities: yield* decodeCapabilities(request.capabilities, {
          onExcessProperty: "error",
        }).pipe(Effect.mapError(() => failure("invalid-request"))),
        expiresAt,
      };
      project.sessions.set(id, {
        id,
        principal,
        deviceKeyId,
        openRequestId: request.requestId,
        entry,
        heartbeatReceipts: new Map(),
      });
      project.openReceipts.set(receiptKey, { sessionId: id, fingerprint });
      while (project.openReceipts.size > 256)
        project.openReceipts.delete(project.openReceipts.keys().next().value!);
      publish(request.sharedProjectId, project, { upserts: [entry] });
      // Recheck after mutation so a just-revoked device never remains published.
      const rechecked = yield* authorize(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
      ).pipe(Effect.catch(() => Effect.succeed(null)));
      if (
        rechecked === null ||
        rechecked.userId !== principal.userId ||
        rechecked.deviceId !== principal.deviceId ||
        rechecked.membershipEpoch !== principal.membershipEpoch
      ) {
        remove(request.sharedProjectId, project, id);
        return yield* Effect.fail(failure("not-found"));
      }
      yield* audit("open", "accepted", request.sharedProjectId, principal);
      return {
        sessionId: id,
        heartbeatIntervalMillis: COLLABORATION_PRESENCE_HEARTBEAT_INTERVAL_MILLIS,
        expiresAt,
        snapshot: copySnapshot(
          snapshot(request.sharedProjectId, project, COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT),
        ),
      };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(cause instanceof CollaborationPresenceError ? cause : failure("unavailable")),
      ),
    );

  const heartbeat: CollaborationPresenceAuthorityShape["heartbeat"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeHeartbeat(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => failure("invalid-request")),
      );
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const checked = yield* checkSession(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
        request.sessionId,
        now,
      );
      const { project, session } = checked;
      const fingerprint = heartbeatFingerprint(request);
      const priorFingerprint = session.heartbeatReceipts.get(request.requestId);
      if (priorFingerprint !== undefined && priorFingerprint !== fingerprint)
        return yield* Effect.fail(failure("conflict"));
      if (priorFingerprint === undefined) {
        session.heartbeatReceipts.set(request.requestId, fingerprint);
        while (session.heartbeatReceipts.size > 64)
          session.heartbeatReceipts.delete(session.heartbeatReceipts.keys().next().value!);
        session.entry = {
          ...session.entry,
          state: request.state,
          capabilities: request.capabilities,
          expiresAt: DateTime.add(DateTime.makeUnsafe(now), { milliseconds: ttlMillis }),
        };
        publish(request.sharedProjectId, project, { upserts: [session.entry] });
        const rechecked = yield* authorize(
          input.principal,
          input.deviceKeyId,
          request.sharedProjectId,
        ).pipe(Effect.catch(() => Effect.succeed(null)));
        if (
          rechecked === null ||
          rechecked.userId !== session.principal.userId ||
          rechecked.deviceId !== session.principal.deviceId ||
          rechecked.membershipEpoch !== session.principal.membershipEpoch
        ) {
          remove(request.sharedProjectId, project, session.id);
          return yield* Effect.fail(failure("not-found"));
        }
      }
      yield* audit("heartbeat", "accepted", request.sharedProjectId, session.principal);
      return copySnapshot(
        snapshot(request.sharedProjectId, project, COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT),
      );
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(cause instanceof CollaborationPresenceError ? cause : failure("unavailable")),
      ),
    );

  const close: CollaborationPresenceAuthorityShape["close"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeClose(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => failure("invalid-request")),
      );
      const principal = yield* authorize(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
      );
      const project = projects.get(request.sharedProjectId);
      if (!project) return yield* Effect.fail(failure("not-found"));
      const receiptKey = deviceReceiptKey(principal, request.requestId);
      const priorSessionId = project.closeReceipts.get(receiptKey);
      if (priorSessionId !== undefined) {
        if (priorSessionId !== request.sessionId) return yield* Effect.fail(failure("conflict"));
        yield* audit("close", "accepted", request.sharedProjectId, principal);
        return;
      }
      const { session } = yield* checkSession(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
        request.sessionId,
      );
      remove(request.sharedProjectId, project, session.id);
      project.closeReceipts.set(receiptKey, request.sessionId);
      while (project.closeReceipts.size > 256)
        project.closeReceipts.delete(project.closeReceipts.keys().next().value!);
      yield* audit("close", "accepted", request.sharedProjectId, session.principal);
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(cause instanceof CollaborationPresenceError ? cause : failure("unavailable")),
      ),
    );

  const snapshotFor: CollaborationPresenceAuthorityShape["snapshot"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeSubscribe(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => failure("invalid-request")),
      );
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const { project, session } = yield* checkSession(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
        request.sessionId,
        now,
      );
      yield* audit("snapshot", "accepted", request.sharedProjectId, session.principal);
      return copySnapshot(
        snapshot(
          request.sharedProjectId,
          project,
          request.rosterLimit ?? COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT,
        ),
      );
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(cause instanceof CollaborationPresenceError ? cause : failure("unavailable")),
      ),
    );

  const subscribe: CollaborationPresenceAuthorityShape["subscribe"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeSubscribe(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => failure("invalid-request")),
      );
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const { project, session } = yield* checkSession(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
        request.sessionId,
        now,
      );
      const limit = request.rosterLimit ?? COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT;
      const retained = project.deltas.filter((delta) => delta.version > request.afterVersion);
      const mustResync =
        request.afterVersion > project.version ||
        (retained[0]?.version ?? project.version + 1) > request.afterVersion + 1;
      const initial: CollaborationPresenceUpdate =
        mustResync || retained.length === 0
          ? {
              kind: "snapshot",
              snapshot: copySnapshot(snapshot(request.sharedProjectId, project, limit)),
            }
          : { kind: "delta", delta: retained[0]! };
      const offer = (update: CollaborationPresenceUpdate): boolean => {
        try {
          return input.consumer.offer(copyUpdate(update));
        } catch {
          return false;
        }
      };
      if (!offer(initial)) return yield* Effect.fail(failure("slow-consumer"));
      if (!mustResync) {
        for (const delta of retained.slice(1)) {
          if (!offer({ kind: "delta", delta })) return yield* Effect.fail(failure("slow-consumer"));
        }
      }
      if (!Number.isSafeInteger(nextSubscriberId) || nextSubscriberId >= Number.MAX_SAFE_INTEGER)
        return yield* Effect.fail(failure("resource-exhausted"));
      const subscriberId = nextSubscriberId++;
      project.subscribers.set(subscriberId, { sessionId: session.id, consumer: input.consumer });
      const rechecked = yield* authorize(
        input.principal,
        input.deviceKeyId,
        request.sharedProjectId,
      ).pipe(Effect.catch(() => Effect.succeed(null)));
      if (
        rechecked === null ||
        rechecked.userId !== session.principal.userId ||
        rechecked.deviceId !== session.principal.deviceId ||
        rechecked.membershipEpoch !== session.principal.membershipEpoch ||
        !project.sessions.has(session.id)
      ) {
        project.subscribers.delete(subscriberId);
        return yield* Effect.fail(failure("not-found"));
      }
      yield* audit("subscribe", "accepted", request.sharedProjectId, session.principal);
      return { unsubscribe: () => project.subscribers.delete(subscriberId) };
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(cause instanceof CollaborationPresenceError ? cause : failure("unavailable")),
      ),
    );

  const recheckProject: CollaborationPresenceAuthorityShape["recheckProject"] = (projectId) =>
    Effect.gen(function* () {
      const project = projects.get(projectId);
      if (!project) return;
      for (const session of project.sessions.values()) {
        const current = yield* authorize(session.principal, session.deviceKeyId, projectId).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        if (current === null) remove(projectId, project, session.id);
      }
      yield* audit("sweep", "accepted", projectId, null);
    }).pipe(Effect.catch(() => Effect.fail(failure("unavailable"))));

  const sweepExpired: CollaborationPresenceAuthorityShape["sweepExpired"] = () =>
    Effect.gen(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      for (const [id, project] of projects) purge(id as SharedProjectId, project, now);
    });

  return { open, heartbeat, close, snapshot: snapshotFor, subscribe, recheckProject, sweepExpired };
}
