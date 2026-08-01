import type {
  CollaborationAppendAuthoredMessageRequest,
  CollaborationAuthoredMessage,
  CollaborationContextPacket,
  CollaborationCreateContextPacketRequest,
  CollaborationCurrentDeviceKeyStatus,
  CollaborationDeviceKeyMutationResult,
  CollaborationDeviceKeyId,
  CollaborationPermission,
  CollaborationPrincipal,
  CollaborationTombstoneAuthoredMessageRequest,
  CollaborationTransportCursor,
  CollaborationTransportOperation,
  CollaborationTransportPage,
  CollaborationTransportReplayResult,
  SharedProjectId,
} from "@cafecode/contracts";
import {
  COLLABORATION_TRANSPORT_PROJECT_MAX_CONCURRENCY,
  COLLABORATION_TRANSPORT_REPLAY_MAX_BATCHES,
  COLLABORATION_TRANSPORT_REPLAY_MAX_MESSAGES,
  COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES,
  COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES,
  CollaborationAppendAuthoredMessageRequest as AppendRequestSchema,
  CollaborationAuthoredMessagePage as StoredPageSchema,
  CollaborationCreateContextPacketRequest as ContextRequestSchema,
  CollaborationDeviceKeyId as DeviceKeyIdSchema,
  CollaborationTombstoneAuthoredMessageRequest as TombstoneRequestSchema,
  CollaborationTransportCursor as CursorSchema,
  CollaborationTransportDeviceKeyRevokeRequest as DeviceKeyRevokeRequestSchema,
  CollaborationTransportDeviceKeyRevokeResponse as DeviceKeyRevokeResponseSchema,
  CollaborationTransportDeviceKeyStatusRequest as DeviceKeyStatusRequestSchema,
  CollaborationTransportDeviceKeyStatusResponse as DeviceKeyStatusResponseSchema,
  CollaborationTransportPage as PageSchema,
  CollaborationTransportPageRequest as PageRequestSchema,
  CollaborationTransportReplayRequest as ReplayRequestSchema,
  CollaborationTransportReplayResult as ReplayResultSchema,
} from "@cafecode/contracts";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  authorizeCollaborationPermission,
  type CollaborationMembershipAuthorityShape,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";
import {
  type CollaborationAuthoredMessageStoreError,
  type CollaborationAuthoredMessageStoreShape,
} from "./CollaborationAuthoredMessageStore.ts";
import type { CollaborationDeviceKeyAuthorityShape } from "./CollaborationEventAdmission.ts";
import type {
  CollaborationDeviceKeyStoreError,
  CollaborationDeviceKeyStoreShape,
} from "./CollaborationDeviceKeyStore.ts";

const CURSOR_DOMAIN = "club-code/cowork-transport-cursor/v1\0";
const CURSOR_VERSION = 1;
const CURSOR_IV_BYTES = 12;
const CURSOR_TAG_BYTES = 16;
const DEFAULT_REPLAY_BATCH_LIMIT = 64;

export type CollaborationTransportErrorCode =
  | "invalid-request"
  | "not-found"
  | "conflict"
  | "resource-exhausted"
  | "cancelled"
  | "slow-consumer"
  | "unavailable";

export class CollaborationTransportError extends Data.TaggedError("CollaborationTransportError")<{
  readonly operation: CollaborationTransportOperation;
  readonly code: CollaborationTransportErrorCode;
}> {}

/** Resolver output is server-owned and never decoded from a command payload. */
export interface CollaborationTransportResolvedPrincipal {
  readonly principal: CollaborationPrincipal;
  readonly deviceKeyId: CollaborationDeviceKeyId;
}

/**
 * Authentication boundary supplied by a later HTTP/WebSocket binding.
 * Implementations verify the server session and device signature before
 * returning a principal. The facade never accepts a principal from payloads.
 */
export interface CollaborationTransportPrincipalResolver {
  readonly resolve: (input: {
    readonly authentication: unknown;
    readonly targetProjectId: SharedProjectId;
    readonly operation: CollaborationTransportOperation;
    readonly signal: AbortSignal | undefined;
  }) => Effect.Effect<CollaborationTransportResolvedPrincipal, unknown>;
}

export interface CollaborationTransportAuditEvent {
  readonly operation: CollaborationTransportOperation;
  readonly outcome: "accepted" | CollaborationTransportErrorCode;
  readonly projectRef: string;
  readonly actorRef: string | null;
  readonly requestBytes: number;
  readonly responseBytes: number;
}

/** Metadata-only sink. Its event type cannot carry prompts, bodies, tokens, or paths. */
export interface CollaborationTransportAuditSink {
  readonly record: (event: CollaborationTransportAuditEvent) => Effect.Effect<void, unknown>;
}

export interface CollaborationTransportReplayConsumer {
  /**
   * Non-blocking offer into the binding's bounded outbound queue. False means
   * full. Network I/O must happen outside this call so a slow peer cannot hold
   * a project admission slot indefinitely.
   */
  readonly offer: (page: CollaborationTransportPage) => boolean;
}

export interface CollaborationTransportInput {
  readonly authentication: unknown;
  readonly request: unknown;
  readonly signal?: AbortSignal;
}

export interface CollaborationTransportFacadeShape {
  readonly append: (
    input: CollaborationTransportInput,
  ) => Effect.Effect<CollaborationAuthoredMessage, CollaborationTransportError>;
  readonly tombstone: (
    input: CollaborationTransportInput,
  ) => Effect.Effect<CollaborationAuthoredMessage, CollaborationTransportError>;
  readonly page: (
    input: CollaborationTransportInput,
  ) => Effect.Effect<CollaborationTransportPage, CollaborationTransportError>;
  readonly createContextPacket: (
    input: CollaborationTransportInput,
  ) => Effect.Effect<CollaborationContextPacket, CollaborationTransportError>;
  readonly replaySubscription: (
    input: CollaborationTransportInput & {
      readonly consumer: CollaborationTransportReplayConsumer;
    },
  ) => Effect.Effect<CollaborationTransportReplayResult, CollaborationTransportError>;
  readonly getCurrentDeviceKeyStatus: (
    input: CollaborationTransportInput,
  ) => Effect.Effect<CollaborationCurrentDeviceKeyStatus, CollaborationTransportError>;
  readonly revokeCurrentDeviceKey: (
    input: CollaborationTransportInput,
  ) => Effect.Effect<CollaborationDeviceKeyMutationResult, CollaborationTransportError>;
}

export class CollaborationTransportFacade extends Context.Service<
  CollaborationTransportFacade,
  CollaborationTransportFacadeShape
>()("cafecode/collaboration/CollaborationTransportFacade") {}

export interface CollaborationTransportFacadeOptions {
  readonly principalResolver: CollaborationTransportPrincipalResolver;
  readonly membershipAuthority: CollaborationMembershipAuthorityShape;
  readonly deviceKeyAuthority: CollaborationDeviceKeyAuthorityShape;
  readonly deviceKeyStore: CollaborationDeviceKeyStoreShape;
  readonly messageStore: CollaborationAuthoredMessageStoreShape;
  readonly auditSink: CollaborationTransportAuditSink;
  /** At least 32 random bytes from server-owned configuration. */
  readonly cursorSecret: Uint8Array;
  readonly maxProjectConcurrency?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}

const decodeAppend = Schema.decodeUnknownEffect(AppendRequestSchema);
const decodeTombstone = Schema.decodeUnknownEffect(TombstoneRequestSchema);
const decodeContext = Schema.decodeUnknownEffect(ContextRequestSchema);
const decodePageRequest = Schema.decodeUnknownEffect(PageRequestSchema);
const decodeReplayRequest = Schema.decodeUnknownEffect(ReplayRequestSchema);
const decodeDeviceKeyStatusRequest = Schema.decodeUnknownEffect(DeviceKeyStatusRequestSchema);
const decodeDeviceKeyRevokeRequest = Schema.decodeUnknownEffect(DeviceKeyRevokeRequestSchema);
const encodeStoredPage = Schema.encodeUnknownEffect(StoredPageSchema);
const decodeDeviceKeyId = Schema.decodeUnknownEffect(DeviceKeyIdSchema);
const decodeCursor = Schema.decodeUnknownSync(CursorSchema);
const decodePage = Schema.decodeUnknownEffect(PageSchema);
const decodeReplayResult = Schema.decodeUnknownEffect(ReplayResultSchema);
const decodeDeviceKeyStatusResponse = Schema.decodeUnknownEffect(DeviceKeyStatusResponseSchema);
const decodeDeviceKeyRevokeResponse = Schema.decodeUnknownEffect(DeviceKeyRevokeResponseSchema);

function error(
  operation: CollaborationTransportOperation,
  code: CollaborationTransportErrorCode,
): CollaborationTransportError {
  return new CollaborationTransportError({ operation, code });
}

function byteLength(value: unknown): number | null {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? null : new TextEncoder().encode(encoded).byteLength;
  } catch {
    return null;
  }
}

function stableRef(key: Uint8Array, domain: string, value: string): string {
  return createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

class ProjectAdmission {
  readonly #active = new Map<string, number>();
  readonly maximum: number;

  constructor(maximum: number) {
    this.maximum = maximum;
  }

  acquire(projectId: SharedProjectId): (() => void) | null {
    const active = this.#active.get(projectId) ?? 0;
    if (active >= this.maximum) return null;
    this.#active.set(projectId, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.#active.get(projectId) ?? 1;
      if (current <= 1) this.#active.delete(projectId);
      else this.#active.set(projectId, current - 1);
    };
  }
}

function makeCursorCodec(secret: Uint8Array) {
  if (secret.byteLength < 32) throw new Error("collaboration transport cursor secret is too short");
  const key = createHash("sha256").update(CURSOR_DOMAIN).update(secret).digest();

  const encode = (projectId: SharedProjectId, sequence: number): CollaborationTransportCursor => {
    const iv = randomBytes(CURSOR_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify([CURSOR_VERSION, projectId, sequence]), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return decodeCursor(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url"));
  };

  const decode = (
    projectId: SharedProjectId,
    cursor: CollaborationTransportCursor,
  ): number | null => {
    try {
      const bytes = Buffer.from(cursor, "base64url");
      if (
        bytes.toString("base64url") !== cursor ||
        bytes.byteLength <= CURSOR_IV_BYTES + CURSOR_TAG_BYTES
      )
        return null;
      const iv = bytes.subarray(0, CURSOR_IV_BYTES);
      const tag = bytes.subarray(CURSOR_IV_BYTES, CURSOR_IV_BYTES + CURSOR_TAG_BYTES);
      const ciphertext = bytes.subarray(CURSOR_IV_BYTES + CURSOR_TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const parsed: unknown = JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
      );
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 3 ||
        parsed[0] !== CURSOR_VERSION ||
        parsed[1] !== projectId ||
        !Number.isSafeInteger(parsed[2]) ||
        parsed[2] < 0
      )
        return null;
      return parsed[2];
    } catch {
      return null;
    }
  };
  return { encode, decode };
}

function cancellation(
  operation: CollaborationTransportOperation,
  signal: AbortSignal | undefined,
): Effect.Effect<never, CollaborationTransportError> {
  return Effect.callback<never, CollaborationTransportError>((resume) => {
    if (signal?.aborted) {
      resume(Effect.fail(error(operation, "cancelled")));
      return;
    }
    if (!signal) return;
    const onAbort = () => resume(Effect.fail(error(operation, "cancelled")));
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });
}

function withCancellation<A, E>(
  operation: CollaborationTransportOperation,
  signal: AbortSignal | undefined,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E | CollaborationTransportError> {
  if (!signal) return effect;
  return Effect.raceFirst(effect, cancellation(operation, signal)) as Effect.Effect<
    A,
    E | CollaborationTransportError
  >;
}

function mapStoreFailure(
  operation: CollaborationTransportOperation,
  cause: CollaborationAuthoredMessageStoreError,
): CollaborationTransportError {
  switch (cause.reason) {
    case "invalid-request":
      return error(operation, "invalid-request");
    case "idempotency-conflict":
      return error(operation, "conflict");
    case "context-budget-exceeded":
      return error(operation, "resource-exhausted");
    case "access-denied":
    case "not-found":
    case "context-source-revoked":
      return error(operation, "not-found");
    case "integrity-failure":
    case "storage-unavailable":
      return error(operation, "unavailable");
  }
}

function mapDeviceKeyStoreFailure(
  operation: "device-key.status" | "device-key.revoke",
  cause: CollaborationDeviceKeyStoreError,
): CollaborationTransportError {
  switch (cause.reason) {
    case "invalid-input":
      return error(operation, "invalid-request");
    case "command-conflict":
    case "device-key-not-active":
      return error(operation, "conflict");
    case "unauthenticated":
    case "project-mismatch":
    case "membership-unavailable":
    case "membership-epoch-mismatch":
    case "member-not-found":
    case "device-identity-conflict":
    case "device-key-not-found":
      return error(operation, "not-found");
    case "challenge-not-found":
    case "challenge-expired":
    case "challenge-consumed":
    case "challenge-mismatch":
    case "proof-invalid":
    case "stored-corruption":
    case "storage-failure":
      return error(operation, "unavailable");
  }
}

function projectPermissions(
  operation: CollaborationTransportOperation,
  request: {
    readonly kind?: "operator-chat" | "authored-prompt";
    readonly targetKind?: "operator-chat" | "authored-prompt";
    readonly kinds?: ReadonlyArray<"operator-chat" | "authored-prompt">;
    readonly selection?: {
      readonly sourceKinds: ReadonlyArray<"operator-chat" | "authored-prompt">;
    };
  },
): ReadonlyArray<CollaborationPermission> {
  if (operation === "device-key.status" || operation === "device-key.revoke") return [];
  const kinds = request.kinds ??
    request.selection?.sourceKinds ?? [request.kind ?? request.targetKind!];
  const suffix =
    operation === "message.page" ||
    operation === "message.subscribe-replay" ||
    operation === "context.create"
      ? "read"
      : "append";
  return [
    ...new Set(
      kinds.map(
        (kind) =>
          (kind === "operator-chat"
            ? `chat.${suffix}`
            : `transcript.${suffix}`) as CollaborationPermission,
      ),
    ),
  ];
}

export function makeCollaborationTransportFacade(
  options: CollaborationTransportFacadeOptions,
): CollaborationTransportFacadeShape {
  const maximum = options.maxProjectConcurrency ?? COLLABORATION_TRANSPORT_PROJECT_MAX_CONCURRENCY;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new Error("collaboration transport project concurrency must be positive");
  const admission = new ProjectAdmission(maximum);
  const cursorCodec = makeCursorCodec(options.cursorSecret);
  const auditRefKey = createHash("sha256")
    .update("club-code/cowork-transport-audit-ref/v1\0")
    .update(options.cursorSecret)
    .digest();
  const requestLimit = options.maxRequestBytes ?? COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES;
  const responseLimit = options.maxResponseBytes ?? COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES;
  if (!Number.isSafeInteger(requestLimit) || requestLimit < 1)
    throw new Error("collaboration transport request limit must be positive");
  if (!Number.isSafeInteger(responseLimit) || responseLimit < 1)
    throw new Error("collaboration transport response limit must be positive");

  const audit = (
    operation: CollaborationTransportOperation,
    outcome: "accepted" | CollaborationTransportErrorCode,
    projectId: SharedProjectId,
    actor: CollaborationTransportResolvedPrincipal | null,
    requestBytes: number,
    responseBytes: number,
  ) =>
    options.auditSink
      .record({
        operation,
        outcome,
        projectRef: stableRef(auditRefKey, "project", projectId),
        actorRef: actor
          ? stableRef(
              auditRefKey,
              "actor",
              `${actor.principal.userId}\0${actor.principal.deviceId}`,
            )
          : null,
        requestBytes,
        responseBytes,
      })
      .pipe(Effect.catch(() => Effect.void));

  const authorize = (
    operation: CollaborationTransportOperation,
    authentication: unknown,
    projectId: SharedProjectId,
    permissions: ReadonlyArray<CollaborationPermission>,
    signal: AbortSignal | undefined,
    requireActiveDeviceKey = true,
  ): Effect.Effect<CollaborationTransportResolvedPrincipal, CollaborationTransportError> =>
    Effect.gen(function* () {
      const resolved = yield* options.principalResolver
        .resolve({ authentication, targetProjectId: projectId, operation, signal })
        .pipe(Effect.mapError(() => error(operation, "not-found")));
      const deviceKeyId = yield* decodeDeviceKeyId(resolved.deviceKeyId, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => error(operation, "not-found")));
      for (const permission of permissions) {
        yield* authorizeCollaborationPermission({
          principal: resolved.principal,
          targetProjectId: projectId,
          permission,
        }).pipe(
          Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
          Effect.mapError(() => error(operation, "not-found")),
        );
      }
      if (!requireActiveDeviceKey) return { principal: resolved.principal, deviceKeyId };
      const key = yield* options.deviceKeyAuthority
        .getActiveEd25519PublicKey({
          sharedProjectId: projectId,
          userId: resolved.principal.userId,
          deviceId: resolved.principal.deviceId,
          deviceKeyId,
          membershipEpoch: resolved.principal.membershipEpoch,
        })
        .pipe(Effect.mapError(() => error(operation, "not-found")));
      if (key === null) return yield* Effect.fail(error(operation, "not-found"));
      return { principal: resolved.principal, deviceKeyId };
    });

  const revalidate = (
    operation: CollaborationTransportOperation,
    resolved: CollaborationTransportResolvedPrincipal,
    projectId: SharedProjectId,
    permissions: ReadonlyArray<CollaborationPermission>,
    requireActiveDeviceKey = true,
  ) =>
    // Revalidation directly checks the already server-issued identity. The
    // resolver is intentionally not called with invented authentication data.
    Effect.gen(function* () {
      for (const permission of permissions) {
        yield* authorizeCollaborationPermission({
          principal: resolved.principal,
          targetProjectId: projectId,
          permission,
        }).pipe(
          Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
          Effect.mapError(() => error(operation, "not-found")),
        );
      }
      if (!requireActiveDeviceKey) return;
      const key = yield* options.deviceKeyAuthority
        .getActiveEd25519PublicKey({
          sharedProjectId: projectId,
          userId: resolved.principal.userId,
          deviceId: resolved.principal.deviceId,
          deviceKeyId: resolved.deviceKeyId,
          membershipEpoch: resolved.principal.membershipEpoch,
        })
        .pipe(Effect.mapError(() => error(operation, "not-found")));
      if (key === null) return yield* Effect.fail(error(operation, "not-found"));
    });

  const execute = <A>(input: {
    readonly operation: CollaborationTransportOperation;
    readonly transport: CollaborationTransportInput;
    readonly projectId: SharedProjectId;
    readonly permissions: ReadonlyArray<CollaborationPermission>;
    readonly authorizeDeviceKey?: boolean;
    readonly revalidateDeviceKey?: boolean;
    readonly run: (
      resolved: CollaborationTransportResolvedPrincipal,
    ) => Effect.Effect<A, CollaborationTransportError>;
  }): Effect.Effect<A, CollaborationTransportError> => {
    const requestBytes = byteLength({
      authentication: input.transport.authentication,
      request: input.transport.request,
    });
    if (requestBytes === null) return Effect.fail(error(input.operation, "invalid-request"));
    if (requestBytes > requestLimit)
      return Effect.fail(error(input.operation, "resource-exhausted"));
    return Effect.gen(function* () {
      if (input.transport.signal?.aborted)
        return yield* Effect.fail(error(input.operation, "cancelled"));
      const release = admission.acquire(input.projectId);
      if (release === null) return yield* Effect.fail(error(input.operation, "resource-exhausted"));
      let actor: CollaborationTransportResolvedPrincipal | null = null;
      const admitted = Effect.gen(function* () {
        actor = yield* withCancellation(
          input.operation,
          input.transport.signal,
          authorize(
            input.operation,
            input.transport.authentication,
            input.projectId,
            input.permissions,
            input.transport.signal,
            input.authorizeDeviceKey,
          ),
        );
        const result = yield* withCancellation(
          input.operation,
          input.transport.signal,
          input.run(actor),
        );
        yield* revalidate(
          input.operation,
          actor,
          input.projectId,
          input.permissions,
          input.revalidateDeviceKey,
        );
        const responseBytes = byteLength(result) ?? responseLimit + 1;
        if (responseBytes > responseLimit)
          return yield* Effect.fail(error(input.operation, "resource-exhausted"));
        return { result, responseBytes };
      });
      return yield* admitted.pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            audit(input.operation, failure.code, input.projectId, actor, requestBytes, 0).pipe(
              Effect.andThen(Effect.fail(failure)),
            ),
          onSuccess: ({ result, responseBytes }) =>
            audit(
              input.operation,
              "accepted",
              input.projectId,
              actor,
              requestBytes,
              responseBytes,
            ).pipe(Effect.as(result)),
        }),
        Effect.ensuring(Effect.sync(release)),
      );
    });
  };

  const checkFrame = (
    operation: CollaborationTransportOperation,
    input: CollaborationTransportInput,
  ): Effect.Effect<void, CollaborationTransportError> => {
    const bytes = byteLength({ authentication: input.authentication, request: input.request });
    if (bytes === null) return Effect.fail(error(operation, "invalid-request"));
    return bytes > requestLimit ? Effect.fail(error(operation, "resource-exhausted")) : Effect.void;
  };

  const append: CollaborationTransportFacadeShape["append"] = (input) =>
    Effect.gen(function* () {
      yield* checkFrame("message.append", input);
      const request = yield* decodeAppend(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => error("message.append", "invalid-request")),
      );
      return yield* execute({
        operation: "message.append",
        transport: input,
        projectId: request.sharedProjectId,
        permissions: projectPermissions("message.append", request),
        run: (resolved) =>
          options.messageStore
            .append({
              principal: resolved.principal,
              command: request as CollaborationAppendAuthoredMessageRequest,
            })
            .pipe(
              Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
              Effect.mapError((cause) => mapStoreFailure("message.append", cause)),
            ),
      });
    });

  const tombstone: CollaborationTransportFacadeShape["tombstone"] = (input) =>
    Effect.gen(function* () {
      yield* checkFrame("message.tombstone", input);
      const request = yield* decodeTombstone(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => error("message.tombstone", "invalid-request")),
      );
      return yield* execute({
        operation: "message.tombstone",
        transport: input,
        projectId: request.sharedProjectId,
        permissions: projectPermissions("message.tombstone", request),
        run: (resolved) =>
          options.messageStore
            .tombstone({
              principal: resolved.principal,
              command: request as CollaborationTombstoneAuthoredMessageRequest,
            })
            .pipe(
              Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
              Effect.mapError((cause) => mapStoreFailure("message.tombstone", cause)),
            ),
      });
    });

  const page: CollaborationTransportFacadeShape["page"] = (input) =>
    Effect.gen(function* () {
      yield* checkFrame("message.page", input);
      const request = yield* decodePageRequest(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => error("message.page", "invalid-request")),
      );
      const afterSequence =
        request.cursor === null ? 0 : cursorCodec.decode(request.sharedProjectId, request.cursor);
      if (afterSequence === null) return yield* Effect.fail(error("message.page", "not-found"));
      const permissions = projectPermissions("message.page", request);
      return yield* execute({
        operation: "message.page",
        transport: input,
        projectId: request.sharedProjectId,
        permissions,
        run: (resolved) =>
          Effect.gen(function* () {
            const stored = yield* options.messageStore
              .page({
                principal: resolved.principal,
                request: {
                  sharedProjectId: request.sharedProjectId,
                  afterSequence,
                  limit: request.limit,
                  kinds: request.kinds,
                },
              })
              .pipe(
                Effect.provideService(
                  CollaborationMembershipAuthority,
                  options.membershipAuthority,
                ),
                Effect.mapError((cause) => mapStoreFailure("message.page", cause)),
              );
            const encodedStored = yield* encodeStoredPage(stored, {
              onExcessProperty: "error",
            }).pipe(Effect.mapError(() => error("message.page", "unavailable")));
            return yield* decodePage(
              {
                ...encodedStored,
                nextCursor: cursorCodec.encode(request.sharedProjectId, stored.nextCursor),
              },
              { onExcessProperty: "error" },
            ).pipe(Effect.mapError(() => error("message.page", "unavailable")));
          }),
      });
    });

  const createContextPacket: CollaborationTransportFacadeShape["createContextPacket"] = (input) =>
    Effect.gen(function* () {
      yield* checkFrame("context.create", input);
      const request = yield* decodeContext(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => error("context.create", "invalid-request")),
      );
      return yield* execute({
        operation: "context.create",
        transport: input,
        projectId: request.sharedProjectId,
        permissions: projectPermissions("context.create", request),
        run: (resolved) =>
          options.messageStore
            .createContextPacket({
              principal: resolved.principal,
              command: request as CollaborationCreateContextPacketRequest,
            })
            .pipe(
              Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
              Effect.mapError((cause) => mapStoreFailure("context.create", cause)),
            ),
      });
    });

  const replaySubscription: CollaborationTransportFacadeShape["replaySubscription"] = (input) =>
    Effect.gen(function* () {
      yield* checkFrame("message.subscribe-replay", input);
      const request = yield* decodeReplayRequest(input.request, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => error("message.subscribe-replay", "invalid-request")));
      const initialSequence =
        request.cursor === null ? 0 : cursorCodec.decode(request.sharedProjectId, request.cursor);
      if (initialSequence === null)
        return yield* Effect.fail(error("message.subscribe-replay", "not-found"));
      const permissions = projectPermissions("message.subscribe-replay", request);
      return yield* execute({
        operation: "message.subscribe-replay",
        transport: input,
        projectId: request.sharedProjectId,
        permissions,
        run: (resolved) =>
          Effect.gen(function* () {
            let sequence = initialSequence;
            let deliveredBatches = 0;
            let deliveredMessages = 0;
            let caughtUp = false;
            const maxBatches = request.maxBatches ?? COLLABORATION_TRANSPORT_REPLAY_MAX_BATCHES;
            const batchLimit = request.batchLimit ?? DEFAULT_REPLAY_BATCH_LIMIT;
            while (deliveredBatches < maxBatches && !caughtUp) {
              if (input.signal?.aborted)
                return yield* Effect.fail(error("message.subscribe-replay", "cancelled"));
              yield* revalidate(
                "message.subscribe-replay",
                resolved,
                request.sharedProjectId,
                permissions,
              );
              const stored = yield* options.messageStore
                .page({
                  principal: resolved.principal,
                  request: {
                    sharedProjectId: request.sharedProjectId,
                    afterSequence: sequence,
                    limit: batchLimit,
                    kinds: request.kinds,
                  },
                })
                .pipe(
                  Effect.provideService(
                    CollaborationMembershipAuthority,
                    options.membershipAuthority,
                  ),
                  Effect.mapError((cause) => mapStoreFailure("message.subscribe-replay", cause)),
                );
              const transportPage = yield* decodePage(
                {
                  ...(yield* encodeStoredPage(stored, { onExcessProperty: "error" }).pipe(
                    Effect.mapError(() => error("message.subscribe-replay", "unavailable")),
                  )),
                  nextCursor: cursorCodec.encode(request.sharedProjectId, stored.nextCursor),
                },
                { onExcessProperty: "error" },
              ).pipe(Effect.mapError(() => error("message.subscribe-replay", "unavailable")));
              if ((byteLength(transportPage) ?? responseLimit + 1) > responseLimit)
                return yield* Effect.fail(error("message.subscribe-replay", "resource-exhausted"));
              if (
                deliveredMessages + stored.messages.length >
                COLLABORATION_TRANSPORT_REPLAY_MAX_MESSAGES
              )
                return yield* Effect.fail(error("message.subscribe-replay", "resource-exhausted"));
              yield* revalidate(
                "message.subscribe-replay",
                resolved,
                request.sharedProjectId,
                permissions,
              );
              const accepted = yield* Effect.try({
                try: () => input.consumer.offer(transportPage),
                catch: () => error("message.subscribe-replay", "slow-consumer"),
              });
              if (!accepted)
                return yield* Effect.fail(error("message.subscribe-replay", "slow-consumer"));
              deliveredBatches += 1;
              deliveredMessages += stored.messages.length;
              sequence = stored.nextCursor;
              caughtUp = !stored.hasMore;
            }
            return yield* decodeReplayResult(
              {
                sharedProjectId: request.sharedProjectId,
                deliveredBatches,
                deliveredMessages,
                nextCursor: cursorCodec.encode(request.sharedProjectId, sequence),
                caughtUp,
              },
              { onExcessProperty: "error" },
            ).pipe(Effect.mapError(() => error("message.subscribe-replay", "unavailable")));
          }),
      });
    });

  const getCurrentDeviceKeyStatus: CollaborationTransportFacadeShape["getCurrentDeviceKeyStatus"] =
    (input) =>
      Effect.gen(function* () {
        yield* checkFrame("device-key.status", input);
        const request = yield* decodeDeviceKeyStatusRequest(input.request, {
          onExcessProperty: "error",
        }).pipe(Effect.mapError(() => error("device-key.status", "invalid-request")));
        return yield* execute({
          operation: "device-key.status",
          transport: input,
          projectId: request.sharedProjectId,
          permissions: [],
          run: (resolved) =>
            options.deviceKeyStore
              .getCurrentDeviceKeyStatus({
                principal: resolved.principal,
                request,
              })
              .pipe(
                Effect.mapError((cause) => mapDeviceKeyStoreFailure("device-key.status", cause)),
                Effect.flatMap((result) =>
                  decodeDeviceKeyStatusResponse(result, { onExcessProperty: "error" }).pipe(
                    Effect.mapError(() => error("device-key.status", "unavailable")),
                  ),
                ),
                Effect.filterOrFail(
                  (result) =>
                    result.sharedProjectId === request.sharedProjectId &&
                    result.userId === resolved.principal.userId &&
                    result.deviceId === resolved.principal.deviceId &&
                    result.membershipEpoch === resolved.principal.membershipEpoch &&
                    result.status === "active" &&
                    result.activeKey.deviceKeyId === resolved.deviceKeyId,
                  () => error("device-key.status", "unavailable"),
                ),
              ),
        });
      });

  const revokeCurrentDeviceKey: CollaborationTransportFacadeShape["revokeCurrentDeviceKey"] = (
    input,
  ) =>
    Effect.gen(function* () {
      yield* checkFrame("device-key.revoke", input);
      const request = yield* decodeDeviceKeyRevokeRequest(input.request, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => error("device-key.revoke", "invalid-request")));
      return yield* execute({
        operation: "device-key.revoke",
        transport: input,
        projectId: request.sharedProjectId,
        permissions: [],
        authorizeDeviceKey: false,
        revalidateDeviceKey: false,
        run: (resolved) => {
          if (request.deviceKeyId !== resolved.deviceKeyId) {
            return Effect.fail(error("device-key.revoke", "not-found"));
          }
          return options.deviceKeyStore.revokeKey({ principal: resolved.principal, request }).pipe(
            Effect.mapError((cause) => mapDeviceKeyStoreFailure("device-key.revoke", cause)),
            Effect.flatMap((result) =>
              decodeDeviceKeyRevokeResponse(result, { onExcessProperty: "error" }).pipe(
                Effect.mapError(() => error("device-key.revoke", "unavailable")),
              ),
            ),
            Effect.filterOrFail(
              (result) =>
                (result.disposition === "revoked" || result.disposition === "already-applied") &&
                result.key.sharedProjectId === request.sharedProjectId &&
                result.key.userId === resolved.principal.userId &&
                result.key.deviceId === resolved.principal.deviceId &&
                result.key.deviceKeyId === resolved.deviceKeyId &&
                result.key.membershipEpoch === resolved.principal.membershipEpoch &&
                result.key.revokedAt !== null,
              () => error("device-key.revoke", "unavailable"),
            ),
          );
        },
      });
    });

  return CollaborationTransportFacade.of({
    append,
    tombstone,
    page,
    createContextPacket,
    replaySubscription,
    getCurrentDeviceKeyStatus,
    revokeCurrentDeviceKey,
  });
}
