import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  COLLABORATION_AGENT_ATTESTATION_MAX_LIFETIME_MILLIS,
  COLLABORATION_AGENT_MEMORY_BYTES_MAX,
  CollaborationAgentIsolationAttestation,
  CollaborationAgentNetworkPolicy,
  CollaborationAgentQuotaPolicy,
  CollaborationAgentSandboxAuditEvent,
  CollaborationAgentSandboxPolicy,
  CollaborationAgentTerminationAcknowledgement,
  CollaborationAgentTerminationCommand,
  CollaborationAgentWritableScope,
} from "./collaborationAgentSandbox.ts";

const decodePolicySchema = Schema.decodeUnknownSync(CollaborationAgentSandboxPolicy);
const decodeAttestation = Schema.decodeUnknownSync(CollaborationAgentIsolationAttestation);
const decodeNetwork = Schema.decodeUnknownSync(CollaborationAgentNetworkPolicy);
const decodeQuotas = Schema.decodeUnknownSync(CollaborationAgentQuotaPolicy);
const decodeTermination = Schema.decodeUnknownSync(CollaborationAgentTerminationCommand);
const decodeTerminationAck = Schema.decodeUnknownSync(CollaborationAgentTerminationAcknowledgement);
const decodeAudit = Schema.decodeUnknownSync(CollaborationAgentSandboxAuditEvent);
const decodePolicy = (value: unknown) => decodePolicySchema(value, { onExcessProperty: "error" });
const hash = "a".repeat(64);
const scope = {
  sharedProjectId: "project-1",
  taskId: "task-1",
  taskRevision: 3,
  fencingToken: 2,
  writablePaths: ["src/task-1"],
};
const network = {
  sharedProjectId: "project-1",
  membershipEpoch: 4,
  defaultAction: "deny" as const,
  loopback: "deny" as const,
  privateNetworks: "deny" as const,
  dns: "allowlisted-public-only" as const,
  allowlist: [
    {
      ruleId: "registry",
      hostname: "registry.example.com",
      port: 443,
      transport: "tls-tcp" as const,
      resolution: "backend-pinned-public-only" as const,
    },
  ],
};
const quotas = {
  sharedProjectId: "project-1",
  taskId: "task-1",
  membershipEpoch: 4,
  cpuMillisPerSecond: 1_000,
  memoryBytes: 512 * 1024 * 1024,
  processCount: 16,
  runtimeMillis: 60_000,
  writableBytes: 512 * 1024 * 1024,
  stdoutBytes: 1024 * 1024,
  stderrBytes: 1024 * 1024,
};
const policy = {
  version: 1,
  admissionId: "admission-1",
  sharedProjectId: "project-1",
  taskId: "task-1",
  taskRevision: 3,
  fencingToken: 2,
  leaseId: "lease-1",
  agentId: "agent-1",
  actorUserId: "user-1",
  actorDeviceId: "device-1",
  membershipEpoch: 4,
  isolation: {
    mode: "strict-project" as const,
    hostAccess: "none" as const,
    privilegeEscalation: "deny" as const,
    providerDangerFullAccess: false,
  },
  filesystem: {
    managedReplica: {
      sharedProjectId: "project-1",
      replicaId: "replica-1",
      generation: 9,
      manifestSha256: hash,
      state: "ready" as const,
      source: "managed-project-replica" as const,
    },
    replicaAccess: "task-scoped-write" as const,
    writableScope: scope,
    toolchains: [
      {
        toolchainId: "node-22",
        access: "read-only" as const,
        source: "club-managed-toolchain" as const,
      },
    ],
    hostHome: "unmounted" as const,
    hostCredentials: "unmounted" as const,
    temporaryStorage: "ephemeral-private" as const,
  },
  network,
  quotas,
  environment: {
    inheritHostEnvironment: false,
    ephemeralHome: true,
    credentialBroker: "none" as const,
    variables: {
      CLUB_CODE_SHARED_AGENT: "1" as const,
      CI: "1" as const,
      NO_COLOR: "1" as const,
      LANG: "C.UTF-8" as const,
      TZ: "UTC" as const,
    },
  },
  telemetry: {
    persistence: "metadata-only" as const,
    promptPersistence: "forbidden" as const,
    providerOutputPersistence: "forbidden" as const,
    environmentPersistence: "forbidden" as const,
  },
  lifecycle: {
    cancelSignal: "required" as const,
    revocationSignal: "required" as const,
    killScope: "entire-sandbox-process-tree" as const,
  },
};

describe("shared-agent sandbox contracts", () => {
  it("makes host access, danger-full-access, secret mounts and inherited environment unrepresentable", () => {
    assert.equal(decodePolicy(policy).isolation.mode, "strict-project");
    assert.throws(() =>
      decodePolicy({
        ...policy,
        isolation: { ...policy.isolation, providerDangerFullAccess: true },
      }),
    );
    assert.throws(() =>
      decodePolicy({
        ...policy,
        filesystem: {
          ...policy.filesystem,
          mounts: [{ source: "C:/Users/Alice/.ssh", access: "read-write" }],
        },
      }),
    );
    assert.throws(() =>
      decodePolicy({
        ...policy,
        environment: {
          ...policy.environment,
          inheritHostEnvironment: true,
          variables: { ...policy.environment.variables, AWS_SECRET_ACCESS_KEY: "secret" },
        },
      }),
    );
  });

  it("requires a canonical, non-root, task-bound writable scope", () => {
    const decode = Schema.decodeUnknownSync(CollaborationAgentWritableScope);
    assert.equal(decode(scope).writablePaths[0], "src/task-1");
    for (const writablePaths of [["../escape"], ["."], ["src/task", "src/task"]])
      assert.throws(() => decode({ ...scope, writablePaths }));
    assert.throws(() =>
      decodePolicy({
        ...policy,
        filesystem: {
          ...policy.filesystem,
          writableScope: { ...scope, taskId: "task-2" },
        },
      }),
    );
  });

  it("enforces default-deny public-only egress and bounded quotas", () => {
    assert.equal(decodeNetwork(network).defaultAction, "deny");
    for (const hostname of ["localhost", "169.254.169.254", "*.example.com", "host.local"])
      assert.throws(() =>
        decodeNetwork({
          ...network,
          allowlist: [{ ...network.allowlist[0], hostname }],
        }),
      );
    assert.throws(() => decodeNetwork({ ...network, defaultAction: "allow" }));
    assert.throws(() => decodeQuotas({ ...quotas, processCount: 0 }));
    assert.throws(() =>
      decodeQuotas({ ...quotas, memoryBytes: COLLABORATION_AGENT_MEMORY_BYTES_MAX + 1 }),
    );
  });

  it("requires short-lived complete backend attestation and whole-tree termination", () => {
    const attestation = {
      admissionId: "admission-1",
      policySha256: hash,
      backend: "windows-appcontainer" as const,
      backendClass: "os-sandbox" as const,
      isolationInstanceId: "sandbox-1",
      issuedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2026-08-01T12:00:30.000Z",
      capabilities: {
        filesystemMountIsolation: true,
        pathWriteFiltering: true,
        hostSecretDenial: true,
        environmentScrubbing: true,
        networkDefaultDeny: true,
        dnsRebindingProtection: true,
        resourceQuotas: true,
        processTreeTermination: true,
        revocationSignal: true,
      },
    };
    assert.equal(decodeAttestation(attestation).backendClass, "os-sandbox");
    assert.throws(() => decodeAttestation({ ...attestation, backendClass: "container" }));
    assert.throws(() =>
      decodeAttestation({
        ...attestation,
        expiresAt: new Date(
          Date.parse(attestation.issuedAt) +
            COLLABORATION_AGENT_ATTESTATION_MAX_LIFETIME_MILLIS +
            1,
        ).toISOString(),
      }),
    );
    assert.throws(() =>
      decodeAttestation({
        ...attestation,
        capabilities: { ...attestation.capabilities, networkDefaultDeny: false },
      }),
    );
    assert.throws(() =>
      decodeTermination({
        admissionId: "admission-1",
        sharedProjectId: "project-1",
        taskId: "task-1",
        leaseId: "lease-1",
        agentId: "agent-1",
        membershipEpoch: 4,
        fencingToken: 2,
        isolationInstanceId: "sandbox-1",
        reason: "membership-revoked",
        killScope: "one-process",
        denyFurtherEgress: true,
        deleteEphemeralState: true,
      }),
    );
    const acknowledgement = {
      admissionId: "admission-1",
      sharedProjectId: "project-1",
      taskId: "task-1",
      leaseId: "lease-1",
      agentId: "agent-1",
      membershipEpoch: 4,
      fencingToken: 2,
      isolationInstanceId: "sandbox-1",
      reason: "membership-revoked",
      terminated: true,
      furtherEgressDenied: true,
      entireProcessTreeTerminated: true,
      ephemeralStateDeleted: true,
      killedProcessCount: 4,
      acknowledgedAt: "2026-08-01T12:00:01.000Z",
    };
    assert.equal(decodeTerminationAck(acknowledgement).entireProcessTreeTerminated, true);
    assert.throws(() =>
      decodeTerminationAck({ ...acknowledgement, entireProcessTreeTerminated: false }),
    );
  });

  it("keeps audit records metadata-only", () => {
    assert.throws(() =>
      decodeAudit(
        {
          kind: "admission-denied",
          admissionId: "admission-1",
          sharedProjectId: "project-1",
          taskId: "task-1",
          leaseId: "lease-1",
          agentId: "agent-1",
          reason: "not-authorized",
          occurredAt: "2026-08-01T12:00:00.000Z",
          rawPrompt: "do not persist me",
        },
        { onExcessProperty: "error" },
      ),
    );
  });
});
