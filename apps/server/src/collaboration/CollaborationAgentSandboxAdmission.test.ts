import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  CollaborationSharedTask,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import {
  CollaborationAgentIsolationAuthority,
  CollaborationAgentNetworkPolicyAuthority,
  CollaborationAgentQuotaAuthority,
  CollaborationAgentSandboxAdmissionError,
  CollaborationAgentSandboxAdmissionLive,
  CollaborationAgentSandboxAdmissionService,
  CollaborationAgentSandboxAuditSink,
  CollaborationAgentTaskScopeAuthority,
  CollaborationAgentTerminationAuthority,
  CollaborationAgentToolchainAuthority,
  CollaborationManagedReplicaAuthority,
} from "./CollaborationAgentSandboxAdmission.ts";
import { CollaborationDeviceKeyAuthority } from "./CollaborationEventAdmission.ts";
import { CollaborationTaskStore } from "./CollaborationTaskStore.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodeTask = Schema.decodeUnknownSync(CollaborationSharedTask);
const encodeTask = Schema.encodeUnknownSync(CollaborationSharedTask);
const principal = decodePrincipal({
  sessionId: "session-1",
  sharedProjectId: "project-1",
  userId: "user-1",
  deviceId: "device-1",
  membershipEpoch: 1,
  issuedAt: "2026-08-01T11:30:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
});
const membership = decodeMembership({
  sharedProjectId: "project-1",
  epoch: 1,
  members: [
    {
      userId: "user-1",
      displayName: "Operator",
      role: "operator",
      permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
      joinedAt: "2026-08-01T11:00:00.000Z",
    },
  ],
  updatedAt: "2026-08-01T11:00:00.000Z",
});
const revokedMembership = decodeMembership({
  ...Schema.encodeUnknownSync(CollaborationProjectMembershipSnapshot)(membership),
  members: [],
});
const baseTask = decodeTask({
  sharedProjectId: "project-1",
  taskId: "task-1",
  provenance: "operator-authored",
  title: "Implement the bounded slice",
  body: "Use only the task-specific managed replica scope.",
  status: "claimed",
  ownerUserId: "user-1",
  dependencies: [],
  revision: 3,
  fencingToken: 2,
  activeAgentLease: {
    leaseId: "lease-1",
    agentId: "agent-1",
    holderUserId: "user-1",
    holderDeviceId: "device-1",
    membershipEpoch: 1,
    fencingToken: 2,
    grantedAt: "2026-08-01T11:59:00.000Z",
    expiresAt: "2026-08-01T12:10:00.000Z",
  },
  createdByUserId: "user-1",
  createdAt: "2026-08-01T11:00:00.000Z",
  updatedAt: "2026-08-01T11:59:00.000Z",
});
const request = {
  admissionId: "admission-1",
  sharedProjectId: "project-1",
  taskId: "task-1",
  deviceKeyId: "key-1",
  leaseId: "lease-1",
  agentId: "agent-1",
  expectedTaskRevision: 3,
  expectedFencingToken: 2,
};
const backend =
  process.platform === "win32"
    ? ("windows-appcontainer" as const)
    : process.platform === "darwin"
      ? ("macos-seatbelt" as const)
      : ("linux-container" as const);
interface State {
  membership: typeof membership;
  task: typeof baseTask;
  replicaGeneration: number;
  keyActive: boolean;
  attestationMode: "valid" | "incomplete" | "wrong-hash" | "unsupported";
  onAttest?: () => void;
  auditEvents: Array<Record<string, unknown>>;
  terminationMismatch: boolean;
  scopeOverride?: unknown;
  networkOverride?: unknown;
  quotaOverride?: unknown;
  toolchainsOverride?: unknown;
}

const makeState = (): State => ({
  membership,
  task: baseTask,
  replicaGeneration: 1,
  keyActive: true,
  attestationMode: "valid",
  auditEvents: [],
  terminationMismatch: false,
});

const makeLayer = (state: State) =>
  Layer.mergeAll(
    CollaborationAgentSandboxAdmissionLive,
    Layer.succeed(CollaborationMembershipAuthority, {
      getCurrent: () => Effect.succeed(state.membership),
    }),
    Layer.succeed(CollaborationDeviceKeyAuthority, {
      getActiveEd25519PublicKey: (lookup) =>
        Effect.succeed(
          state.keyActive ? { ...lookup, publicKeySpkiDer: new Uint8Array(44) } : null,
        ),
    }),
    Layer.succeed(CollaborationTaskStore, {
      create: () => Effect.die("unsupported"),
      mutate: () => Effect.die("unsupported"),
      read: () => Effect.succeed(state.task),
      history: () => Effect.die("unsupported"),
    }),
    Layer.succeed(CollaborationManagedReplicaAuthority, {
      getReady: () =>
        Effect.succeed({
          sharedProjectId: "project-1",
          replicaId: "replica-1",
          generation: state.replicaGeneration,
          manifestSha256: "a".repeat(64),
          state: "ready",
          source: "managed-project-replica",
        }),
    }),
    Layer.succeed(CollaborationAgentTaskScopeAuthority, {
      getWritableScope: () =>
        Effect.succeed(
          state.scopeOverride ?? {
            sharedProjectId: "project-1",
            taskId: "task-1",
            taskRevision: 3,
            fencingToken: 2,
            writablePaths: ["src/task-1"],
          },
        ),
    }),
    Layer.succeed(CollaborationAgentToolchainAuthority, {
      getReadOnlyToolchains: () =>
        Effect.succeed(
          state.toolchainsOverride ?? [
            {
              toolchainId: "node-22",
              access: "read-only",
              source: "club-managed-toolchain",
            },
          ],
        ),
    }),
    Layer.succeed(CollaborationAgentNetworkPolicyAuthority, {
      getPolicy: () =>
        Effect.succeed(
          state.networkOverride ?? {
            sharedProjectId: "project-1",
            membershipEpoch: 1,
            defaultAction: "deny",
            loopback: "deny",
            privateNetworks: "deny",
            dns: "allowlisted-public-only",
            allowlist: [
              {
                ruleId: "registry",
                hostname: "registry.example.com",
                port: 443,
                transport: "tls-tcp",
                resolution: "backend-pinned-public-only",
              },
            ],
          },
        ),
    }),
    Layer.succeed(CollaborationAgentQuotaAuthority, {
      getPolicy: () =>
        Effect.succeed(
          state.quotaOverride ?? {
            sharedProjectId: "project-1",
            taskId: "task-1",
            membershipEpoch: 1,
            cpuMillisPerSecond: 1_000,
            memoryBytes: 512 * 1024 * 1024,
            processCount: 16,
            runtimeMillis: 60_000,
            writableBytes: 512 * 1024 * 1024,
            stdoutBytes: 1024 * 1024,
            stderrBytes: 1024 * 1024,
          },
        ),
    }),
    Layer.succeed(CollaborationAgentIsolationAuthority, {
      attest: ({ policySha256 }: { readonly policySha256: string }) =>
        Effect.sync(() => {
          state.onAttest?.();
          if (state.attestationMode === "incomplete") return { available: false };
          const selectedBackend =
            state.attestationMode === "unsupported"
              ? process.platform === "win32"
                ? "linux-container"
                : "windows-appcontainer"
              : backend;
          return {
            admissionId: "admission-1",
            policySha256: state.attestationMode === "wrong-hash" ? "b".repeat(64) : policySha256,
            backend: selectedBackend,
            backendClass: selectedBackend === "linux-container" ? "container" : "os-sandbox",
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
        }),
    }),
    Layer.succeed(CollaborationAgentSandboxAuditSink, {
      record: (event) => Effect.sync(() => void state.auditEvents.push(event)),
    }),
    Layer.succeed(CollaborationAgentTerminationAuthority, {
      terminate: (command) =>
        Effect.succeed({
          admissionId: state.terminationMismatch ? "other-admission" : command.admissionId,
          sharedProjectId: command.sharedProjectId,
          taskId: command.taskId,
          leaseId: command.leaseId,
          agentId: command.agentId,
          membershipEpoch: command.membershipEpoch,
          fencingToken: command.fencingToken,
          isolationInstanceId: command.isolationInstanceId,
          reason: command.reason,
          terminated: true,
          furtherEgressDenied: true,
          entireProcessTreeTerminated: true,
          ephemeralStateDeleted: true,
          killedProcessCount: 4,
          acknowledgedAt: "2026-08-01T12:00:01.000Z",
        }),
    }),
  );

const expectFailure = (
  value: unknown,
  reason: CollaborationAgentSandboxAdmissionError["reason"],
) => {
  assert.instanceOf(value, CollaborationAgentSandboxAdmissionError);
  assert.equal((value as CollaborationAgentSandboxAdmissionError).reason, reason);
};

describe("CollaborationAgentSandboxAdmission", () => {
  it.effect("admits only an attested metadata-only policy and does not launch a process", () => {
    const state = makeState();
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const service = yield* CollaborationAgentSandboxAdmissionService;
      const admitted = yield* service.admit({ principal, request });
      assert.equal(admitted.launch, "not-started");
      assert.equal(admitted.policy.isolation.providerDangerFullAccess, false);
      assert.equal(admitted.policy.filesystem.hostHome, "unmounted");
      assert.equal(admitted.policy.filesystem.toolchains[0]?.access, "read-only");
      assert.equal(admitted.policy.network.defaultAction, "deny");
      assert.equal(admitted.policy.environment.inheritHostEnvironment, false);
      assert.equal(state.auditEvents.length, 1);
      const persisted = JSON.stringify(state.auditEvents[0]);
      assert.notInclude(persisted, baseTask.body);
      assert.notInclude(persisted, "providerOutput");
      assert.notInclude(persisted, "environment");
    }).pipe(Effect.provide(makeLayer(state)));
  });

  it.effect("rejects stale leases, fences, epochs and expired leases", () => {
    const state = makeState();
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const service = yield* CollaborationAgentSandboxAdmissionService;
      for (const candidate of [
        { ...request, leaseId: "other-lease" },
        { ...request, expectedFencingToken: 1 },
        { ...request, expectedTaskRevision: 2 },
      ]) {
        const rejected = yield* service.admit({ principal, request: candidate }).pipe(Effect.flip);
        expectFailure(rejected, "lease-mismatch");
      }
      state.task = decodeTask({
        ...encodeTask(baseTask),
        activeAgentLease: {
          ...encodeTask(baseTask).activeAgentLease,
          expiresAt: "2026-08-01T12:00:00.000Z",
        },
      });
      const expired = yield* service.admit({ principal, request }).pipe(Effect.flip);
      expectFailure(expired, "lease-mismatch");
    }).pipe(Effect.provide(makeLayer(state)));
  });

  it.effect(
    "fails closed when membership, device, task, or replica authority races attestation",
    () => {
      const state = makeState();
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const service = yield* CollaborationAgentSandboxAdmissionService;
        state.onAttest = () => {
          state.membership = revokedMembership;
        };
        const revoked = yield* service.admit({ principal, request }).pipe(Effect.flip);
        expectFailure(revoked, "authority-changed");

        state.membership = membership;
        state.onAttest = () => {
          state.task = decodeTask({
            ...encodeTask(baseTask),
            revision: 4,
            fencingToken: 3,
            activeAgentLease: null,
            status: "open",
            ownerUserId: null,
            updatedAt: "2026-08-01T12:00:00.000Z",
          });
        };
        const fenced = yield* service.admit({ principal, request }).pipe(Effect.flip);
        expectFailure(fenced, "authority-changed");

        state.task = baseTask;
        state.onAttest = () => {
          state.keyActive = false;
        };
        const revokedDevice = yield* service.admit({ principal, request }).pipe(Effect.flip);
        expectFailure(revokedDevice, "authority-changed");

        state.keyActive = true;
        state.onAttest = () => {
          state.replicaGeneration += 1;
        };
        const swapped = yield* service.admit({ principal, request }).pipe(Effect.flip);
        expectFailure(swapped, "authority-changed");
        assert.equal(
          state.auditEvents.filter((event) => event.kind === "admission-accepted").length,
          0,
        );
      }).pipe(Effect.provide(makeLayer(state)));
    },
  );

  it.effect(
    "rejects escape policy, unsafe egress, excessive quotas and unavailable isolation",
    () => {
      const state = makeState();
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const service = yield* CollaborationAgentSandboxAdmissionService;
        state.scopeOverride = {
          sharedProjectId: "project-1",
          taskId: "task-1",
          taskRevision: 3,
          fencingToken: 2,
          writablePaths: ["../host"],
        };
        expectFailure(
          yield* service.admit({ principal, request }).pipe(Effect.flip),
          "scope-unavailable",
        );
        state.scopeOverride = undefined;
        state.toolchainsOverride = [
          {
            toolchainId: "node-22",
            access: "read-only",
            source: "club-managed-toolchain",
            hostPath: "C:/Users/Alice/.ssh",
          },
        ];
        expectFailure(
          yield* service.admit({ principal, request }).pipe(Effect.flip),
          "scope-unavailable",
        );
        state.toolchainsOverride = undefined;
        state.networkOverride = {
          sharedProjectId: "project-1",
          membershipEpoch: 1,
          defaultAction: "allow",
          loopback: "deny",
          privateNetworks: "deny",
          dns: "allowlisted-public-only",
          allowlist: [],
        };
        expectFailure(
          yield* service.admit({ principal, request }).pipe(Effect.flip),
          "network-policy-invalid",
        );
        state.networkOverride = undefined;
        state.quotaOverride = {
          sharedProjectId: "project-1",
          taskId: "task-1",
          membershipEpoch: 1,
          cpuMillisPerSecond: 1_000,
          memoryBytes: Number.MAX_SAFE_INTEGER,
          processCount: 16,
          runtimeMillis: 60_000,
          writableBytes: 1024,
          stdoutBytes: 1024,
          stderrBytes: 1024,
        };
        expectFailure(
          yield* service.admit({ principal, request }).pipe(Effect.flip),
          "quota-policy-invalid",
        );
        state.quotaOverride = undefined;
        state.attestationMode = "incomplete";
        expectFailure(
          yield* service.admit({ principal, request }).pipe(Effect.flip),
          "isolation-unavailable",
        );
        state.attestationMode = "wrong-hash";
        expectFailure(
          yield* service.admit({ principal, request }).pipe(Effect.flip),
          "attestation-invalid",
        );
        state.attestationMode = "unsupported";
        expectFailure(
          yield* service.admit({ principal, request }).pipe(Effect.flip),
          "attestation-invalid",
        );
      }).pipe(Effect.provide(makeLayer(state)));
    },
  );

  it.effect("requires whole-sandbox termination acknowledgement and emits metadata audit", () => {
    const state = makeState();
    const command = {
      admissionId: "admission-1",
      sharedProjectId: "project-1",
      taskId: "task-1",
      leaseId: "lease-1",
      agentId: "agent-1",
      membershipEpoch: 1,
      fencingToken: 2,
      isolationInstanceId: "sandbox-1",
      reason: "membership-revoked",
      killScope: "entire-sandbox-process-tree",
      denyFurtherEgress: true,
      deleteEphemeralState: true,
    };
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const service = yield* CollaborationAgentSandboxAdmissionService;
      const acknowledged = yield* service.terminate(command);
      assert.equal(acknowledged.terminated, true);
      assert.equal(acknowledged.furtherEgressDenied, true);
      assert.equal(acknowledged.entireProcessTreeTerminated, true);
      assert.equal(acknowledged.ephemeralStateDeleted, true);
      assert.equal(state.auditEvents[0]?.kind, "sandbox-terminated");
      state.terminationMismatch = true;
      const mismatch = yield* service.terminate(command).pipe(Effect.flip);
      expectFailure(mismatch, "termination-failed");
    }).pipe(Effect.provide(makeLayer(state)));
  });
});
