import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  COLLABORATION_IDENTIFIER_MAX_CHARS,
  CollaborationDeviceKeyId,
  CollaborationEd25519Signature,
  CollaborationMembershipEpoch,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";

export const COLLABORATION_DEVICE_CHALLENGE_BYTES = 32;
export const COLLABORATION_DEVICE_CHALLENGE_BASE64URL_CHARS = 43;
export const COLLABORATION_ED25519_SPKI_DER_BYTES = 44;
export const COLLABORATION_ED25519_SPKI_DER_BASE64URL_CHARS = 59;
export const COLLABORATION_DEVICE_CHALLENGE_LIFETIME_MILLIS = 5 * 60_000;

const CollaborationDeviceIdentifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_IDENTIFIER_MAX_CHARS),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);

export const CollaborationDeviceCommandId = CollaborationDeviceIdentifier.pipe(
  Schema.brand("CollaborationDeviceCommandId"),
);
export type CollaborationDeviceCommandId = typeof CollaborationDeviceCommandId.Type;

export const CollaborationDeviceEnrollmentChallengeId = CollaborationDeviceIdentifier.pipe(
  Schema.brand("CollaborationDeviceEnrollmentChallengeId"),
);
export type CollaborationDeviceEnrollmentChallengeId =
  typeof CollaborationDeviceEnrollmentChallengeId.Type;

export const CollaborationDeviceEnrollmentNonce = Schema.String.check(
  Schema.isMinLength(COLLABORATION_DEVICE_CHALLENGE_BASE64URL_CHARS),
  Schema.isMaxLength(COLLABORATION_DEVICE_CHALLENGE_BASE64URL_CHARS),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("CollaborationDeviceEnrollmentNonce"));
export type CollaborationDeviceEnrollmentNonce = typeof CollaborationDeviceEnrollmentNonce.Type;

/** Canonical, unpadded base64url encoding of a 44-byte Ed25519 SPKI DER key. */
export const CollaborationEd25519PublicKeySpkiDer = Schema.String.check(
  Schema.isMinLength(COLLABORATION_ED25519_SPKI_DER_BASE64URL_CHARS),
  Schema.isMaxLength(COLLABORATION_ED25519_SPKI_DER_BASE64URL_CHARS),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("CollaborationEd25519PublicKeySpkiDer"));
export type CollaborationEd25519PublicKeySpkiDer = typeof CollaborationEd25519PublicKeySpkiDer.Type;

export const CollaborationBeginDeviceEnrollmentRequest = Schema.Struct({
  commandId: CollaborationDeviceCommandId,
  sharedProjectId: SharedProjectId,
  publicKeySpkiDer: CollaborationEd25519PublicKeySpkiDer,
});
export type CollaborationBeginDeviceEnrollmentRequest =
  typeof CollaborationBeginDeviceEnrollmentRequest.Type;

export const CollaborationDeviceEnrollmentChallenge = Schema.Struct({
  challengeId: CollaborationDeviceEnrollmentChallengeId,
  sharedProjectId: SharedProjectId,
  userId: UserId,
  deviceId: DeviceId,
  deviceKeyId: CollaborationDeviceKeyId,
  publicKeySpkiDer: CollaborationEd25519PublicKeySpkiDer,
  membershipEpoch: CollaborationMembershipEpoch,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
}).check(
  Schema.makeFilter((challenge) => {
    const issuedAt =
      typeof challenge.issuedAt === "string"
        ? Date.parse(challenge.issuedAt)
        : DateTime.toEpochMillis(challenge.issuedAt);
    const expiresAt =
      typeof challenge.expiresAt === "string"
        ? Date.parse(challenge.expiresAt)
        : DateTime.toEpochMillis(challenge.expiresAt);
    return expiresAt - issuedAt === COLLABORATION_DEVICE_CHALLENGE_LIFETIME_MILLIS
      ? undefined
      : "device enrollment challenge must use the fixed server lifetime";
  }),
);
export type CollaborationDeviceEnrollmentChallenge =
  typeof CollaborationDeviceEnrollmentChallenge.Type;

export const CollaborationBeginDeviceEnrollmentResult = Schema.Struct({
  disposition: Schema.Literals(["created", "already-applied"]),
  challenge: CollaborationDeviceEnrollmentChallenge,
  // The nonce is stored only as a digest. A command replay cannot recover it.
  nonce: Schema.NullOr(CollaborationDeviceEnrollmentNonce),
});
export type CollaborationBeginDeviceEnrollmentResult =
  typeof CollaborationBeginDeviceEnrollmentResult.Type;

export const CollaborationCompleteDeviceEnrollmentRequest = Schema.Struct({
  commandId: CollaborationDeviceCommandId,
  sharedProjectId: SharedProjectId,
  challengeId: CollaborationDeviceEnrollmentChallengeId,
  nonce: CollaborationDeviceEnrollmentNonce,
  proofSignature: CollaborationEd25519Signature,
});
export type CollaborationCompleteDeviceEnrollmentRequest =
  typeof CollaborationCompleteDeviceEnrollmentRequest.Type;

export const CollaborationDeviceKeyRecord = Schema.Struct({
  sharedProjectId: SharedProjectId,
  userId: UserId,
  deviceId: DeviceId,
  deviceKeyId: CollaborationDeviceKeyId,
  publicKeySpkiDer: CollaborationEd25519PublicKeySpkiDer,
  membershipEpoch: CollaborationMembershipEpoch,
  activatedAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}).check(
  Schema.makeFilter((key) => {
    if (key.revokedAt === null) return undefined;
    const activatedAt =
      typeof key.activatedAt === "string"
        ? Date.parse(key.activatedAt)
        : DateTime.toEpochMillis(key.activatedAt);
    const revokedAt =
      typeof key.revokedAt === "string"
        ? Date.parse(key.revokedAt)
        : DateTime.toEpochMillis(key.revokedAt);
    return revokedAt >= activatedAt
      ? undefined
      : "device key revocation must not predate activation";
  }),
);
export type CollaborationDeviceKeyRecord = typeof CollaborationDeviceKeyRecord.Type;

/**
 * Authenticated current-device lookup. User and device identity are
 * intentionally absent: the server derives both from the authenticated
 * principal instead of accepting an object-reference selector from a client.
 */
export const CollaborationCurrentDeviceKeyStatusRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
});
export type CollaborationCurrentDeviceKeyStatusRequest =
  typeof CollaborationCurrentDeviceKeyStatusRequest.Type;

/** Public metadata sufficient to present and self-revoke the current key. */
export const CollaborationCurrentDeviceKeyPublicRecord = Schema.Struct({
  deviceKeyId: CollaborationDeviceKeyId,
  activatedAt: Schema.DateTimeUtcFromString,
});
export type CollaborationCurrentDeviceKeyPublicRecord =
  typeof CollaborationCurrentDeviceKeyPublicRecord.Type;

const CollaborationCurrentDeviceKeyStatusIdentity = {
  sharedProjectId: SharedProjectId,
  userId: UserId,
  deviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
} as const;

export const CollaborationCurrentDeviceKeyStatus = Schema.Union([
  Schema.Struct({
    ...CollaborationCurrentDeviceKeyStatusIdentity,
    status: Schema.Literal("enrollment-required"),
    activeKey: Schema.Null,
  }),
  Schema.Struct({
    ...CollaborationCurrentDeviceKeyStatusIdentity,
    status: Schema.Literal("active"),
    activeKey: CollaborationCurrentDeviceKeyPublicRecord,
  }),
]);
export type CollaborationCurrentDeviceKeyStatus = typeof CollaborationCurrentDeviceKeyStatus.Type;

export const CollaborationDeviceKeyMutationResult = Schema.Struct({
  disposition: Schema.Literals(["activated", "revoked", "already-applied"]),
  key: CollaborationDeviceKeyRecord,
});
export type CollaborationDeviceKeyMutationResult = typeof CollaborationDeviceKeyMutationResult.Type;

export const CollaborationRevokeDeviceKeyRequest = Schema.Struct({
  commandId: CollaborationDeviceCommandId,
  sharedProjectId: SharedProjectId,
  deviceKeyId: CollaborationDeviceKeyId,
});
export type CollaborationRevokeDeviceKeyRequest = typeof CollaborationRevokeDeviceKeyRequest.Type;
