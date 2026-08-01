import {
  COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS,
  COLLABORATION_DEVICE_CHALLENGE_LIFETIME_MILLIS,
  COLLABORATION_ED25519_SIGNATURE_BYTES,
  CollaborationBeginDeviceEnrollmentRequest,
  CollaborationBeginDeviceEnrollmentResult,
  CollaborationCompleteDeviceEnrollmentRequest,
  CollaborationCurrentDeviceKeyStatus,
  CollaborationCurrentDeviceKeyStatusRequest,
  CollaborationDeviceEnrollmentChallenge,
  CollaborationDeviceEnrollmentNonce,
  CollaborationDeviceKeyRecord,
  CollaborationRevokeDeviceKeyRequest,
  type CollaborationBeginDeviceEnrollmentResult as BeginResult,
  type CollaborationDeviceEnrollmentChallenge as EnrollmentChallenge,
  type CollaborationDeviceEnrollmentNonce as EnrollmentNonce,
  type CollaborationCurrentDeviceKeyStatus as CurrentDeviceKeyStatus,
  type CollaborationDeviceKeyMutationResult as MutationResult,
  type CollaborationPrincipal as Principal,
  type SharedProjectId,
} from "@cafecode/contracts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  CollaborationDeviceKeyAuthority,
  type CollaborationDeviceKeyAuthorityShape,
} from "./CollaborationEventAdmission.ts";
import { validateCollaborationPrincipal } from "./CollaborationAuthorization.ts";
import {
  canonicalEd25519PublicKeySpkiDer,
  verifyStrictEd25519Signature,
} from "./CollaborationEd25519.ts";

const PROOF_DOMAIN = "club-code/cowork-device-enrollment/v1";
const NONCE_HASH_DOMAIN = "club-code/cowork-device-enrollment-nonce/v1\0";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const decodeEnrollmentNonce = Schema.decodeUnknownSync(CollaborationDeviceEnrollmentNonce);

type Operation = "device-enrollment.begin" | "device-enrollment.complete" | "device-key.revoke";

export type CollaborationDeviceKeyStoreFailureReason =
  | "invalid-input"
  | "unauthenticated"
  | "project-mismatch"
  | "membership-unavailable"
  | "membership-epoch-mismatch"
  | "member-not-found"
  | "command-conflict"
  | "challenge-not-found"
  | "challenge-expired"
  | "challenge-consumed"
  | "challenge-mismatch"
  | "proof-invalid"
  | "device-identity-conflict"
  | "device-key-not-found"
  | "device-key-not-active"
  | "stored-corruption"
  | "storage-failure";

export class CollaborationDeviceKeyStoreError extends Data.TaggedError(
  "CollaborationDeviceKeyStoreError",
)<{
  readonly operation: string;
  readonly reason: CollaborationDeviceKeyStoreFailureReason;
}> {}

export interface CollaborationDeviceKeyStoreShape {
  readonly getCurrentDeviceKeyStatus: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<CurrentDeviceKeyStatus, CollaborationDeviceKeyStoreError>;
  readonly beginEnrollment: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<BeginResult, CollaborationDeviceKeyStoreError>;
  readonly completeEnrollment: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<MutationResult, CollaborationDeviceKeyStoreError>;
  readonly revokeKey: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<MutationResult, CollaborationDeviceKeyStoreError>;
  readonly getActiveEd25519PublicKey: CollaborationDeviceKeyAuthorityShape["getActiveEd25519PublicKey"];
}

export class CollaborationDeviceKeyStore extends Context.Service<
  CollaborationDeviceKeyStore,
  CollaborationDeviceKeyStoreShape
>()("cafecode/collaboration/CollaborationDeviceKeyStore") {}

type ReceiptRow = {
  readonly operation: string;
  readonly inputSha256: string;
  readonly actorUserId: string;
  readonly actorDeviceId: string;
  readonly actorMembershipEpoch: number;
  readonly resultJson: string;
  readonly resultSha256: string;
};

type ChallengeRow = {
  readonly challengeId: string;
  readonly sharedProjectId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly publicKeySpkiDer: Uint8Array;
  readonly nonceSha256: string;
  readonly membershipEpoch: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly completedAt: string | null;
};

type KeyRow = {
  readonly sharedProjectId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly publicKeySpkiDer: Uint8Array;
  readonly membershipEpoch: number;
  readonly activatedAt: string;
  readonly revokedAt: string | null;
  readonly boundUserId?: string;
};

type CurrentStatusKeyRow = KeyRow & {
  readonly challengeSharedProjectId: string | null;
  readonly challengeUserId: string | null;
  readonly challengeDeviceId: string | null;
  readonly challengeDeviceKeyId: string | null;
  readonly challengePublicKeySpkiDer: Uint8Array | null;
  readonly challengeMembershipEpoch: number | null;
  readonly challengeCompletedAt: string | null;
};

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
const nonceSha256 = (nonce: string): string => sha256(`${NONCE_HASH_DOMAIN}${nonce}`);
const nowIso = (millis: number): string => new Date(millis).toISOString();
const isCanonicalTimestamp = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

function fail(operation: string, reason: CollaborationDeviceKeyStoreFailureReason) {
  return new CollaborationDeviceKeyStoreError({ operation, reason });
}

function isStoreError(cause: unknown): cause is CollaborationDeviceKeyStoreError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "CollaborationDeviceKeyStoreError"
  );
}

const mapStorageFailure = (operation: string) => (cause: unknown) =>
  isStoreError(cause) ? cause : fail(operation, "storage-failure");

function strictDecode<S extends Schema.Top>(operation: string, schema: S, value: unknown) {
  return (
    Schema.decodeUnknownEffect(schema as never)(value, {
      onExcessProperty: "error",
    }) as Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError>
  ).pipe(Effect.mapError(() => fail(operation, "invalid-input")));
}

function parseCanonicalJson(
  operation: string,
  value: string,
): Effect.Effect<unknown, CollaborationDeviceKeyStoreError> {
  return Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(value);
      if (JSON.stringify(parsed) !== value) throw new Error("non-canonical JSON");
      return parsed;
    },
    catch: () => fail(operation, "stored-corruption"),
  });
}

function encodedPublicKey(
  operation: string,
  value: Uint8Array,
): Effect.Effect<string, CollaborationDeviceKeyStoreError> {
  if (!(value instanceof Uint8Array)) return Effect.fail(fail(operation, "stored-corruption"));
  const encoded = Buffer.from(value).toString("base64url");
  return canonicalEd25519PublicKeySpkiDer(encoded) === null
    ? Effect.fail(fail(operation, "stored-corruption"))
    : Effect.succeed(encoded);
}

function proofTimestamp(value: EnrollmentChallenge["issuedAt"]): string {
  return typeof value === "string" ? value : DateTime.formatIso(value);
}

/** Stable bytes which the enrolling device proves possession of by signing. */
export function collaborationDeviceEnrollmentProofBytes(input: {
  readonly challenge: EnrollmentChallenge;
  readonly nonce: EnrollmentNonce;
}): Uint8Array {
  const { challenge, nonce } = input;
  return Buffer.from(
    JSON.stringify([
      PROOF_DOMAIN,
      challenge.challengeId,
      challenge.sharedProjectId,
      challenge.userId,
      challenge.deviceId,
      challenge.deviceKeyId,
      challenge.publicKeySpkiDer,
      challenge.membershipEpoch,
      proofTimestamp(challenge.issuedAt),
      proofTimestamp(challenge.expiresAt),
      nonce,
    ]),
    "utf8",
  );
}

function makeStore() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const lockProject = (sharedProjectId: SharedProjectId) => sql`
      UPDATE collaboration_projects
      SET shared_project_id = shared_project_id
      WHERE shared_project_id = ${sharedProjectId}
    `;

    const authorizeCurrentMember = (
      operation: string,
      principalInput: unknown,
      sharedProjectId: SharedProjectId,
      nowMillis: number,
    ) =>
      Effect.gen(function* () {
        const principal = yield* validateCollaborationPrincipal(principalInput).pipe(
          Effect.mapError(() => fail(operation, "invalid-input")),
        );
        if (principal.sharedProjectId !== sharedProjectId) {
          return yield* Effect.fail(fail(operation, "project-mismatch"));
        }
        const issuedAt = DateTime.toEpochMillis(principal.issuedAt);
        const expiresAt = DateTime.toEpochMillis(principal.expiresAt);
        if (
          nowMillis < issuedAt ||
          nowMillis >= expiresAt ||
          expiresAt - issuedAt <= 0 ||
          expiresAt - issuedAt > COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS
        ) {
          return yield* Effect.fail(fail(operation, "unauthenticated"));
        }
        const projects = yield* sql<{ readonly membershipEpoch: number }>`
          SELECT membership_epoch AS "membershipEpoch"
          FROM collaboration_projects
          WHERE shared_project_id = ${sharedProjectId}
        `;
        if (projects.length !== 1) {
          return yield* Effect.fail(
            fail(operation, projects.length === 0 ? "membership-unavailable" : "stored-corruption"),
          );
        }
        const epoch = projects[0]!.membershipEpoch;
        if (!Number.isSafeInteger(epoch) || epoch < 0) {
          return yield* Effect.fail(fail(operation, "stored-corruption"));
        }
        if (principal.membershipEpoch !== epoch) {
          return yield* Effect.fail(fail(operation, "membership-epoch-mismatch"));
        }
        const members = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count
          FROM collaboration_project_members
          WHERE shared_project_id = ${sharedProjectId} AND user_id = ${principal.userId}
        `;
        if (members[0]?.count !== 1) {
          return yield* Effect.fail(
            fail(operation, members[0]?.count === 0 ? "member-not-found" : "stored-corruption"),
          );
        }
        return principal;
      });

    const receiptHash = (operation: Operation, request: unknown, actor: Principal) =>
      sha256(
        JSON.stringify([operation, request, actor.userId, actor.deviceId, actor.membershipEpoch]),
      );

    const getReceipt = (sharedProjectId: SharedProjectId, commandId: string) =>
      sql<ReceiptRow>`
        SELECT operation, input_sha256 AS "inputSha256",
          actor_user_id AS "actorUserId", actor_device_id AS "actorDeviceId",
          actor_membership_epoch AS "actorMembershipEpoch",
          result_json AS "resultJson", result_sha256 AS "resultSha256"
        FROM collaboration_device_command_receipts
        WHERE shared_project_id = ${sharedProjectId} AND command_id = ${commandId}
      `.pipe(Effect.map((rows) => rows[0]));

    const requireReceipt = (
      operation: Operation,
      receipt: ReceiptRow,
      expectedHash: string,
      actor: Principal,
    ) => {
      if (
        !SHA256_PATTERN.test(receipt.inputSha256) ||
        !SHA256_PATTERN.test(receipt.resultSha256) ||
        sha256(receipt.resultJson) !== receipt.resultSha256
      ) {
        return Effect.fail(fail(operation, "stored-corruption"));
      }
      return receipt.operation === operation &&
        receipt.inputSha256 === expectedHash &&
        receipt.actorUserId === actor.userId &&
        receipt.actorDeviceId === actor.deviceId &&
        receipt.actorMembershipEpoch === actor.membershipEpoch
        ? Effect.void
        : Effect.fail(fail(operation, "command-conflict"));
    };

    const storeReceipt = (
      operation: Operation,
      sharedProjectId: SharedProjectId,
      commandId: string,
      hash: string,
      actor: Principal,
      result: unknown,
      createdAt: string,
    ) => {
      const resultJson = JSON.stringify(result);
      return sql`
        INSERT INTO collaboration_device_command_receipts(
          shared_project_id, command_id, operation, input_sha256,
          actor_user_id, actor_device_id, actor_membership_epoch,
          result_json, result_sha256, created_at
        ) VALUES (
          ${sharedProjectId}, ${commandId}, ${operation}, ${hash},
          ${actor.userId}, ${actor.deviceId}, ${actor.membershipEpoch},
          ${resultJson}, ${sha256(resultJson)}, ${createdAt}
        )
      `;
    };

    const challengeFromRow = (operation: string, row: ChallengeRow) =>
      Effect.gen(function* () {
        if (
          !isCanonicalTimestamp(row.issuedAt) ||
          !isCanonicalTimestamp(row.expiresAt) ||
          (row.completedAt !== null && !isCanonicalTimestamp(row.completedAt))
        ) {
          return yield* Effect.fail(fail(operation, "stored-corruption"));
        }
        const publicKeySpkiDer = yield* encodedPublicKey(operation, row.publicKeySpkiDer);
        return yield* strictDecode(operation, CollaborationDeviceEnrollmentChallenge, {
          challengeId: row.challengeId,
          sharedProjectId: row.sharedProjectId,
          userId: row.userId,
          deviceId: row.deviceId,
          deviceKeyId: row.deviceKeyId,
          publicKeySpkiDer,
          membershipEpoch: row.membershipEpoch,
          issuedAt: row.issuedAt,
          expiresAt: row.expiresAt,
        }).pipe(Effect.mapError(() => fail(operation, "stored-corruption")));
      });

    const keyFromRow = (operation: string, row: KeyRow) =>
      Effect.gen(function* () {
        if (row.boundUserId !== undefined && row.boundUserId !== row.userId) {
          return yield* Effect.fail(fail(operation, "stored-corruption"));
        }
        if (
          !isCanonicalTimestamp(row.activatedAt) ||
          (row.revokedAt !== null && !isCanonicalTimestamp(row.revokedAt))
        ) {
          return yield* Effect.fail(fail(operation, "stored-corruption"));
        }
        const publicKeySpkiDer = yield* encodedPublicKey(operation, row.publicKeySpkiDer);
        return yield* strictDecode(operation, CollaborationDeviceKeyRecord, {
          sharedProjectId: row.sharedProjectId,
          userId: row.userId,
          deviceId: row.deviceId,
          deviceKeyId: row.deviceKeyId,
          publicKeySpkiDer,
          membershipEpoch: row.membershipEpoch,
          activatedAt: row.activatedAt,
          revokedAt: row.revokedAt,
        }).pipe(Effect.mapError(() => fail(operation, "stored-corruption")));
      });

    const selectChallenge = (sharedProjectId: SharedProjectId, challengeId: string) =>
      sql<ChallengeRow>`
        SELECT challenge_id AS "challengeId", shared_project_id AS "sharedProjectId",
          user_id AS "userId", device_id AS "deviceId", device_key_id AS "deviceKeyId",
          public_key_spki_der AS "publicKeySpkiDer", nonce_sha256 AS "nonceSha256",
          membership_epoch AS "membershipEpoch", issued_at AS "issuedAt",
          expires_at AS "expiresAt", completed_at AS "completedAt"
        FROM collaboration_device_enrollment_challenges
        WHERE shared_project_id = ${sharedProjectId} AND challenge_id = ${challengeId}
        LIMIT 2
      `;

    const selectKey = (sharedProjectId: SharedProjectId, deviceKeyId: string) =>
      sql<KeyRow>`
        SELECT k.shared_project_id AS "sharedProjectId", k.user_id AS "userId",
          k.device_id AS "deviceId", k.device_key_id AS "deviceKeyId",
          k.public_key_spki_der AS "publicKeySpkiDer",
          k.membership_epoch AS "membershipEpoch", k.activated_at AS "activatedAt",
          k.revoked_at AS "revokedAt", d.user_id AS "boundUserId"
        FROM collaboration_device_keys k
        JOIN collaboration_project_devices d
          ON d.shared_project_id = k.shared_project_id AND d.device_id = k.device_id
        WHERE k.shared_project_id = ${sharedProjectId} AND k.device_key_id = ${deviceKeyId}
        LIMIT 2
      `;

    const selectActiveDeviceKeys = (sharedProjectId: SharedProjectId, deviceId: string) =>
      sql<CurrentStatusKeyRow>`
        SELECT k.shared_project_id AS "sharedProjectId", k.user_id AS "userId",
          k.device_id AS "deviceId", k.device_key_id AS "deviceKeyId",
          k.public_key_spki_der AS "publicKeySpkiDer",
          k.membership_epoch AS "membershipEpoch", k.activated_at AS "activatedAt",
          k.revoked_at AS "revokedAt", d.user_id AS "boundUserId",
          c.shared_project_id AS "challengeSharedProjectId",
          c.user_id AS "challengeUserId", c.device_id AS "challengeDeviceId",
          c.device_key_id AS "challengeDeviceKeyId",
          c.public_key_spki_der AS "challengePublicKeySpkiDer",
          c.membership_epoch AS "challengeMembershipEpoch",
          c.completed_at AS "challengeCompletedAt"
        FROM collaboration_device_keys k
        JOIN collaboration_project_devices d
          ON d.shared_project_id = k.shared_project_id AND d.device_id = k.device_id
        LEFT JOIN collaboration_device_enrollment_challenges c
          ON c.device_key_id = k.device_key_id
        WHERE k.shared_project_id = ${sharedProjectId} AND k.device_id = ${deviceId}
          AND k.revoked_at IS NULL
        LIMIT 2
      `;

    const getCurrentDeviceKeyStatus: CollaborationDeviceKeyStoreShape["getCurrentDeviceKeyStatus"] =
      (input) => {
        const operation = "device-key.status";
        return Effect.gen(function* () {
          const request = yield* strictDecode(
            operation,
            CollaborationCurrentDeviceKeyStatusRequest,
            input.request,
          );
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              // Use the same project writer lock as enrollment and revocation.
              // The returned snapshot is therefore entirely before or after a
              // concurrent mutation, never assembled from both states.
              yield* lockProject(request.sharedProjectId);
              const now = DateTime.toEpochMillis(yield* DateTime.now);
              const actor = yield* authorizeCurrentMember(
                operation,
                input.principal,
                request.sharedProjectId,
                now,
              );
              const bindings = yield* sql<{ readonly userId: string }>`
                SELECT user_id AS "userId" FROM collaboration_project_devices
                WHERE shared_project_id = ${request.sharedProjectId}
                  AND device_id = ${actor.deviceId}
                LIMIT 2
              `;
              if (bindings.length > 1)
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              if (bindings[0] && bindings[0].userId !== actor.userId) {
                return yield* Effect.fail(fail(operation, "device-identity-conflict"));
              }

              const rows = yield* selectActiveDeviceKeys(request.sharedProjectId, actor.deviceId);
              if (rows.length > 1) return yield* Effect.fail(fail(operation, "stored-corruption"));

              const identity = {
                sharedProjectId: request.sharedProjectId,
                userId: actor.userId,
                deviceId: actor.deviceId,
                membershipEpoch: actor.membershipEpoch,
              };
              if (rows.length === 0) {
                return yield* strictDecode(operation, CollaborationCurrentDeviceKeyStatus, {
                  ...identity,
                  status: "enrollment-required",
                  activeKey: null,
                });
              }

              // Decode and validate even a stale-epoch row. A corrupt or
              // substituted public key must never be disguised as a harmless
              // enrollment-required status.
              const key = yield* keyFromRow(operation, rows[0]!);
              const row = rows[0]!;
              if (
                key.sharedProjectId !== request.sharedProjectId ||
                key.userId !== actor.userId ||
                key.deviceId !== actor.deviceId ||
                key.revokedAt !== null ||
                row.challengeSharedProjectId !== key.sharedProjectId ||
                row.challengeUserId !== key.userId ||
                row.challengeDeviceId !== key.deviceId ||
                row.challengeDeviceKeyId !== key.deviceKeyId ||
                row.challengeMembershipEpoch !== key.membershipEpoch ||
                row.challengeCompletedAt === null ||
                !isCanonicalTimestamp(row.challengeCompletedAt) ||
                row.challengeCompletedAt !== proofTimestamp(key.activatedAt) ||
                row.challengePublicKeySpkiDer === null ||
                !Buffer.from(row.challengePublicKeySpkiDer).equals(
                  Buffer.from(row.publicKeySpkiDer),
                )
              ) {
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              }
              if (key.membershipEpoch !== actor.membershipEpoch) {
                return yield* strictDecode(operation, CollaborationCurrentDeviceKeyStatus, {
                  ...identity,
                  status: "enrollment-required",
                  activeKey: null,
                });
              }
              return yield* strictDecode(operation, CollaborationCurrentDeviceKeyStatus, {
                ...identity,
                status: "active",
                activeKey: {
                  deviceKeyId: key.deviceKeyId,
                  activatedAt: proofTimestamp(key.activatedAt),
                },
              });
            }),
          );
        }).pipe(Effect.mapError(mapStorageFailure(operation)));
      };

    const beginEnrollment: CollaborationDeviceKeyStoreShape["beginEnrollment"] = (input) => {
      const operation = "device-enrollment.begin";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationBeginDeviceEnrollmentRequest,
          input.request,
        );
        const publicKey = canonicalEd25519PublicKeySpkiDer(request.publicKeySpkiDer);
        if (publicKey === null) return yield* Effect.fail(fail(operation, "invalid-input"));
        const nonce = decodeEnrollmentNonce(randomBytes(32).toString("base64url"));
        const challengeId = `device-challenge-${randomUUID()}`;
        const deviceKeyId = `device-key-${randomUUID()}`;

        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* lockProject(request.sharedProjectId);
            const now = DateTime.toEpochMillis(yield* DateTime.now);
            const actor = yield* authorizeCurrentMember(
              operation,
              input.principal,
              request.sharedProjectId,
              now,
            );
            const hash = receiptHash(operation, request, actor);
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireReceipt(operation, receipt, hash, actor);
              const stored = yield* parseCanonicalJson(operation, receipt.resultJson);
              const challenge = yield* strictDecode(
                operation,
                CollaborationDeviceEnrollmentChallenge,
                stored,
              ).pipe(Effect.mapError(() => fail(operation, "stored-corruption")));
              const rows = yield* selectChallenge(request.sharedProjectId, challenge.challengeId);
              if (rows.length !== 1)
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              const persisted = yield* challengeFromRow(operation, rows[0]!);
              if (
                challenge.sharedProjectId !== request.sharedProjectId ||
                challenge.userId !== actor.userId ||
                challenge.deviceId !== actor.deviceId ||
                challenge.membershipEpoch !== actor.membershipEpoch ||
                challenge.publicKeySpkiDer !== request.publicKeySpkiDer ||
                receipt.resultJson !==
                  JSON.stringify({
                    challengeId: persisted.challengeId,
                    sharedProjectId: persisted.sharedProjectId,
                    userId: persisted.userId,
                    deviceId: persisted.deviceId,
                    deviceKeyId: persisted.deviceKeyId,
                    publicKeySpkiDer: persisted.publicKeySpkiDer,
                    membershipEpoch: persisted.membershipEpoch,
                    issuedAt: proofTimestamp(persisted.issuedAt),
                    expiresAt: proofTimestamp(persisted.expiresAt),
                  })
              )
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              return yield* strictDecode(operation, CollaborationBeginDeviceEnrollmentResult, {
                disposition: "already-applied",
                challenge: stored,
                nonce: null,
              });
            }
            const issuedAt = nowIso(now);
            const expiresAt = nowIso(now + COLLABORATION_DEVICE_CHALLENGE_LIFETIME_MILLIS);
            const encodedChallenge = {
              challengeId,
              sharedProjectId: request.sharedProjectId,
              userId: actor.userId,
              deviceId: actor.deviceId,
              deviceKeyId,
              publicKeySpkiDer: request.publicKeySpkiDer,
              membershipEpoch: actor.membershipEpoch,
              issuedAt,
              expiresAt,
            };
            const challenge = yield* strictDecode(
              operation,
              CollaborationDeviceEnrollmentChallenge,
              encodedChallenge,
            );
            yield* sql`
              INSERT INTO collaboration_device_enrollment_challenges(
                challenge_id, shared_project_id, user_id, device_id, device_key_id,
                public_key_spki_der, nonce_sha256, membership_epoch, issued_at, expires_at
              ) VALUES (
                ${challengeId}, ${request.sharedProjectId}, ${actor.userId}, ${actor.deviceId},
                ${deviceKeyId}, ${publicKey}, ${nonceSha256(nonce)}, ${actor.membershipEpoch},
                ${issuedAt}, ${expiresAt}
              )
            `;
            yield* storeReceipt(
              operation,
              request.sharedProjectId,
              request.commandId,
              hash,
              actor,
              encodedChallenge,
              issuedAt,
            );
            return { disposition: "created", challenge, nonce } as const;
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const completeEnrollment: CollaborationDeviceKeyStoreShape["completeEnrollment"] = (input) => {
      const operation = "device-enrollment.complete";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationCompleteDeviceEnrollmentRequest,
          input.request,
        );
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* lockProject(request.sharedProjectId);
            const now = DateTime.toEpochMillis(yield* DateTime.now);
            const nowString = nowIso(now);
            const actor = yield* authorizeCurrentMember(
              operation,
              input.principal,
              request.sharedProjectId,
              now,
            );
            const hash = receiptHash(operation, request, actor);
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireReceipt(operation, receipt, hash, actor);
              const parsed = yield* parseCanonicalJson(operation, receipt.resultJson);
              const storedKey = yield* strictDecode(
                operation,
                CollaborationDeviceKeyRecord,
                parsed,
              ).pipe(Effect.mapError(() => fail(operation, "stored-corruption")));
              const rows = yield* selectKey(request.sharedProjectId, storedKey.deviceKeyId);
              if (rows.length !== 1)
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              const persisted = yield* keyFromRow(operation, rows[0]!);
              const challengeRows = yield* selectChallenge(
                request.sharedProjectId,
                request.challengeId,
              );
              if (challengeRows.length !== 1)
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              const persistedChallengeRow = challengeRows[0]!;
              const persistedChallenge = yield* challengeFromRow(operation, persistedChallengeRow);
              if (
                storedKey.sharedProjectId !== request.sharedProjectId ||
                storedKey.userId !== actor.userId ||
                storedKey.deviceId !== actor.deviceId ||
                storedKey.membershipEpoch !== actor.membershipEpoch ||
                persistedChallenge.challengeId !== request.challengeId ||
                persistedChallenge.sharedProjectId !== request.sharedProjectId ||
                persistedChallenge.userId !== actor.userId ||
                persistedChallenge.deviceId !== actor.deviceId ||
                persistedChallenge.deviceKeyId !== storedKey.deviceKeyId ||
                persistedChallenge.publicKeySpkiDer !== storedKey.publicKeySpkiDer ||
                persistedChallenge.membershipEpoch !== actor.membershipEpoch ||
                persistedChallengeRow.completedAt === null ||
                persistedChallengeRow.completedAt !== proofTimestamp(storedKey.activatedAt) ||
                persisted.sharedProjectId !== storedKey.sharedProjectId ||
                persisted.userId !== storedKey.userId ||
                persisted.deviceId !== storedKey.deviceId ||
                persisted.deviceKeyId !== storedKey.deviceKeyId ||
                persisted.publicKeySpkiDer !== storedKey.publicKeySpkiDer ||
                persisted.membershipEpoch !== storedKey.membershipEpoch ||
                proofTimestamp(persisted.activatedAt) !== proofTimestamp(storedKey.activatedAt) ||
                storedKey.revokedAt !== null
              )
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              return { disposition: "already-applied", key: storedKey } as const;
            }
            const rows = yield* selectChallenge(request.sharedProjectId, request.challengeId);
            if (rows.length === 0)
              return yield* Effect.fail(fail(operation, "challenge-not-found"));
            if (rows.length !== 1) return yield* Effect.fail(fail(operation, "stored-corruption"));
            const row = rows[0]!;
            const challenge = yield* challengeFromRow(operation, row);
            if (
              challenge.userId !== actor.userId ||
              challenge.deviceId !== actor.deviceId ||
              challenge.membershipEpoch !== actor.membershipEpoch ||
              !SHA256_PATTERN.test(row.nonceSha256) ||
              nonceSha256(request.nonce) !== row.nonceSha256
            )
              return yield* Effect.fail(fail(operation, "challenge-mismatch"));
            if (row.completedAt !== null)
              return yield* Effect.fail(fail(operation, "challenge-consumed"));
            if (now >= Date.parse(row.expiresAt))
              return yield* Effect.fail(fail(operation, "challenge-expired"));
            const publicKey = canonicalEd25519PublicKeySpkiDer(challenge.publicKeySpkiDer);
            if (publicKey === null) return yield* Effect.fail(fail(operation, "stored-corruption"));
            let signature: Buffer;
            try {
              signature = Buffer.from(request.proofSignature, "base64url");
            } catch {
              return yield* Effect.fail(fail(operation, "proof-invalid"));
            }
            if (
              signature.byteLength !== COLLABORATION_ED25519_SIGNATURE_BYTES ||
              signature.toString("base64url") !== request.proofSignature ||
              !verifyStrictEd25519Signature({
                publicKeySpkiDer: publicKey,
                signature,
                signedBytes: collaborationDeviceEnrollmentProofBytes({
                  challenge,
                  nonce: request.nonce,
                }),
              })
            )
              return yield* Effect.fail(fail(operation, "proof-invalid"));

            const bindings = yield* sql<{ readonly userId: string }>`
              SELECT user_id AS "userId" FROM collaboration_project_devices
              WHERE shared_project_id = ${request.sharedProjectId} AND device_id = ${actor.deviceId}
            `;
            if (bindings.length > 1)
              return yield* Effect.fail(fail(operation, "stored-corruption"));
            if (bindings[0] && bindings[0].userId !== actor.userId) {
              return yield* Effect.fail(fail(operation, "device-identity-conflict"));
            }
            if (bindings.length === 0) {
              yield* sql`
                INSERT INTO collaboration_project_devices(
                  shared_project_id, device_id, user_id, first_enrolled_at
                ) VALUES (${request.sharedProjectId}, ${actor.deviceId}, ${actor.userId}, ${nowString})
              `;
            }
            // Revoke first inside the same writer transaction. The unique
            // partial index then proves there is never more than one current key.
            yield* sql`
              UPDATE collaboration_device_keys
              SET revoked_at = ${nowString}
              WHERE shared_project_id = ${request.sharedProjectId}
                AND device_id = ${actor.deviceId} AND revoked_at IS NULL
            `;
            yield* sql`
              INSERT INTO collaboration_device_keys(
                device_key_id, shared_project_id, device_id, user_id,
                public_key_spki_der, membership_epoch, activated_at
              ) VALUES (
                ${challenge.deviceKeyId}, ${request.sharedProjectId}, ${actor.deviceId},
                ${actor.userId}, ${publicKey}, ${actor.membershipEpoch}, ${nowString}
              )
            `;
            yield* sql`
              UPDATE collaboration_device_enrollment_challenges
              SET completed_at = ${nowString}
              WHERE challenge_id = ${request.challengeId} AND completed_at IS NULL
            `;
            const changed = yield* sql<{ readonly count: number }>`SELECT changes() AS count`;
            if (changed[0]?.count !== 1)
              return yield* Effect.fail(fail(operation, "stored-corruption"));
            const encodedKey = {
              sharedProjectId: request.sharedProjectId,
              userId: actor.userId,
              deviceId: actor.deviceId,
              deviceKeyId: challenge.deviceKeyId,
              publicKeySpkiDer: challenge.publicKeySpkiDer,
              membershipEpoch: actor.membershipEpoch,
              activatedAt: nowString,
              revokedAt: null,
            };
            const key = yield* strictDecode(operation, CollaborationDeviceKeyRecord, encodedKey);
            yield* storeReceipt(
              operation,
              request.sharedProjectId,
              request.commandId,
              hash,
              actor,
              encodedKey,
              nowString,
            );
            return { disposition: "activated", key } as const;
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const revokeKey: CollaborationDeviceKeyStoreShape["revokeKey"] = (input) => {
      const operation = "device-key.revoke";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationRevokeDeviceKeyRequest,
          input.request,
        );
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* lockProject(request.sharedProjectId);
            const now = DateTime.toEpochMillis(yield* DateTime.now);
            const nowString = nowIso(now);
            const actor = yield* authorizeCurrentMember(
              operation,
              input.principal,
              request.sharedProjectId,
              now,
            );
            const hash = receiptHash(operation, request, actor);
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireReceipt(operation, receipt, hash, actor);
              const parsed = yield* parseCanonicalJson(operation, receipt.resultJson);
              const key = yield* strictDecode(operation, CollaborationDeviceKeyRecord, parsed).pipe(
                Effect.mapError(() => fail(operation, "stored-corruption")),
              );
              const rows = yield* selectKey(request.sharedProjectId, request.deviceKeyId);
              if (rows.length !== 1)
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              const persisted = yield* keyFromRow(operation, rows[0]!);
              if (
                key.sharedProjectId !== request.sharedProjectId ||
                key.deviceKeyId !== request.deviceKeyId ||
                key.userId !== actor.userId ||
                key.deviceId !== actor.deviceId ||
                persisted.sharedProjectId !== key.sharedProjectId ||
                persisted.userId !== key.userId ||
                persisted.deviceId !== key.deviceId ||
                persisted.deviceKeyId !== key.deviceKeyId ||
                persisted.publicKeySpkiDer !== key.publicKeySpkiDer ||
                persisted.membershipEpoch !== key.membershipEpoch ||
                proofTimestamp(persisted.activatedAt) !== proofTimestamp(key.activatedAt) ||
                persisted.revokedAt === null ||
                key.revokedAt === null ||
                proofTimestamp(persisted.revokedAt) !== proofTimestamp(key.revokedAt)
              ) {
                return yield* Effect.fail(fail(operation, "stored-corruption"));
              }
              return { disposition: "already-applied", key } as const;
            }
            const rows = yield* selectKey(request.sharedProjectId, request.deviceKeyId);
            if (rows.length === 0)
              return yield* Effect.fail(fail(operation, "device-key-not-found"));
            if (rows.length !== 1) return yield* Effect.fail(fail(operation, "stored-corruption"));
            const current = yield* keyFromRow(operation, rows[0]!);
            if (current.userId !== actor.userId || current.deviceId !== actor.deviceId) {
              return yield* Effect.fail(fail(operation, "device-key-not-found"));
            }
            if (current.revokedAt !== null)
              return yield* Effect.fail(fail(operation, "device-key-not-active"));
            yield* sql`
              UPDATE collaboration_device_keys SET revoked_at = ${nowString}
              WHERE shared_project_id = ${request.sharedProjectId}
                AND device_key_id = ${request.deviceKeyId} AND revoked_at IS NULL
            `;
            const changed = yield* sql<{ readonly count: number }>`SELECT changes() AS count`;
            if (changed[0]?.count !== 1)
              return yield* Effect.fail(fail(operation, "stored-corruption"));
            const encodedKey = {
              sharedProjectId: current.sharedProjectId,
              userId: current.userId,
              deviceId: current.deviceId,
              deviceKeyId: current.deviceKeyId,
              publicKeySpkiDer: current.publicKeySpkiDer,
              membershipEpoch: current.membershipEpoch,
              activatedAt: proofTimestamp(current.activatedAt),
              revokedAt: nowString,
            };
            const key = yield* strictDecode(operation, CollaborationDeviceKeyRecord, encodedKey);
            yield* storeReceipt(
              operation,
              request.sharedProjectId,
              request.commandId,
              hash,
              actor,
              encodedKey,
              nowString,
            );
            return { disposition: "revoked", key } as const;
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const getActiveEd25519PublicKey: CollaborationDeviceKeyStoreShape["getActiveEd25519PublicKey"] =
      (lookup) =>
        Effect.gen(function* () {
          const rows = yield* sql<KeyRow>`
          SELECT k.shared_project_id AS "sharedProjectId", k.user_id AS "userId",
            k.device_id AS "deviceId", k.device_key_id AS "deviceKeyId",
            k.public_key_spki_der AS "publicKeySpkiDer",
            k.membership_epoch AS "membershipEpoch", k.activated_at AS "activatedAt",
            k.revoked_at AS "revokedAt", d.user_id AS "boundUserId"
          FROM collaboration_device_keys k
          JOIN collaboration_project_devices d
            ON d.shared_project_id = k.shared_project_id AND d.device_id = k.device_id
          JOIN collaboration_projects p ON p.shared_project_id = k.shared_project_id
          JOIN collaboration_project_members m
            ON m.shared_project_id = k.shared_project_id AND m.user_id = k.user_id
          WHERE k.shared_project_id = ${lookup.sharedProjectId}
            AND k.user_id = ${lookup.userId}
            AND k.device_id = ${lookup.deviceId}
            AND k.device_key_id = ${lookup.deviceKeyId}
            AND k.revoked_at IS NULL
            AND p.membership_epoch = ${lookup.membershipEpoch}
            AND k.membership_epoch = p.membership_epoch
          LIMIT 2
        `;
          if (rows.length === 0) return null;
          if (rows.length !== 1) throw fail("device-key.authority", "stored-corruption");
          const key = yield* keyFromRow("device-key.authority", rows[0]!);
          if (
            key.sharedProjectId !== lookup.sharedProjectId ||
            key.userId !== lookup.userId ||
            key.deviceId !== lookup.deviceId ||
            key.deviceKeyId !== lookup.deviceKeyId ||
            key.membershipEpoch !== lookup.membershipEpoch ||
            key.revokedAt !== null
          )
            throw fail("device-key.authority", "stored-corruption");
          const bytes = canonicalEd25519PublicKeySpkiDer(key.publicKeySpkiDer);
          if (bytes === null) throw fail("device-key.authority", "stored-corruption");
          return {
            sharedProjectId: lookup.sharedProjectId,
            userId: lookup.userId,
            deviceId: lookup.deviceId,
            deviceKeyId: lookup.deviceKeyId,
            membershipEpoch: lookup.membershipEpoch,
            publicKeySpkiDer: Buffer.from(bytes),
          };
        }).pipe(Effect.mapError(mapStorageFailure("device-key.authority")));

    return {
      getCurrentDeviceKeyStatus,
      beginEnrollment,
      completeEnrollment,
      revokeKey,
      getActiveEd25519PublicKey,
    } satisfies CollaborationDeviceKeyStoreShape;
  });
}

export const CollaborationDeviceKeyStoreLive = Layer.effect(
  CollaborationDeviceKeyStore,
  makeStore(),
);

export const CollaborationDeviceKeyAuthorityFromStore = Layer.effect(
  CollaborationDeviceKeyAuthority,
  Effect.map(Effect.service(CollaborationDeviceKeyStore), (store) => ({
    getActiveEd25519PublicKey: store.getActiveEd25519PublicKey,
  })),
);
