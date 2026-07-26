import type { EnvironmentId, ServerProvider } from "@cafecode/contracts";

import {
  pacingAdmissionKeyIdentity,
  type PacingAdmissionKey,
  type PacingAdmissionObservation,
} from "./boundedPacingAdmission.ts";
import { ProviderPacingAccountIdentity } from "./providerPacingAccountIdentity.ts";
import { providerPacingFamily, selectProviderPacingWindow } from "./providerPacingWindow.ts";

export interface ProviderPacingObservationSink {
  observe(key: PacingAdmissionKey, observation: PacingAdmissionObservation): unknown;
  invalidateQuotaEvidence(key: PacingAdmissionKey, observedAtMs: number): unknown;
  retireKey(key: PacingAdmissionKey): boolean;
}

export interface ProviderPacingObservationSettings {
  readonly enabled: boolean;
  readonly minimumPauseMinutes: number;
}

export interface ProviderPacingObservationTrackerOptions {
  readonly staleAfterMs: number;
  readonly futureClockToleranceMs?: number;
}

interface TrackedProviderEvidence {
  key: PacingAdmissionKey;
  usageFingerprint: string | null;
  providerObservationSequence: number | null;
  sourceCheckedAtMs: number | null;
  pacingEnabled: boolean;
  staleInvalidated: boolean;
}

const MINUTE_MS = 60_000;
const MAX_STALE_AFTER_MS = 24 * 60 * MINUTE_MS;
const MAX_FUTURE_CLOCK_TOLERANCE_MS = 5 * MINUTE_MS;
const MAXIMUM_PAUSE_MINUTES = 240;

function boundedDuration(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a safe integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function trackingIdentity(environmentId: EnvironmentId, providerInstanceId: string): string {
  return JSON.stringify([String(environmentId), providerInstanceId]);
}

/**
 * Converts full provider-registry snapshots into monotonic pacing evidence.
 *
 * The tracker is synchronous and side-effect bounded to its sink. The runtime
 * reactor owns stream subscription and timers; this class owns replay
 * suppression, stale-data invalidation, and exact account-key retirement.
 */
export class ProviderPacingObservationTracker {
  readonly #sink: ProviderPacingObservationSink;
  readonly #accountIdentities: ProviderPacingAccountIdentity;
  readonly #staleAfterMs: number;
  readonly #futureClockToleranceMs: number;
  readonly #tracked = new Map<string, TrackedProviderEvidence>();

  constructor(
    sink: ProviderPacingObservationSink,
    accountIdentities: ProviderPacingAccountIdentity,
    options: ProviderPacingObservationTrackerOptions,
  ) {
    this.#sink = sink;
    this.#accountIdentities = accountIdentities;
    this.#staleAfterMs = boundedDuration(
      options.staleAfterMs,
      "staleAfterMs",
      1,
      MAX_STALE_AFTER_MS,
    );
    this.#futureClockToleranceMs = boundedDuration(
      options.futureClockToleranceMs ?? MINUTE_MS,
      "futureClockToleranceMs",
      0,
      MAX_FUTURE_CLOCK_TOLERANCE_MS,
    );
  }

  applyProviderSnapshots(input: {
    readonly environmentId: EnvironmentId;
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly settings: ProviderPacingObservationSettings;
    readonly observedAtMs: number;
  }): void {
    if (!Number.isFinite(input.observedAtMs)) {
      throw new RangeError("observedAtMs must be a finite local wall-clock timestamp.");
    }
    const minimumPauseMinutes = boundedDuration(
      input.settings.minimumPauseMinutes,
      "minimumPauseMinutes",
      0,
      MAXIMUM_PAUSE_MINUTES,
    );
    const seen = new Set<string>();

    for (const provider of input.providers) {
      const providerFamily = providerPacingFamily(provider.driver);
      if (providerFamily === "other") continue;
      const identity = trackingIdentity(input.environmentId, String(provider.instanceId));
      if (seen.has(identity)) continue;
      seen.add(identity);

      const key: PacingAdmissionKey = {
        environmentId: String(input.environmentId),
        providerInstanceId: String(provider.instanceId),
        providerAccountId: this.#accountIdentities.forProvider(provider),
      };
      let tracked = this.#tracked.get(identity);
      if (
        tracked !== undefined &&
        pacingAdmissionKeyIdentity(tracked.key) !== pacingAdmissionKeyIdentity(key)
      ) {
        this.#sink.retireKey(tracked.key);
        tracked = undefined;
      }
      if (tracked === undefined) {
        tracked = {
          key,
          usageFingerprint: null,
          providerObservationSequence: null,
          sourceCheckedAtMs: null,
          pacingEnabled: input.settings.enabled,
          staleInvalidated: false,
        };
        this.#tracked.set(identity, tracked);
      }

      const selection = selectProviderPacingWindow(provider);
      if (
        selection.usageFingerprint !== null &&
        selection.usageFingerprint !== tracked.usageFingerprint
      ) {
        const nextSequence =
          tracked.providerObservationSequence === null
            ? 0
            : tracked.providerObservationSequence + 1;
        if (!Number.isSafeInteger(nextSequence)) {
          throw new RangeError("The provider pacing observation sequence was exhausted.");
        }
        tracked.usageFingerprint = selection.usageFingerprint;
        tracked.providerObservationSequence = nextSequence;
        tracked.staleInvalidated = false;
      }
      tracked.sourceCheckedAtMs = selection.sourceCheckedAtMs;

      const providerUsable =
        provider.enabled &&
        provider.installed &&
        provider.availability !== "unavailable" &&
        provider.auth.status === "authenticated";
      const stale =
        !providerUsable ||
        selection.usageFingerprint === null ||
        !this.#sourceIsFresh(selection.sourceCheckedAtMs, input.observedAtMs);
      tracked.pacingEnabled = input.settings.enabled;
      tracked.staleInvalidated = stale ? tracked.staleInvalidated : false;
      this.#sink.observe(tracked.key, {
        providerFamily,
        usedPercent: selection.usedPercent,
        resetsAtMs: selection.resetsAtMs,
        windowDurationMs: selection.windowDurationMs,
        observedAtMs: input.observedAtMs,
        stale,
        enabled: input.settings.enabled,
        minimumPauseMs: minimumPauseMinutes * MINUTE_MS,
        providerObservationSequence: tracked.providerObservationSequence,
      });
      if (input.settings.enabled && stale && !tracked.staleInvalidated) {
        this.#sink.invalidateQuotaEvidence(tracked.key, input.observedAtMs);
        tracked.staleInvalidated = true;
      }
    }

    for (const [identity, tracked] of this.#tracked) {
      if (seen.has(identity)) continue;
      this.#sink.retireKey(tracked.key);
      this.#tracked.delete(identity);
    }
  }

  invalidateStaleEvidence(observedAtMs: number): void {
    if (!Number.isFinite(observedAtMs)) {
      throw new RangeError("observedAtMs must be a finite local wall-clock timestamp.");
    }
    for (const tracked of this.#tracked.values()) {
      if (
        tracked.pacingEnabled &&
        !tracked.staleInvalidated &&
        !this.#sourceIsFresh(tracked.sourceCheckedAtMs, observedAtMs)
      ) {
        this.#sink.invalidateQuotaEvidence(tracked.key, observedAtMs);
        tracked.staleInvalidated = true;
      }
    }
  }

  nextStaleAtMs(observedAtMs: number): number | null {
    if (!Number.isFinite(observedAtMs)) {
      throw new RangeError("observedAtMs must be a finite local wall-clock timestamp.");
    }
    let earliest: number | null = null;
    for (const tracked of this.#tracked.values()) {
      if (!tracked.pacingEnabled || tracked.staleInvalidated) continue;
      const sourceCheckedAtMs = tracked.sourceCheckedAtMs;
      if (
        sourceCheckedAtMs === null ||
        sourceCheckedAtMs > observedAtMs + this.#futureClockToleranceMs
      ) {
        continue;
      }
      const staleAtMs = Math.max(observedAtMs, sourceCheckedAtMs + this.#staleAfterMs);
      earliest = earliest === null ? staleAtMs : Math.min(earliest, staleAtMs);
    }
    return earliest;
  }

  #sourceIsFresh(sourceCheckedAtMs: number | null, observedAtMs: number): boolean {
    return (
      sourceCheckedAtMs !== null &&
      sourceCheckedAtMs <= observedAtMs + this.#futureClockToleranceMs &&
      observedAtMs - sourceCheckedAtMs < this.#staleAfterMs
    );
  }
}
