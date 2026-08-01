import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationAgentId,
  CollaborationDeviceKeyId,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";
import { SharedReplicaRelativePath } from "./fileSync.ts";
import {
  CollaborationTaskFencingToken,
  CollaborationTaskId,
  CollaborationTaskLeaseId,
  CollaborationTaskRevision,
} from "./collaborationTask.ts";

export const COLLABORATION_AGENT_WRITABLE_PATH_LIMIT = 32;
export const COLLABORATION_AGENT_TOOLCHAIN_LIMIT = 8;
export const COLLABORATION_AGENT_EGRESS_RULE_LIMIT = 64;
export const COLLABORATION_AGENT_ATTESTATION_MAX_LIFETIME_MILLIS = 60_000;
export const COLLABORATION_AGENT_CPU_MILLIS_MIN = 100;
export const COLLABORATION_AGENT_CPU_MILLIS_MAX = 8_000;
export const COLLABORATION_AGENT_MEMORY_BYTES_MIN = 64 * 1024 * 1024;
export const COLLABORATION_AGENT_MEMORY_BYTES_MAX = 16 * 1024 * 1024 * 1024;
export const COLLABORATION_AGENT_PROCESS_LIMIT_MAX = 128;
export const COLLABORATION_AGENT_RUNTIME_MILLIS_MIN = 60_000;
export const COLLABORATION_AGENT_RUNTIME_MILLIS_MAX = 8 * 60 * 60_000;
export const COLLABORATION_AGENT_WRITABLE_BYTES_MAX = 10 * 1024 * 1024 * 1024;
export const COLLABORATION_AGENT_OUTPUT_BYTES_MAX = 16 * 1024 * 1024;

const OpaqueIdentifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);

export const CollaborationAgentAdmissionId = OpaqueIdentifier.pipe(
  Schema.brand("CollaborationAgentAdmissionId"),
);
export type CollaborationAgentAdmissionId = typeof CollaborationAgentAdmissionId.Type;
export const CollaborationManagedReplicaId = OpaqueIdentifier.pipe(
  Schema.brand("CollaborationManagedReplicaId"),
);
export type CollaborationManagedReplicaId = typeof CollaborationManagedReplicaId.Type;
export const CollaborationAgentToolchainId = OpaqueIdentifier.pipe(
  Schema.brand("CollaborationAgentToolchainId"),
);
export type CollaborationAgentToolchainId = typeof CollaborationAgentToolchainId.Type;
export const CollaborationIsolationInstanceId = OpaqueIdentifier.pipe(
  Schema.brand("CollaborationIsolationInstanceId"),
);
export type CollaborationIsolationInstanceId = typeof CollaborationIsolationInstanceId.Type;

const canonicalUnique = (values: ReadonlyArray<string>) =>
  new Set(values).size === values.length &&
  values.every((value, index) => index === 0 || values[index - 1]! < value);

export const CollaborationAgentSandboxAdmissionRequest = Schema.Struct({
  admissionId: CollaborationAgentAdmissionId,
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  deviceKeyId: CollaborationDeviceKeyId,
  leaseId: CollaborationTaskLeaseId,
  agentId: CollaborationAgentId,
  expectedTaskRevision: CollaborationTaskRevision,
  expectedFencingToken: CollaborationTaskFencingToken,
});
export type CollaborationAgentSandboxAdmissionRequest =
  typeof CollaborationAgentSandboxAdmissionRequest.Type;

export const CollaborationManagedReplicaBinding = Schema.Struct({
  sharedProjectId: SharedProjectId,
  replicaId: CollaborationManagedReplicaId,
  generation: PositiveInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  manifestSha256: CollaborationSha256,
  state: Schema.Literal("ready"),
  source: Schema.Literal("managed-project-replica"),
});
export type CollaborationManagedReplicaBinding = typeof CollaborationManagedReplicaBinding.Type;

export const CollaborationAgentWritableScope = Schema.Struct({
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  taskRevision: CollaborationTaskRevision,
  fencingToken: CollaborationTaskFencingToken,
  writablePaths: Schema.Array(SharedReplicaRelativePath).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COLLABORATION_AGENT_WRITABLE_PATH_LIMIT),
    Schema.makeFilter((paths) =>
      canonicalUnique(paths)
        ? undefined
        : "agent writable paths must be unique and canonically sorted",
    ),
  ),
});
export type CollaborationAgentWritableScope = typeof CollaborationAgentWritableScope.Type;

export const CollaborationAgentToolchainMount = Schema.Struct({
  toolchainId: CollaborationAgentToolchainId,
  access: Schema.Literal("read-only"),
  source: Schema.Literal("club-managed-toolchain"),
});
export type CollaborationAgentToolchainMount = typeof CollaborationAgentToolchainMount.Type;

const EgressHostname = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(253),
  Schema.isPattern(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/,
  ),
  Schema.makeFilter((hostname) =>
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
      ? "agent egress must not target local or metadata hosts"
      : undefined,
  ),
);

export const CollaborationAgentEgressRule = Schema.Struct({
  ruleId: OpaqueIdentifier,
  hostname: EgressHostname,
  port: PositiveInt.check(Schema.isLessThanOrEqualTo(65_535)),
  transport: Schema.Literal("tls-tcp"),
  resolution: Schema.Literal("backend-pinned-public-only"),
});
export type CollaborationAgentEgressRule = typeof CollaborationAgentEgressRule.Type;

export const CollaborationAgentNetworkPolicy = Schema.Struct({
  sharedProjectId: SharedProjectId,
  membershipEpoch: CollaborationMembershipEpoch,
  defaultAction: Schema.Literal("deny"),
  loopback: Schema.Literal("deny"),
  privateNetworks: Schema.Literal("deny"),
  dns: Schema.Literal("allowlisted-public-only"),
  allowlist: Schema.Array(CollaborationAgentEgressRule).check(
    Schema.isMaxLength(COLLABORATION_AGENT_EGRESS_RULE_LIMIT),
    Schema.makeFilter((rules) =>
      canonicalUnique(rules.map((rule) => `${rule.hostname}:${rule.port}:${rule.ruleId}`))
        ? undefined
        : "agent egress rules must be unique and canonically sorted",
    ),
  ),
});
export type CollaborationAgentNetworkPolicy = typeof CollaborationAgentNetworkPolicy.Type;

export const CollaborationAgentQuotaPolicy = Schema.Struct({
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  membershipEpoch: CollaborationMembershipEpoch,
  cpuMillisPerSecond: PositiveInt.check(
    Schema.isGreaterThanOrEqualTo(COLLABORATION_AGENT_CPU_MILLIS_MIN),
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_CPU_MILLIS_MAX),
  ),
  memoryBytes: PositiveInt.check(
    Schema.isGreaterThanOrEqualTo(COLLABORATION_AGENT_MEMORY_BYTES_MIN),
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_MEMORY_BYTES_MAX),
  ),
  processCount: PositiveInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_PROCESS_LIMIT_MAX),
  ),
  runtimeMillis: PositiveInt.check(
    Schema.isGreaterThanOrEqualTo(COLLABORATION_AGENT_RUNTIME_MILLIS_MIN),
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_RUNTIME_MILLIS_MAX),
  ),
  writableBytes: PositiveInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_WRITABLE_BYTES_MAX),
  ),
  stdoutBytes: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_OUTPUT_BYTES_MAX),
  ),
  stderrBytes: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_OUTPUT_BYTES_MAX),
  ),
});
export type CollaborationAgentQuotaPolicy = typeof CollaborationAgentQuotaPolicy.Type;

export const CollaborationAgentSandboxPolicy = Schema.Struct({
  version: Schema.Literal(1),
  admissionId: CollaborationAgentAdmissionId,
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  taskRevision: CollaborationTaskRevision,
  fencingToken: CollaborationTaskFencingToken,
  leaseId: CollaborationTaskLeaseId,
  agentId: CollaborationAgentId,
  actorUserId: UserId,
  actorDeviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  isolation: Schema.Struct({
    mode: Schema.Literal("strict-project"),
    hostAccess: Schema.Literal("none"),
    privilegeEscalation: Schema.Literal("deny"),
    providerDangerFullAccess: Schema.Literal(false),
  }),
  filesystem: Schema.Struct({
    managedReplica: CollaborationManagedReplicaBinding,
    replicaAccess: Schema.Literal("task-scoped-write"),
    writableScope: CollaborationAgentWritableScope,
    toolchains: Schema.Array(CollaborationAgentToolchainMount).check(
      Schema.isMaxLength(COLLABORATION_AGENT_TOOLCHAIN_LIMIT),
      Schema.makeFilter((mounts) =>
        canonicalUnique(mounts.map((mount) => mount.toolchainId))
          ? undefined
          : "toolchain mounts must be unique and canonically sorted",
      ),
    ),
    hostHome: Schema.Literal("unmounted"),
    hostCredentials: Schema.Literal("unmounted"),
    temporaryStorage: Schema.Literal("ephemeral-private"),
  }),
  network: CollaborationAgentNetworkPolicy,
  quotas: CollaborationAgentQuotaPolicy,
  environment: Schema.Struct({
    inheritHostEnvironment: Schema.Literal(false),
    ephemeralHome: Schema.Literal(true),
    credentialBroker: Schema.Literal("none"),
    variables: Schema.Struct({
      CLUB_CODE_SHARED_AGENT: Schema.Literal("1"),
      CI: Schema.Literal("1"),
      NO_COLOR: Schema.Literal("1"),
      LANG: Schema.Literal("C.UTF-8"),
      TZ: Schema.Literal("UTC"),
    }),
  }),
  telemetry: Schema.Struct({
    persistence: Schema.Literal("metadata-only"),
    promptPersistence: Schema.Literal("forbidden"),
    providerOutputPersistence: Schema.Literal("forbidden"),
    environmentPersistence: Schema.Literal("forbidden"),
  }),
  lifecycle: Schema.Struct({
    cancelSignal: Schema.Literal("required"),
    revocationSignal: Schema.Literal("required"),
    killScope: Schema.Literal("entire-sandbox-process-tree"),
  }),
}).check(
  Schema.makeFilter((policy) =>
    policy.filesystem.managedReplica.sharedProjectId === policy.sharedProjectId &&
    policy.filesystem.writableScope.sharedProjectId === policy.sharedProjectId &&
    policy.filesystem.writableScope.taskId === policy.taskId &&
    policy.filesystem.writableScope.taskRevision === policy.taskRevision &&
    policy.filesystem.writableScope.fencingToken === policy.fencingToken &&
    policy.network.sharedProjectId === policy.sharedProjectId &&
    policy.network.membershipEpoch === policy.membershipEpoch &&
    policy.quotas.sharedProjectId === policy.sharedProjectId &&
    policy.quotas.taskId === policy.taskId &&
    policy.quotas.membershipEpoch === policy.membershipEpoch
      ? undefined
      : "sandbox policy authorities must bind the exact project, task, epoch, revision, and fence",
  ),
);
export type CollaborationAgentSandboxPolicy = typeof CollaborationAgentSandboxPolicy.Type;

export const CollaborationIsolationBackend = Schema.Literals([
  "linux-container",
  "linux-landlock",
  "linux-microvm",
  "macos-seatbelt",
  "macos-virtualization",
  "windows-appcontainer",
  "windows-hyperv",
]);
export type CollaborationIsolationBackend = typeof CollaborationIsolationBackend.Type;

export const CollaborationAgentIsolationAttestation = Schema.Struct({
  admissionId: CollaborationAgentAdmissionId,
  policySha256: CollaborationSha256,
  backend: CollaborationIsolationBackend,
  backendClass: Schema.Literals(["container", "microvm", "os-sandbox"]),
  isolationInstanceId: CollaborationIsolationInstanceId,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  capabilities: Schema.Struct({
    filesystemMountIsolation: Schema.Literal(true),
    pathWriteFiltering: Schema.Literal(true),
    hostSecretDenial: Schema.Literal(true),
    environmentScrubbing: Schema.Literal(true),
    networkDefaultDeny: Schema.Literal(true),
    dnsRebindingProtection: Schema.Literal(true),
    resourceQuotas: Schema.Literal(true),
    processTreeTermination: Schema.Literal(true),
    revocationSignal: Schema.Literal(true),
  }),
}).check(
  Schema.makeFilter((attestation) => {
    const expectedClass =
      attestation.backend === "linux-container"
        ? "container"
        : attestation.backend === "linux-microvm" ||
            attestation.backend === "macos-virtualization" ||
            attestation.backend === "windows-hyperv"
          ? "microvm"
          : "os-sandbox";
    return attestation.backendClass === expectedClass
      ? undefined
      : "isolation backend class does not match the attested backend";
  }),
  Schema.makeFilter((attestation) => {
    const issued =
      typeof attestation.issuedAt === "string"
        ? Date.parse(attestation.issuedAt)
        : DateTime.toEpochMillis(attestation.issuedAt);
    const expires =
      typeof attestation.expiresAt === "string"
        ? Date.parse(attestation.expiresAt)
        : DateTime.toEpochMillis(attestation.expiresAt);
    const lifetime = expires - issued;
    return lifetime > 0 && lifetime <= COLLABORATION_AGENT_ATTESTATION_MAX_LIFETIME_MILLIS
      ? undefined
      : "isolation attestation lifetime is outside the supported range";
  }),
);
export type CollaborationAgentIsolationAttestation =
  typeof CollaborationAgentIsolationAttestation.Type;

export const CollaborationAgentSandboxAdmission = Schema.Struct({
  policy: CollaborationAgentSandboxPolicy,
  policySha256: CollaborationSha256,
  attestation: CollaborationAgentIsolationAttestation,
  admittedAt: Schema.DateTimeUtcFromString,
  launch: Schema.Literal("not-started"),
});
export type CollaborationAgentSandboxAdmission = typeof CollaborationAgentSandboxAdmission.Type;

export const CollaborationAgentSandboxDenialReason = Schema.Literals([
  "not-authorized",
  "device-key-unavailable",
  "task-unavailable",
  "lease-mismatch",
  "replica-unavailable",
  "scope-unavailable",
  "network-policy-invalid",
  "quota-policy-invalid",
  "isolation-unavailable",
  "attestation-invalid",
  "authority-changed",
  "audit-unavailable",
]);
export type CollaborationAgentSandboxDenialReason =
  typeof CollaborationAgentSandboxDenialReason.Type;

export const CollaborationAgentTerminationReason = Schema.Literals([
  "operator-cancelled",
  "membership-revoked",
  "device-revoked",
  "lease-lost",
  "fence-advanced",
  "quota-exceeded",
  "runtime-expired",
  "isolation-failure",
]);
export type CollaborationAgentTerminationReason = typeof CollaborationAgentTerminationReason.Type;

export const CollaborationAgentTerminationCommand = Schema.Struct({
  admissionId: CollaborationAgentAdmissionId,
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  leaseId: CollaborationTaskLeaseId,
  agentId: CollaborationAgentId,
  membershipEpoch: CollaborationMembershipEpoch,
  fencingToken: CollaborationTaskFencingToken,
  isolationInstanceId: CollaborationIsolationInstanceId,
  reason: CollaborationAgentTerminationReason,
  killScope: Schema.Literal("entire-sandbox-process-tree"),
  denyFurtherEgress: Schema.Literal(true),
  deleteEphemeralState: Schema.Literal(true),
});
export type CollaborationAgentTerminationCommand = typeof CollaborationAgentTerminationCommand.Type;

export const CollaborationAgentTerminationAcknowledgement = Schema.Struct({
  admissionId: CollaborationAgentAdmissionId,
  sharedProjectId: SharedProjectId,
  taskId: CollaborationTaskId,
  leaseId: CollaborationTaskLeaseId,
  agentId: CollaborationAgentId,
  membershipEpoch: CollaborationMembershipEpoch,
  fencingToken: CollaborationTaskFencingToken,
  isolationInstanceId: CollaborationIsolationInstanceId,
  reason: CollaborationAgentTerminationReason,
  terminated: Schema.Literal(true),
  furtherEgressDenied: Schema.Literal(true),
  entireProcessTreeTerminated: Schema.Literal(true),
  ephemeralStateDeleted: Schema.Literal(true),
  killedProcessCount: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_PROCESS_LIMIT_MAX),
  ),
  acknowledgedAt: Schema.DateTimeUtcFromString,
});
export type CollaborationAgentTerminationAcknowledgement =
  typeof CollaborationAgentTerminationAcknowledgement.Type;

export const CollaborationAgentSandboxAuditEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("admission-accepted"),
    admissionId: CollaborationAgentAdmissionId,
    sharedProjectId: SharedProjectId,
    taskId: CollaborationTaskId,
    leaseId: CollaborationTaskLeaseId,
    agentId: CollaborationAgentId,
    actorUserId: UserId,
    actorDeviceId: DeviceId,
    membershipEpoch: CollaborationMembershipEpoch,
    fencingToken: CollaborationTaskFencingToken,
    policySha256: CollaborationSha256,
    backend: CollaborationIsolationBackend,
    isolationInstanceId: CollaborationIsolationInstanceId,
    egressRuleCount: NonNegativeInt.check(
      Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_EGRESS_RULE_LIMIT),
    ),
    writablePathCount: PositiveInt.check(
      Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_WRITABLE_PATH_LIMIT),
    ),
    occurredAt: Schema.DateTimeUtcFromString,
  }),
  Schema.Struct({
    kind: Schema.Literal("admission-denied"),
    admissionId: CollaborationAgentAdmissionId,
    sharedProjectId: SharedProjectId,
    taskId: CollaborationTaskId,
    leaseId: CollaborationTaskLeaseId,
    agentId: CollaborationAgentId,
    reason: CollaborationAgentSandboxDenialReason,
    occurredAt: Schema.DateTimeUtcFromString,
  }),
  Schema.Struct({
    kind: Schema.Literal("sandbox-terminated"),
    admissionId: CollaborationAgentAdmissionId,
    sharedProjectId: SharedProjectId,
    taskId: CollaborationTaskId,
    leaseId: CollaborationTaskLeaseId,
    agentId: CollaborationAgentId,
    reason: CollaborationAgentTerminationReason,
    isolationInstanceId: CollaborationIsolationInstanceId,
    killedProcessCount: NonNegativeInt.check(
      Schema.isLessThanOrEqualTo(COLLABORATION_AGENT_PROCESS_LIMIT_MAX),
    ),
    occurredAt: Schema.DateTimeUtcFromString,
  }),
]);
export type CollaborationAgentSandboxAuditEvent = typeof CollaborationAgentSandboxAuditEvent.Type;
