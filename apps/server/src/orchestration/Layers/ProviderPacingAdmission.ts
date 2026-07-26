import type { EnvironmentId, ServerProvider } from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  BoundedPacingAdmissionCoordinator,
  type BoundedPacingAdmissionOptions,
  type PacingAdmissionClock,
  type PacingAdmissionKey,
} from "../boundedPacingAdmission.ts";
import { ProviderPacingAccountIdentity } from "../providerPacingAccountIdentity.ts";
import {
  ProviderPacingObservationTracker,
  type ProviderPacingObservationTrackerOptions,
} from "../providerPacingObservationTracker.ts";
import {
  ProviderPacingAdmission,
  type ProviderPacingAdmissionShape,
} from "../Services/ProviderPacingAdmission.ts";

export interface ProviderPacingAdmissionRuntimeOptions {
  readonly maxWaitingGlobal?: number;
  readonly maxWaitingPerKey?: number;
  readonly maxTrackedKeys?: number;
  readonly staleAfterMs?: number;
  readonly futureClockToleranceMs?: number;
  readonly clock?: PacingAdmissionClock;
  readonly identitySalt?: Uint8Array;
}

const DEFAULT_MAX_WAITING_GLOBAL = 1_024;
const DEFAULT_MAX_WAITING_PER_KEY = 128;
const DEFAULT_MAX_TRACKED_KEYS = 256;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

export function makeProviderPacingAdmission(
  options: ProviderPacingAdmissionRuntimeOptions = {},
): ProviderPacingAdmissionShape {
  const coordinatorOptions: BoundedPacingAdmissionOptions = {
    maxWaitingGlobal: options.maxWaitingGlobal ?? DEFAULT_MAX_WAITING_GLOBAL,
    maxWaitingPerKey: options.maxWaitingPerKey ?? DEFAULT_MAX_WAITING_PER_KEY,
    maxTrackedKeys: options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS,
    ...(options.clock ? { clock: options.clock } : {}),
  };
  const trackerOptions: ProviderPacingObservationTrackerOptions = {
    staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    ...(options.futureClockToleranceMs === undefined
      ? {}
      : { futureClockToleranceMs: options.futureClockToleranceMs }),
  };
  const coordinator = new BoundedPacingAdmissionCoordinator(coordinatorOptions);
  const accountIdentities = new ProviderPacingAccountIdentity(options.identitySalt);
  const tracker = new ProviderPacingObservationTracker(
    coordinator,
    accountIdentities,
    trackerOptions,
  );
  const getKey = (environmentId: EnvironmentId, provider: ServerProvider): PacingAdmissionKey => ({
    environmentId: String(environmentId),
    providerInstanceId: String(provider.instanceId),
    providerAccountId: accountIdentities.forProvider(provider),
  });

  return {
    applyProviderSnapshots: (input) => tracker.applyProviderSnapshots(input),
    invalidateStaleEvidence: (observedAtMs) => tracker.invalidateStaleEvidence(observedAtMs),
    nextStaleAtMs: (observedAtMs) => tracker.nextStaleAtMs(observedAtMs),
    submitNewLaunch: (input) =>
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: getKey(input.environmentId, input.provider),
        dispatchSource: input.dispatchSource,
        launch: input.launch,
      }),
    adoptActiveWork: (input) =>
      coordinator.adoptActiveWork(
        getKey(input.environmentId, input.provider),
        input.activeWorkIdentity,
      ),
    getSnapshot: (environmentId, provider) =>
      coordinator.getSnapshot(getKey(environmentId, provider)),
    getKey,
    getCounts: () => ({
      active: coordinator.activeCount,
      waiting: coordinator.waitingCount,
    }),
    dispose: () => coordinator.dispose(),
  };
}

export const ProviderPacingAdmissionLive = Layer.effect(
  ProviderPacingAdmission,
  Effect.acquireRelease(
    Effect.sync(() => makeProviderPacingAdmission()),
    (service) => Effect.sync(() => service.dispose()),
  ),
);
