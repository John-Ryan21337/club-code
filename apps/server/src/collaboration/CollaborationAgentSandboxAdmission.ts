import type {
  CollaborationAgentIsolationAttestation as CollaborationAgentIsolationAttestationType,
  CollaborationAgentSandboxAdmission as CollaborationAgentSandboxAdmissionType,
  CollaborationAgentSandboxAdmissionRequest as CollaborationAgentSandboxAdmissionRequestType,
  CollaborationAgentSandboxAuditEvent as CollaborationAgentSandboxAuditEventType,
  CollaborationAgentSandboxDenialReason,
  CollaborationAgentSandboxPolicy as CollaborationAgentSandboxPolicyType,
  CollaborationAgentTerminationAcknowledgement as CollaborationAgentTerminationAcknowledgementType,
  CollaborationAgentTerminationCommand as CollaborationAgentTerminationCommandType,
  CollaborationPrincipal,
  CollaborationSharedTask,
  SharedProjectId,
} from "@cafecode/contracts";
import {
  CollaborationAgentIsolationAttestation,
  CollaborationAgentNetworkPolicy,
  CollaborationAgentQuotaPolicy,
  CollaborationAgentSandboxAdmission,
  CollaborationAgentSandboxAdmissionRequest,
  CollaborationAgentSandboxAuditEvent,
  CollaborationAgentSandboxPolicy,
  CollaborationAgentTerminationAcknowledgement,
  CollaborationAgentTerminationCommand,
  CollaborationAgentToolchainMount,
  CollaborationAgentWritableScope,
  CollaborationManagedReplicaBinding,
} from "@cafecode/contracts";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  authorizeCollaborationPermission,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";
import { CollaborationDeviceKeyAuthority } from "./CollaborationEventAdmission.ts";
import { CollaborationTaskStore } from "./CollaborationTaskStore.ts";

type Operation = "admit" | "terminate";
export type CollaborationAgentSandboxAdmissionFailureReason =
  | "invalid-request"
  | CollaborationAgentSandboxDenialReason
  | "termination-failed";

export class CollaborationAgentSandboxAdmissionError extends Data.TaggedError(
  "CollaborationAgentSandboxAdmissionError",
)<{
  readonly operation: Operation;
  readonly reason: CollaborationAgentSandboxAdmissionFailureReason;
}> {}

/**
 * These authorities deliberately return unknown. Admission validates every
 * adapter result with strict schemas before it can become launch policy.
 * Implementations may resolve local host handles internally, but host paths,
 * credentials, prompts, and provider output never cross this boundary.
 */
export class CollaborationManagedReplicaAuthority extends Context.Service<
  CollaborationManagedReplicaAuthority,
  {
    readonly getReady: (sharedProjectId: SharedProjectId) => Effect.Effect<unknown, unknown>;
  }
>()("cafecode/collaboration/CollaborationManagedReplicaAuthority") {}

export class CollaborationAgentTaskScopeAuthority extends Context.Service<
  CollaborationAgentTaskScopeAuthority,
  {
    readonly getWritableScope: (input: {
      readonly sharedProjectId: SharedProjectId;
      readonly taskId: CollaborationAgentSandboxAdmissionRequestType["taskId"];
    }) => Effect.Effect<unknown, unknown>;
  }
>()("cafecode/collaboration/CollaborationAgentTaskScopeAuthority") {}

export class CollaborationAgentToolchainAuthority extends Context.Service<
  CollaborationAgentToolchainAuthority,
  {
    readonly getReadOnlyToolchains: (
      sharedProjectId: SharedProjectId,
    ) => Effect.Effect<unknown, unknown>;
  }
>()("cafecode/collaboration/CollaborationAgentToolchainAuthority") {}

export class CollaborationAgentNetworkPolicyAuthority extends Context.Service<
  CollaborationAgentNetworkPolicyAuthority,
  {
    readonly getPolicy: (sharedProjectId: SharedProjectId) => Effect.Effect<unknown, unknown>;
  }
>()("cafecode/collaboration/CollaborationAgentNetworkPolicyAuthority") {}

export class CollaborationAgentQuotaAuthority extends Context.Service<
  CollaborationAgentQuotaAuthority,
  {
    readonly getPolicy: (input: {
      readonly sharedProjectId: SharedProjectId;
      readonly taskId: CollaborationAgentSandboxAdmissionRequestType["taskId"];
    }) => Effect.Effect<unknown, unknown>;
  }
>()("cafecode/collaboration/CollaborationAgentQuotaAuthority") {}

export class CollaborationAgentIsolationAuthority extends Context.Service<
  CollaborationAgentIsolationAuthority,
  {
    readonly attest: (input: {
      readonly policy: CollaborationAgentSandboxPolicyType;
      readonly policySha256: string;
    }) => Effect.Effect<unknown, unknown>;
  }
>()("cafecode/collaboration/CollaborationAgentIsolationAuthority") {}

export class CollaborationAgentTerminationAuthority extends Context.Service<
  CollaborationAgentTerminationAuthority,
  {
    readonly terminate: (
      command: CollaborationAgentTerminationCommandType,
    ) => Effect.Effect<unknown, unknown>;
  }
>()("cafecode/collaboration/CollaborationAgentTerminationAuthority") {}

export class CollaborationAgentSandboxAuditSink extends Context.Service<
  CollaborationAgentSandboxAuditSink,
  {
    /** The schema contains metadata only; implementations must not enrich it. */
    readonly record: (
      event: CollaborationAgentSandboxAuditEventType,
    ) => Effect.Effect<void, unknown>;
  }
>()("cafecode/collaboration/CollaborationAgentSandboxAuditSink") {}

type AdmissionRequirements =
  | CollaborationMembershipAuthority
  | CollaborationDeviceKeyAuthority
  | CollaborationTaskStore
  | CollaborationManagedReplicaAuthority
  | CollaborationAgentTaskScopeAuthority
  | CollaborationAgentToolchainAuthority
  | CollaborationAgentNetworkPolicyAuthority
  | CollaborationAgentQuotaAuthority
  | CollaborationAgentIsolationAuthority
  | CollaborationAgentSandboxAuditSink;

export interface CollaborationAgentSandboxAdmissionShape {
  readonly admit: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<
    CollaborationAgentSandboxAdmissionType,
    CollaborationAgentSandboxAdmissionError,
    AdmissionRequirements
  >;
  /**
   * Trusted internal cancellation/revocation boundary. No listener or public
   * RPC is installed by this slice. The concrete runner must atomically deny
   * egress and kill the entire sandbox process tree before acknowledging.
   */
  readonly terminate: (
    command: unknown,
  ) => Effect.Effect<
    CollaborationAgentTerminationAcknowledgementType,
    CollaborationAgentSandboxAdmissionError,
    CollaborationAgentTerminationAuthority | CollaborationAgentSandboxAuditSink
  >;
}

export class CollaborationAgentSandboxAdmissionService extends Context.Service<
  CollaborationAgentSandboxAdmissionService,
  CollaborationAgentSandboxAdmissionShape
>()("cafecode/collaboration/CollaborationAgentSandboxAdmissionService") {}

const fail = (operation: Operation, reason: CollaborationAgentSandboxAdmissionFailureReason) =>
  new CollaborationAgentSandboxAdmissionError({ operation, reason });
const decodeRequest = Schema.decodeUnknownEffect(CollaborationAgentSandboxAdmissionRequest);
const decodeReplica = Schema.decodeUnknownEffect(CollaborationManagedReplicaBinding);
const decodeScope = Schema.decodeUnknownEffect(CollaborationAgentWritableScope);
const decodeToolchains = Schema.decodeUnknownEffect(Schema.Array(CollaborationAgentToolchainMount));
const decodeNetwork = Schema.decodeUnknownEffect(CollaborationAgentNetworkPolicy);
const decodeQuotas = Schema.decodeUnknownEffect(CollaborationAgentQuotaPolicy);
const decodePolicy = Schema.decodeUnknownSync(CollaborationAgentSandboxPolicy);
const encodePolicy = Schema.encodeUnknownSync(CollaborationAgentSandboxPolicy);
const decodeAttestation = Schema.decodeUnknownEffect(CollaborationAgentIsolationAttestation);
const encodeAttestation = Schema.encodeUnknownSync(CollaborationAgentIsolationAttestation);
const decodeAdmission = Schema.decodeUnknownSync(CollaborationAgentSandboxAdmission);
const decodeTermination = Schema.decodeUnknownEffect(CollaborationAgentTerminationCommand);
const decodeTerminationAck = Schema.decodeUnknownEffect(
  CollaborationAgentTerminationAcknowledgement,
);
const decodeAudit = Schema.decodeUnknownSync(CollaborationAgentSandboxAuditEvent);

const policyHash = (policy: CollaborationAgentSandboxPolicyType) =>
  createHash("sha256")
    .update("club-code-shared-agent-sandbox-policy-v1")
    .update("\0")
    .update(JSON.stringify(encodePolicy(policy)))
    .digest("hex");

/** Isolation adapters receive a detached policy, never the returned object. */
const detachedPolicy = (policy: CollaborationAgentSandboxPolicyType) =>
  decodePolicy(JSON.parse(JSON.stringify(encodePolicy(policy))), {
    onExcessProperty: "error",
  });

const backendSupportedOnHost = (backend: CollaborationAgentIsolationAttestationType["backend"]) =>
  process.platform === "win32"
    ? backend.startsWith("windows-")
    : process.platform === "darwin"
      ? backend.startsWith("macos-")
      : process.platform === "linux" && backend.startsWith("linux-");

const sameDecodedValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function verifyTaskBinding(
  request: CollaborationAgentSandboxAdmissionRequestType,
  task: CollaborationSharedTask,
  principal: CollaborationPrincipal,
  nowMillis: number,
): Effect.Effect<void, CollaborationAgentSandboxAdmissionError> {
  const lease = task.activeAgentLease;
  if (
    task.sharedProjectId !== request.sharedProjectId ||
    task.taskId !== request.taskId ||
    task.status !== "claimed" ||
    task.ownerUserId !== principal.userId ||
    task.revision !== request.expectedTaskRevision ||
    task.fencingToken !== request.expectedFencingToken ||
    lease === null ||
    lease.leaseId !== request.leaseId ||
    lease.agentId !== request.agentId ||
    lease.holderUserId !== principal.userId ||
    lease.holderDeviceId !== principal.deviceId ||
    lease.membershipEpoch !== principal.membershipEpoch ||
    lease.fencingToken !== request.expectedFencingToken ||
    DateTime.toEpochMillis(lease.expiresAt) <= nowMillis
  )
    return Effect.fail(fail("admit", "lease-mismatch"));
  return Effect.void;
}

const makeService = Effect.succeed({
  admit: (input) =>
    Effect.gen(function* () {
      const request = yield* decodeRequest(input.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail("admit", "invalid-request")),
      );
      const audit = yield* CollaborationAgentSandboxAuditSink;
      const attempt = Effect.gen(function* () {
        const membershipGrant = yield* authorizeCollaborationPermission({
          principal: input.principal,
          targetProjectId: request.sharedProjectId,
          permission: "agent.dispatch",
        }).pipe(Effect.mapError(() => fail("admit", "not-authorized")));
        const principal = membershipGrant.principal;
        const devices = yield* CollaborationDeviceKeyAuthority;
        const key = yield* devices
          .getActiveEd25519PublicKey({
            sharedProjectId: request.sharedProjectId,
            userId: principal.userId,
            deviceId: principal.deviceId,
            deviceKeyId: request.deviceKeyId,
            membershipEpoch: principal.membershipEpoch,
          })
          .pipe(Effect.mapError(() => fail("admit", "device-key-unavailable")));
        if (
          key === null ||
          key.sharedProjectId !== request.sharedProjectId ||
          key.userId !== principal.userId ||
          key.deviceId !== principal.deviceId ||
          key.deviceKeyId !== request.deviceKeyId ||
          key.membershipEpoch !== principal.membershipEpoch ||
          !(key.publicKeySpkiDer instanceof Uint8Array) ||
          key.publicKeySpkiDer.byteLength !== 44
        )
          return yield* Effect.fail(fail("admit", "device-key-unavailable"));
        const devicePublicKey = Buffer.from(key.publicKeySpkiDer);

        const tasks = yield* CollaborationTaskStore;
        const task = yield* tasks
          .read({
            principal,
            request: {
              sharedProjectId: request.sharedProjectId,
              taskId: request.taskId,
              deviceKeyId: request.deviceKeyId,
            },
          })
          .pipe(Effect.mapError(() => fail("admit", "task-unavailable")));
        const now = yield* DateTime.now;
        const nowMillis = DateTime.toEpochMillis(now);
        yield* verifyTaskBinding(request, task, principal, nowMillis);

        const replicas = yield* CollaborationManagedReplicaAuthority;
        const scopes = yield* CollaborationAgentTaskScopeAuthority;
        const toolchainAuthority = yield* CollaborationAgentToolchainAuthority;
        const networks = yield* CollaborationAgentNetworkPolicyAuthority;
        const quotas = yield* CollaborationAgentQuotaAuthority;
        const replica = yield* replicas.getReady(request.sharedProjectId).pipe(
          Effect.flatMap((value) => decodeReplica(value, { onExcessProperty: "error" })),
          Effect.mapError(() => fail("admit", "replica-unavailable")),
        );
        const scope = yield* scopes
          .getWritableScope({
            sharedProjectId: request.sharedProjectId,
            taskId: request.taskId,
          })
          .pipe(
            Effect.flatMap((value) => decodeScope(value, { onExcessProperty: "error" })),
            Effect.mapError(() => fail("admit", "scope-unavailable")),
          );
        const toolchains = yield* toolchainAuthority
          .getReadOnlyToolchains(request.sharedProjectId)
          .pipe(
            Effect.flatMap((value) => decodeToolchains(value, { onExcessProperty: "error" })),
            Effect.mapError(() => fail("admit", "scope-unavailable")),
          );
        const network = yield* networks.getPolicy(request.sharedProjectId).pipe(
          Effect.flatMap((value) => decodeNetwork(value, { onExcessProperty: "error" })),
          Effect.mapError(() => fail("admit", "network-policy-invalid")),
        );
        const quota = yield* quotas
          .getPolicy({ sharedProjectId: request.sharedProjectId, taskId: request.taskId })
          .pipe(
            Effect.flatMap((value) => decodeQuotas(value, { onExcessProperty: "error" })),
            Effect.mapError(() => fail("admit", "quota-policy-invalid")),
          );
        const policy = yield* Effect.try({
          try: () =>
            decodePolicy(
              {
                version: 1,
                admissionId: request.admissionId,
                sharedProjectId: request.sharedProjectId,
                taskId: request.taskId,
                taskRevision: task.revision,
                fencingToken: task.fencingToken,
                leaseId: request.leaseId,
                agentId: request.agentId,
                actorUserId: principal.userId,
                actorDeviceId: principal.deviceId,
                membershipEpoch: principal.membershipEpoch,
                isolation: {
                  mode: "strict-project",
                  hostAccess: "none",
                  privilegeEscalation: "deny",
                  providerDangerFullAccess: false,
                },
                filesystem: {
                  managedReplica: replica,
                  replicaAccess: "task-scoped-write",
                  writableScope: scope,
                  toolchains,
                  hostHome: "unmounted",
                  hostCredentials: "unmounted",
                  temporaryStorage: "ephemeral-private",
                },
                network,
                quotas: quota,
                environment: {
                  inheritHostEnvironment: false,
                  ephemeralHome: true,
                  credentialBroker: "none",
                  variables: {
                    CLUB_CODE_SHARED_AGENT: "1",
                    CI: "1",
                    NO_COLOR: "1",
                    LANG: "C.UTF-8",
                    TZ: "UTC",
                  },
                },
                telemetry: {
                  persistence: "metadata-only",
                  promptPersistence: "forbidden",
                  providerOutputPersistence: "forbidden",
                  environmentPersistence: "forbidden",
                },
                lifecycle: {
                  cancelSignal: "required",
                  revocationSignal: "required",
                  killScope: "entire-sandbox-process-tree",
                },
              },
              { onExcessProperty: "error" },
            ),
          // An authority may return an otherwise valid but oversized mount
          // set. Keep that synchronous schema failure in the audited
          // fail-closed admission path instead of escaping as a defect.
          catch: () => fail("admit", "scope-unavailable"),
        });
        const digest = policyHash(policy);
        const policyForAttestation = detachedPolicy(policy);
        const isolation = yield* CollaborationAgentIsolationAuthority;
        const attestation = yield* isolation
          .attest({ policy: policyForAttestation, policySha256: digest })
          .pipe(
            Effect.flatMap((value) => decodeAttestation(value, { onExcessProperty: "error" })),
            Effect.mapError(() => fail("admit", "isolation-unavailable")),
          );
        const attestationNow = yield* DateTime.now;
        const attestationNowMillis = DateTime.toEpochMillis(attestationNow);
        const attestationIssued = DateTime.toEpochMillis(attestation.issuedAt);
        const attestationExpires = DateTime.toEpochMillis(attestation.expiresAt);
        if (
          attestation.admissionId !== request.admissionId ||
          attestation.policySha256 !== digest ||
          !backendSupportedOnHost(attestation.backend) ||
          attestationIssued > attestationNowMillis ||
          attestationExpires <= attestationNowMillis
        )
          return yield* Effect.fail(fail("admit", "attestation-invalid"));

        // Refresh every mutable authority after attestation. If membership,
        // device, task lease/fence, replica generation, scope, egress, or quota
        // changed while the backend prepared isolation, no launch token exists.
        const finalGrant = yield* authorizeCollaborationPermission({
          principal,
          targetProjectId: request.sharedProjectId,
          permission: "agent.dispatch",
        }).pipe(Effect.mapError(() => fail("admit", "authority-changed")));
        const finalKey = yield* devices
          .getActiveEd25519PublicKey({
            sharedProjectId: request.sharedProjectId,
            userId: principal.userId,
            deviceId: principal.deviceId,
            deviceKeyId: request.deviceKeyId,
            membershipEpoch: principal.membershipEpoch,
          })
          .pipe(Effect.mapError(() => fail("admit", "authority-changed")));
        if (
          finalGrant.principal.userId !== principal.userId ||
          finalGrant.principal.deviceId !== principal.deviceId ||
          finalGrant.principal.membershipEpoch !== principal.membershipEpoch ||
          finalKey === null ||
          finalKey.sharedProjectId !== request.sharedProjectId ||
          finalKey.userId !== principal.userId ||
          finalKey.deviceId !== principal.deviceId ||
          finalKey.deviceKeyId !== request.deviceKeyId ||
          finalKey.membershipEpoch !== principal.membershipEpoch ||
          !(finalKey.publicKeySpkiDer instanceof Uint8Array) ||
          finalKey.publicKeySpkiDer.byteLength !== 44 ||
          !Buffer.from(finalKey.publicKeySpkiDer).equals(devicePublicKey)
        )
          return yield* Effect.fail(fail("admit", "authority-changed"));
        const finalTask = yield* tasks
          .read({
            principal,
            request: {
              sharedProjectId: request.sharedProjectId,
              taskId: request.taskId,
              deviceKeyId: request.deviceKeyId,
            },
          })
          .pipe(Effect.mapError(() => fail("admit", "authority-changed")));
        const finalNow = yield* DateTime.now;
        const finalNowMillis = DateTime.toEpochMillis(finalNow);
        if (
          finalNowMillis < attestationNowMillis ||
          finalNowMillis < attestationIssued ||
          attestationExpires <= finalNowMillis
        )
          return yield* Effect.fail(fail("admit", "authority-changed"));
        yield* verifyTaskBinding(
          request,
          finalTask,
          principal,
          DateTime.toEpochMillis(finalNow),
        ).pipe(Effect.mapError(() => fail("admit", "authority-changed")));
        const [finalReplica, finalScope, finalToolchains, finalNetwork, finalQuota] =
          yield* Effect.all(
            [
              replicas
                .getReady(request.sharedProjectId)
                .pipe(
                  Effect.flatMap((value) => decodeReplica(value, { onExcessProperty: "error" })),
                ),
              scopes
                .getWritableScope({
                  sharedProjectId: request.sharedProjectId,
                  taskId: request.taskId,
                })
                .pipe(Effect.flatMap((value) => decodeScope(value, { onExcessProperty: "error" }))),
              toolchainAuthority
                .getReadOnlyToolchains(request.sharedProjectId)
                .pipe(
                  Effect.flatMap((value) => decodeToolchains(value, { onExcessProperty: "error" })),
                ),
              networks
                .getPolicy(request.sharedProjectId)
                .pipe(
                  Effect.flatMap((value) => decodeNetwork(value, { onExcessProperty: "error" })),
                ),
              quotas
                .getPolicy({ sharedProjectId: request.sharedProjectId, taskId: request.taskId })
                .pipe(
                  Effect.flatMap((value) => decodeQuotas(value, { onExcessProperty: "error" })),
                ),
            ] as const,
            { concurrency: "unbounded" },
          ).pipe(Effect.mapError(() => fail("admit", "authority-changed")));
        if (
          !sameDecodedValue(replica, finalReplica) ||
          !sameDecodedValue(scope, finalScope) ||
          !sameDecodedValue(toolchains, finalToolchains) ||
          !sameDecodedValue(network, finalNetwork) ||
          !sameDecodedValue(quota, finalQuota)
        )
          return yield* Effect.fail(fail("admit", "authority-changed"));

        const occurredAt = DateTime.formatIso(finalNow);
        const auditEvent = decodeAudit({
          kind: "admission-accepted",
          admissionId: request.admissionId,
          sharedProjectId: request.sharedProjectId,
          taskId: request.taskId,
          leaseId: request.leaseId,
          agentId: request.agentId,
          actorUserId: principal.userId,
          actorDeviceId: principal.deviceId,
          membershipEpoch: principal.membershipEpoch,
          fencingToken: request.expectedFencingToken,
          policySha256: digest,
          backend: attestation.backend,
          isolationInstanceId: attestation.isolationInstanceId,
          egressRuleCount: network.allowlist.length,
          writablePathCount: scope.writablePaths.length,
          occurredAt,
        });
        yield* audit
          .record(auditEvent)
          .pipe(Effect.mapError(() => fail("admit", "audit-unavailable")));
        return decodeAdmission({
          policy: encodePolicy(policy),
          policySha256: digest,
          attestation: encodeAttestation(attestation),
          admittedAt: occurredAt,
          launch: "not-started",
        });
      });
      return yield* attempt.pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const deniedAt = yield* DateTime.now;
            yield* audit.record(
              decodeAudit({
                kind: "admission-denied",
                admissionId: request.admissionId,
                sharedProjectId: request.sharedProjectId,
                taskId: request.taskId,
                leaseId: request.leaseId,
                agentId: request.agentId,
                reason:
                  error.reason === "invalid-request" || error.reason === "termination-failed"
                    ? "not-authorized"
                    : error.reason,
                occurredAt: DateTime.formatIso(deniedAt),
              }),
            );
          }).pipe(Effect.ignore),
        ),
      );
    }),
  terminate: (rawCommand) =>
    Effect.gen(function* () {
      const command = yield* decodeTermination(rawCommand, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail("terminate", "invalid-request")),
      );
      const termination = yield* CollaborationAgentTerminationAuthority;
      const acknowledgement = yield* termination.terminate(command).pipe(
        Effect.flatMap((value) => decodeTerminationAck(value, { onExcessProperty: "error" })),
        Effect.mapError(() => fail("terminate", "termination-failed")),
      );
      if (
        acknowledgement.admissionId !== command.admissionId ||
        acknowledgement.sharedProjectId !== command.sharedProjectId ||
        acknowledgement.taskId !== command.taskId ||
        acknowledgement.leaseId !== command.leaseId ||
        acknowledgement.agentId !== command.agentId ||
        acknowledgement.membershipEpoch !== command.membershipEpoch ||
        acknowledgement.fencingToken !== command.fencingToken ||
        acknowledgement.isolationInstanceId !== command.isolationInstanceId ||
        acknowledgement.reason !== command.reason
      )
        return yield* Effect.fail(fail("terminate", "termination-failed"));
      const audit = yield* CollaborationAgentSandboxAuditSink;
      yield* audit
        .record(
          decodeAudit({
            kind: "sandbox-terminated",
            admissionId: command.admissionId,
            sharedProjectId: command.sharedProjectId,
            taskId: command.taskId,
            leaseId: command.leaseId,
            agentId: command.agentId,
            reason: command.reason,
            isolationInstanceId: command.isolationInstanceId,
            killedProcessCount: acknowledgement.killedProcessCount,
            occurredAt: DateTime.formatIso(acknowledgement.acknowledgedAt),
          }),
        )
        .pipe(Effect.mapError(() => fail("terminate", "audit-unavailable")));
      return acknowledgement;
    }),
} satisfies CollaborationAgentSandboxAdmissionShape);

export const CollaborationAgentSandboxAdmissionLive = Layer.effect(
  CollaborationAgentSandboxAdmissionService,
  makeService,
);
