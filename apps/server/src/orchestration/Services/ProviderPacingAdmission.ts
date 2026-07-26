import type { EnvironmentId, ServerProvider } from "@cafecode/contracts";
import * as Context from "effect/Context";

import type {
  PacingActiveWorkLease,
  PacingAdmissionKey,
  NewLaunchAdmission,
} from "../boundedPacingAdmission.ts";
import type { DrainFirstPacingSnapshot } from "../drainFirstPacingPolicy.ts";
import type { ProviderPacingObservationSettings } from "../providerPacingObservationTracker.ts";

export interface ProviderPacingLaunchInput<T> {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider;
  readonly dispatchSource: "user" | "auto-nudge";
  readonly launch: () => T | PromiseLike<T>;
}

export interface ProviderPacingActiveWorkInput {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider;
  readonly activeWorkIdentity: string;
}

export interface ProviderPacingAdmissionShape {
  readonly applyProviderSnapshots: (input: {
    readonly environmentId: EnvironmentId;
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly settings: ProviderPacingObservationSettings;
    readonly observedAtMs: number;
  }) => void;
  readonly invalidateStaleEvidence: (observedAtMs: number) => void;
  readonly nextStaleAtMs: (observedAtMs: number) => number | null;
  readonly submitNewLaunch: <T>(input: ProviderPacingLaunchInput<T>) => NewLaunchAdmission<T>;
  readonly adoptActiveWork: (input: ProviderPacingActiveWorkInput) => PacingActiveWorkLease;
  readonly getSnapshot: (
    environmentId: EnvironmentId,
    provider: ServerProvider,
  ) => DrainFirstPacingSnapshot | null;
  readonly getKey: (environmentId: EnvironmentId, provider: ServerProvider) => PacingAdmissionKey;
  readonly getCounts: () => {
    readonly active: number;
    readonly waiting: number;
  };
  readonly dispose: () => void;
}

export class ProviderPacingAdmission extends Context.Service<
  ProviderPacingAdmission,
  ProviderPacingAdmissionShape
>()("cafecode/orchestration/Services/ProviderPacingAdmission") {}
