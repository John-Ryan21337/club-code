import type {
  CollaborationEventActor,
  CollaborationEventProposal,
  CollaborationDeviceKeyId,
  CollaborationMembershipEpoch,
  CollaborationPhaseOneAuthoredEventType,
  CollaborationPermission,
  CollaborationPrincipal,
  DeviceId,
  SharedProjectId,
  UserId,
} from "@cafecode/contracts";
import {
  COLLABORATION_ED25519_SIGNATURE_BYTES,
  COLLABORATION_EVENT_MAX_FUTURE_SKEW_MILLIS,
  COLLABORATION_EVENT_MAX_OFFLINE_AGE_MILLIS,
  COLLABORATION_EVENT_PAYLOAD_MAX_UTF8_BYTES,
  COLLABORATION_IDENTIFIER_MAX_CHARS,
  COLLABORATION_PHASE_ONE_EVENT_PERMISSIONS,
  CollaborationEventProposal as CollaborationEventProposalSchema,
  CollaborationOperatorChatMessagePayload,
  CollaborationSharedTranscriptPromptPayload,
} from "@cafecode/contracts";
import { createHash, createPublicKey, verify } from "node:crypto";
import { Buffer } from "node:buffer";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  authorizeCollaborationPermission,
  CollaborationAuthorizationError,
  type CollaborationAuthorizationGrant,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";

const COLLABORATION_EVENT_PROPOSAL_SIGNATURE_DOMAIN = "cafecode-collaboration-event-proposal-v1";
const COLLABORATION_ED25519_SPKI_BYTES = 44;
const decodeEventProposal = Schema.decodeUnknownEffect(CollaborationEventProposalSchema);
const decodeOperatorChatMessagePayload = Schema.decodeUnknownEffect(
  CollaborationOperatorChatMessagePayload,
);
const decodeSharedTranscriptPromptPayload = Schema.decodeUnknownEffect(
  CollaborationSharedTranscriptPromptPayload,
);
const COLLABORATION_PHASE_ONE_EVENT_PAYLOAD_DECODERS: Readonly<
  Record<
    CollaborationPhaseOneAuthoredEventType,
    (payload: unknown) => Effect.Effect<unknown, Schema.SchemaError>
  >
> = {
  "operator-chat.message": (payload: unknown) =>
    decodeOperatorChatMessagePayload(payload, { onExcessProperty: "error" }),
  "shared-transcript.prompt": (payload: unknown) =>
    decodeSharedTranscriptPromptPayload(payload, { onExcessProperty: "error" }),
};

export type CollaborationEventAdmissionFailureReason =
  | "proposal-invalid"
  | "project-mismatch"
  | "actor-mismatch"
  | "unsupported-actor"
  | "unsupported-event-type"
  | "membership-epoch-mismatch"
  | "payload-too-large"
  | "payload-invalid-json"
  | "payload-invalid-for-event-type"
  | "payload-not-canonical"
  | "payload-hash-mismatch"
  | "occurred-at-invalid"
  | "occurred-at-in-future"
  | "occurred-at-too-old"
  | "device-key-unavailable"
  | "device-key-not-found"
  | "device-key-mismatch"
  | "signature-invalid";

/**
 * Detailed reasons are server-internal audit metadata. A transport must map
 * every admission denial to one generic response so project, membership, and
 * device-key state cannot be enumerated through response bodies.
 */
export class CollaborationEventAdmissionError extends Data.TaggedError(
  "CollaborationEventAdmissionError",
)<{
  readonly reason: CollaborationEventAdmissionFailureReason;
}> {}

export interface CollaborationDevicePublicKeyLookup {
  readonly sharedProjectId: SharedProjectId;
  readonly userId: UserId;
  readonly deviceId: DeviceId;
  readonly deviceKeyId: CollaborationDeviceKeyId;
  readonly membershipEpoch: CollaborationMembershipEpoch;
}

export interface CollaborationActiveDevicePublicKey extends CollaborationDevicePublicKeyLookup {
  readonly publicKeySpkiDer: Uint8Array;
}

/**
 * Server-owned, revocation-aware device key source.
 *
 * The returned bytes must be an Ed25519 SubjectPublicKeyInfo DER document.
 * Admission never accepts a public key embedded in the client proposal.
 */
export interface CollaborationDeviceKeyAuthorityShape {
  readonly getActiveEd25519PublicKey: (
    lookup: CollaborationDevicePublicKeyLookup,
  ) => Effect.Effect<CollaborationActiveDevicePublicKey | null, unknown>;
}

export class CollaborationDeviceKeyAuthority extends Context.Service<
  CollaborationDeviceKeyAuthority,
  CollaborationDeviceKeyAuthorityShape
>()("cafecode/collaboration/CollaborationDeviceKeyAuthority") {}

export interface CollaborationEventAdmissionInput {
  readonly principal: CollaborationPrincipal;
  readonly targetProjectId: SharedProjectId;
  readonly proposal: unknown;
}

export interface CollaborationAdmittedEventProposal {
  readonly authorization: CollaborationAuthorizationGrant;
  readonly proposal: CollaborationEventProposal;
  readonly permission: CollaborationPermission;
  readonly payload: unknown;
  readonly payloadBytes: Uint8Array;
}

function deny(
  reason: CollaborationEventAdmissionFailureReason,
): Effect.Effect<never, CollaborationEventAdmissionError> {
  return Effect.fail(new CollaborationEventAdmissionError({ reason }));
}

function actorSignatureFields(actor: CollaborationEventActor): ReadonlyArray<string | null> {
  switch (actor.kind) {
    case "operator":
      return [actor.kind, actor.userId, actor.deviceId, null];
    case "agent":
      return [actor.kind, actor.userId, actor.deviceId, actor.agentId];
    case "system":
      return [actor.kind, null, null, actor.serviceId];
  }
}

/**
 * Stable bytes signed by a collaboration device.
 *
 * This is a fixed JSON array of protocol primitives, not a canonicalization of
 * an arbitrary object. The payload is represented by the SHA-256 of its exact
 * UTF-8 JSON bytes, which admission recomputes before signature verification.
 */
export function collaborationEventProposalSignatureBytes(
  proposal: CollaborationEventProposal,
): Uint8Array {
  return Buffer.from(
    JSON.stringify([
      COLLABORATION_EVENT_PROPOSAL_SIGNATURE_DOMAIN,
      proposal.version,
      proposal.sharedProjectId,
      proposal.eventId,
      proposal.commandId,
      proposal.membershipEpoch,
      ...actorSignatureFields(proposal.actor),
      proposal.deviceKeyId,
      proposal.type,
      proposal.payloadSha256,
      proposal.causationEventId,
      proposal.correlationId,
      proposal.occurredAt,
    ]),
    "utf8",
  );
}

function verifyEd25519Signature(
  publicKeyDer: Uint8Array,
  signatureBytes: Uint8Array,
  signedBytes: Uint8Array,
): boolean {
  if (
    publicKeyDer.byteLength !== COLLABORATION_ED25519_SPKI_BYTES ||
    signatureBytes.byteLength !== COLLABORATION_ED25519_SIGNATURE_BYTES
  ) {
    return false;
  }
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyDer),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ed25519") {
      return false;
    }
    const canonicalDer = publicKey.export({ format: "der", type: "spki" });
    if (
      canonicalDer.byteLength !== publicKeyDer.byteLength ||
      !canonicalDer.equals(Buffer.from(publicKeyDer))
    ) {
      return false;
    }
    return verify(null, signedBytes, publicKey, signatureBytes);
  } catch {
    return false;
  }
}

function isCanonicalUntrustedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= COLLABORATION_IDENTIFIER_MAX_CHARS &&
    value === value.trim()
  );
}

function hasCanonicalProposalIdentifiers(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proposal = value as Record<string, unknown>;
  const actor = proposal.actor;
  if (typeof actor !== "object" || actor === null || Array.isArray(actor)) {
    return false;
  }
  const actorRecord = actor as Record<string, unknown>;
  const actorIdentifiersAreCanonical =
    actorRecord.kind === "operator"
      ? isCanonicalUntrustedIdentifier(actorRecord.userId) &&
        isCanonicalUntrustedIdentifier(actorRecord.deviceId)
      : actorRecord.kind === "agent"
        ? isCanonicalUntrustedIdentifier(actorRecord.userId) &&
          isCanonicalUntrustedIdentifier(actorRecord.deviceId) &&
          isCanonicalUntrustedIdentifier(actorRecord.agentId)
        : actorRecord.kind === "system"
          ? isCanonicalUntrustedIdentifier(actorRecord.serviceId)
          : false;
  return (
    isCanonicalUntrustedIdentifier(proposal.sharedProjectId) &&
    isCanonicalUntrustedIdentifier(proposal.eventId) &&
    isCanonicalUntrustedIdentifier(proposal.commandId) &&
    isCanonicalUntrustedIdentifier(proposal.deviceKeyId) &&
    (proposal.causationEventId === null ||
      isCanonicalUntrustedIdentifier(proposal.causationEventId)) &&
    (proposal.correlationId === null || isCanonicalUntrustedIdentifier(proposal.correlationId)) &&
    actorIdentifiersAreCanonical
  );
}

function decodeEventPayload(
  eventType: CollaborationEventProposal["type"],
  payload: unknown,
): Effect.Effect<unknown, CollaborationEventAdmissionError> {
  const decode = COLLABORATION_PHASE_ONE_EVENT_PAYLOAD_DECODERS[eventType];
  return decode(payload).pipe(
    Effect.mapError(
      () =>
        new CollaborationEventAdmissionError({
          reason: "payload-invalid-for-event-type",
        }),
    ),
  );
}

/**
 * Fail-closed admission boundary for phase-one authored collaboration events.
 *
 * No proposal is returned until current membership authorization, attribution,
 * exact payload bytes, and the enrolled device signature all agree.
 */
export function admitCollaborationEventProposal(
  input: CollaborationEventAdmissionInput,
): Effect.Effect<
  CollaborationAdmittedEventProposal,
  CollaborationAuthorizationError | CollaborationEventAdmissionError,
  CollaborationDeviceKeyAuthority | CollaborationMembershipAuthority
> {
  return Effect.gen(function* () {
    const { principal, targetProjectId } = input;
    if (!hasCanonicalProposalIdentifiers(input.proposal)) {
      return yield* deny("proposal-invalid");
    }
    const proposal = yield* decodeEventProposal(input.proposal, {
      onExcessProperty: "error",
    }).pipe(
      Effect.mapError(() => new CollaborationEventAdmissionError({ reason: "proposal-invalid" })),
    );

    if (
      proposal.sharedProjectId !== targetProjectId ||
      principal.sharedProjectId !== targetProjectId
    ) {
      return yield* deny("project-mismatch");
    }

    if (proposal.actor.kind !== "operator") {
      return yield* deny("unsupported-actor");
    }

    if (
      proposal.actor.userId !== principal.userId ||
      proposal.actor.deviceId !== principal.deviceId
    ) {
      return yield* deny("actor-mismatch");
    }

    if (proposal.membershipEpoch !== principal.membershipEpoch) {
      return yield* deny("membership-epoch-mismatch");
    }

    const permission = (
      COLLABORATION_PHASE_ONE_EVENT_PERMISSIONS as Readonly<
        Record<string, CollaborationPermission | undefined>
      >
    )[proposal.type];
    if (permission === undefined) {
      return yield* deny("unsupported-event-type");
    }
    const authorization = yield* authorizeCollaborationPermission({
      principal,
      targetProjectId,
      permission,
    });

    const payloadBytes = Buffer.from(proposal.payloadJson, "utf8");
    if (payloadBytes.byteLength > COLLABORATION_EVENT_PAYLOAD_MAX_UTF8_BYTES) {
      return yield* deny("payload-too-large");
    }

    const payloadSha256 = createHash("sha256").update(payloadBytes).digest("hex");
    if (payloadSha256 !== proposal.payloadSha256) {
      return yield* deny("payload-hash-mismatch");
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(proposal.payloadJson);
    } catch {
      return yield* deny("payload-invalid-json");
    }
    const payload = yield* decodeEventPayload(proposal.type, parsedPayload);
    if (JSON.stringify(payload) !== proposal.payloadJson) {
      return yield* deny("payload-not-canonical");
    }

    const occurredAtEpochMillis = Date.parse(proposal.occurredAt);
    if (
      !Number.isFinite(occurredAtEpochMillis) ||
      new Date(occurredAtEpochMillis).toISOString() !== proposal.occurredAt
    ) {
      return yield* deny("occurred-at-invalid");
    }
    const nowEpochMillis = DateTime.toEpochMillis(yield* DateTime.now);
    if (occurredAtEpochMillis > nowEpochMillis + COLLABORATION_EVENT_MAX_FUTURE_SKEW_MILLIS) {
      return yield* deny("occurred-at-in-future");
    }
    if (occurredAtEpochMillis < nowEpochMillis - COLLABORATION_EVENT_MAX_OFFLINE_AGE_MILLIS) {
      return yield* deny("occurred-at-too-old");
    }

    const deviceKeyAuthority = yield* CollaborationDeviceKeyAuthority;
    const activeDeviceKey = yield* deviceKeyAuthority
      .getActiveEd25519PublicKey({
        sharedProjectId: targetProjectId,
        userId: principal.userId,
        deviceId: principal.deviceId,
        deviceKeyId: proposal.deviceKeyId,
        membershipEpoch: principal.membershipEpoch,
      })
      .pipe(Effect.catch(() => deny("device-key-unavailable")));
    if (activeDeviceKey === null) {
      return yield* deny("device-key-not-found");
    }
    if (
      typeof activeDeviceKey !== "object" ||
      activeDeviceKey.sharedProjectId !== targetProjectId ||
      activeDeviceKey.userId !== principal.userId ||
      activeDeviceKey.deviceId !== principal.deviceId ||
      activeDeviceKey.deviceKeyId !== proposal.deviceKeyId ||
      activeDeviceKey.membershipEpoch !== principal.membershipEpoch ||
      !(activeDeviceKey.publicKeySpkiDer instanceof Uint8Array)
    ) {
      return yield* deny("device-key-mismatch");
    }

    let signatureBytes: Uint8Array;
    try {
      signatureBytes = Buffer.from(proposal.authorSignature, "base64url");
    } catch {
      return yield* deny("signature-invalid");
    }
    if (
      signatureBytes.byteLength !== COLLABORATION_ED25519_SIGNATURE_BYTES ||
      Buffer.from(signatureBytes).toString("base64url") !== proposal.authorSignature ||
      !verifyEd25519Signature(
        activeDeviceKey.publicKeySpkiDer,
        signatureBytes,
        collaborationEventProposalSignatureBytes(proposal),
      )
    ) {
      return yield* deny("signature-invalid");
    }

    return {
      authorization,
      proposal,
      permission,
      payload,
      payloadBytes,
    };
  });
}
