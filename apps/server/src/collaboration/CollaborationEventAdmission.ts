import type {
  CollaborationEventActor,
  CollaborationEventProposal,
  CollaborationPermission,
  CollaborationPrincipal,
  DeviceId,
  SharedProjectId,
  UserId,
} from "@cafecode/contracts";
import {
  COLLABORATION_ED25519_SIGNATURE_BYTES,
  COLLABORATION_EVENT_PAYLOAD_MAX_UTF8_BYTES,
  COLLABORATION_PHASE_ONE_EVENT_PERMISSIONS,
} from "@cafecode/contracts";
import { createHash, createPublicKey, verify } from "node:crypto";
import { Buffer } from "node:buffer";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import {
  authorizeCollaborationPermission,
  CollaborationAuthorizationError,
  type CollaborationAuthorizationGrant,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";

const COLLABORATION_EVENT_PROPOSAL_SIGNATURE_DOMAIN = "cafecode-collaboration-event-proposal-v1";

export type CollaborationEventAdmissionFailureReason =
  | "project-mismatch"
  | "actor-mismatch"
  | "unsupported-actor"
  | "unsupported-event-type"
  | "membership-epoch-mismatch"
  | "payload-too-large"
  | "payload-invalid-json"
  | "payload-hash-mismatch"
  | "occurred-at-invalid"
  | "device-key-unavailable"
  | "device-key-not-found"
  | "signature-invalid";

export class CollaborationEventAdmissionError extends Data.TaggedError(
  "CollaborationEventAdmissionError",
)<{
  readonly reason: CollaborationEventAdmissionFailureReason;
}> {}

export interface CollaborationDevicePublicKeyLookup {
  readonly sharedProjectId: SharedProjectId;
  readonly userId: UserId;
  readonly deviceId: DeviceId;
  readonly membershipEpoch: number;
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
  ) => Effect.Effect<Uint8Array | null, unknown>;
}

export class CollaborationDeviceKeyAuthority extends Context.Service<
  CollaborationDeviceKeyAuthority,
  CollaborationDeviceKeyAuthorityShape
>()("cafecode/collaboration/CollaborationDeviceKeyAuthority") {}

export interface CollaborationEventAdmissionInput {
  readonly principal: CollaborationPrincipal;
  readonly targetProjectId: SharedProjectId;
  readonly proposal: CollaborationEventProposal;
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
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyDer),
      format: "der",
      type: "spki",
    });
    return publicKey.asymmetricKeyType === "ed25519"
      ? verify(null, signedBytes, publicKey, signatureBytes)
      : false;
  } catch {
    return false;
  }
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
    const { principal, proposal, targetProjectId } = input;

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

    let payload: unknown;
    try {
      payload = JSON.parse(proposal.payloadJson);
    } catch {
      return yield* deny("payload-invalid-json");
    }

    const payloadSha256 = createHash("sha256").update(payloadBytes).digest("hex");
    if (payloadSha256 !== proposal.payloadSha256) {
      return yield* deny("payload-hash-mismatch");
    }

    const occurredAtEpochMillis = Date.parse(proposal.occurredAt);
    if (
      !Number.isFinite(occurredAtEpochMillis) ||
      new Date(occurredAtEpochMillis).toISOString() !== proposal.occurredAt
    ) {
      return yield* deny("occurred-at-invalid");
    }

    const deviceKeyAuthority = yield* CollaborationDeviceKeyAuthority;
    const publicKeyDer = yield* deviceKeyAuthority
      .getActiveEd25519PublicKey({
        sharedProjectId: targetProjectId,
        userId: principal.userId,
        deviceId: principal.deviceId,
        membershipEpoch: principal.membershipEpoch,
      })
      .pipe(Effect.catch(() => deny("device-key-unavailable")));
    if (publicKeyDer === null) {
      return yield* deny("device-key-not-found");
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
        publicKeyDer,
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
