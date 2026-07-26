export type PacingProviderFamily = "claude" | "codex" | "other";

export type DrainFirstPacingPhase = "running" | "draining" | "paused" | "waiting-reset";

export interface PacingWindowObservation {
  readonly providerFamily: PacingProviderFamily;
  readonly usedPercent: number | null;
  readonly resetsAtMs: number | null;
  readonly windowDurationMs: number | null;
  /** Local acquisition order; monotonic across clock changes and never provider-supplied. */
  readonly observationSequence: number;
  /** Local admission-owner count, sampled synchronously when this observation is applied. */
  readonly activeLaunchCount: number;
  /** Local wall-clock time sampled by the admission owner, never a provider timestamp. */
  readonly observedAtMs: number;
  /** Whether the quota fields, rather than the two local fields above, are stale. */
  readonly stale: boolean;
  readonly enabled: boolean;
  /** Zero keeps the provider-window schedule authoritative. */
  readonly minimumPauseMs: number;
}

export interface DrainFirstPacingSnapshot {
  readonly phase: DrainFirstPacingPhase;
  readonly generation: string | null;
  readonly checkpointPercent: number | null;
  readonly resumeAtMs: number | null;
  readonly reason: string | null;
}

const CODEX_CHECKPOINTS = [20, 40, 60, 80, 100] as const;

type ValidPacingWindowObservation = PacingWindowObservation & {
  readonly usedPercent: number;
  readonly resetsAtMs: number;
  readonly windowDurationMs: number;
};

function clampUsedPercent(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function normalizeActiveLaunchCount(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeObservationSequence(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeMinimumPauseMs(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isMinorWindowEstimateCorrection(
  previous: ValidPacingWindowObservation,
  current: ValidPacingWindowObservation,
): boolean {
  const toleranceMs = 60_000;
  // Compare with the last accepted estimate so bounded refinements may
  // accumulate without disguising a reset into the next physical window.
  return (
    previous.providerFamily === current.providerFamily &&
    current.observedAtMs < previous.resetsAtMs &&
    Math.abs(previous.resetsAtMs - current.resetsAtMs) <= toleranceMs &&
    Math.abs(previous.windowDurationMs - current.windowDurationMs) <= toleranceMs
  );
}

function normalizeWindow(input: PacingWindowObservation): ValidPacingWindowObservation | null {
  const usedPercent = clampUsedPercent(input.usedPercent);
  const resetsAtMs = input.resetsAtMs;
  const windowDurationMs = input.windowDurationMs;
  if (
    usedPercent === null ||
    !Number.isFinite(input.observedAtMs) ||
    typeof resetsAtMs !== "number" ||
    !Number.isFinite(resetsAtMs) ||
    resetsAtMs <= input.observedAtMs ||
    typeof windowDurationMs !== "number" ||
    !Number.isFinite(windowDurationMs) ||
    windowDurationMs <= 0
  ) {
    return null;
  }

  const activeLaunchCount = normalizeActiveLaunchCount(input.activeLaunchCount);
  return {
    ...input,
    usedPercent,
    resetsAtMs,
    windowDurationMs,
    // An invalid active-work count is treated conservatively. If a quota
    // boundary closes during that observation, admission remains in draining
    // until a later observation proves that active work reached zero.
    activeLaunchCount: activeLaunchCount ?? 1,
    minimumPauseMs: normalizeMinimumPauseMs(input.minimumPauseMs),
  };
}

/**
 * Pure, non-preemptive quota policy.
 *
 * This object only controls whether a new Cafe-owned provider launch may
 * begin. It has no provider lifecycle handle and cannot stop, interrupt,
 * terminate, or otherwise affect work that is already running.
 */
export class DrainFirstPacingController {
  private snapshot: DrainFirstPacingSnapshot = {
    phase: "running",
    generation: null,
    checkpointPercent: null,
    resumeAtMs: null,
    reason: null,
  };
  private crossed = new Set<number>();
  private windowIdentity: string | null = null;
  private generationRevision = 0;
  private releaseAfterDrain = false;
  private lastValidWindow: ValidPacingWindowObservation | null = null;
  private latestObservationSequence: number | null = null;
  private latestObservedAtMs: number | null = null;

  getSnapshot(): DrainFirstPacingSnapshot {
    return { ...this.snapshot };
  }

  canStartNewWork(): boolean {
    return this.snapshot.phase === "running";
  }

  observe(rawInput: PacingWindowObservation): DrainFirstPacingSnapshot {
    return { ...this.applyObservation(rawInput) };
  }

  private applyObservation(rawInput: PacingWindowObservation): DrainFirstPacingSnapshot {
    const observationSequence = normalizeObservationSequence(rawInput.observationSequence);
    const pacingDisabledOrUnsupported = !rawInput.enabled || rawInput.providerFamily === "other";
    if (observationSequence === null) {
      if (pacingDisabledOrUnsupported) {
        return this.reset("Pacing is disabled or unsupported for this provider.");
      }
      return this.handleInvalidObservationOrder();
    }
    if (
      this.latestObservationSequence !== null &&
      observationSequence <= this.latestObservationSequence
    ) {
      return this.snapshot;
    }
    this.latestObservationSequence = observationSequence;

    if (pacingDisabledOrUnsupported) {
      // Settings state is ordered by the same local acquisition sequence as
      // quota data. Preserve that sequence across disable/re-enable so a late
      // pre-disable sample cannot reopen or re-close the new policy state.
      return this.reset("Pacing is disabled or unsupported for this provider.");
    }

    const observedAtMs = Number.isFinite(rawInput.observedAtMs) ? rawInput.observedAtMs : null;
    const previousObservedAtMs = this.latestObservedAtMs;
    if (observedAtMs !== null) {
      this.latestObservedAtMs = observedAtMs;
    }
    const observedActiveLaunchCount = normalizeActiveLaunchCount(rawInput.activeLaunchCount);
    const currentMinimumPauseMs = normalizeMinimumPauseMs(rawInput.minimumPauseMs);

    if (
      observedAtMs !== null &&
      previousObservedAtMs !== null &&
      this.lastValidWindow !== null &&
      observedAtMs < previousObservedAtMs
    ) {
      // The independently monotonic observation sequence proves this is a
      // newer acquisition despite the wall clock moving backward. Shift the
      // trusted physical window and any concrete deadline by the same delta;
      // quota may be unavailable during the clock correction.
      const clockDeltaMs = observedAtMs - previousObservedAtMs;
      this.lastValidWindow = {
        ...this.lastValidWindow,
        observedAtMs,
        resetsAtMs: this.lastValidWindow.resetsAtMs + clockDeltaMs,
      };
      if (this.windowIdentity !== null) {
        this.windowIdentity = `${this.lastValidWindow.providerFamily}:${this.lastValidWindow.resetsAtMs}:${this.lastValidWindow.windowDurationMs}`;
      }
      if (this.snapshot.resumeAtMs !== null) {
        this.snapshot = {
          ...this.snapshot,
          resumeAtMs: Math.max(observedAtMs, this.snapshot.resumeAtMs + clockDeltaMs),
        };
      }
    }

    const input = normalizeWindow(rawInput);

    if (
      this.snapshot.phase === "paused" &&
      this.snapshot.resumeAtMs !== null &&
      observedAtMs !== null &&
      observedAtMs >= this.snapshot.resumeAtMs
    ) {
      if (observedActiveLaunchCount === null) {
        return this.snapshot;
      }
      if (observedActiveLaunchCount > 0) {
        this.releaseAfterDrain = true;
        this.snapshot = {
          ...this.snapshot,
          phase: "draining",
          resumeAtMs: null,
          reason: "The pacing deadline passed; waiting for active work to finish before resuming.",
        };
      } else {
        // Keep generation/checkpoint memory for this physical provider window,
        // then evaluate the same observation for any later threshold.
        this.releaseCompletedDrain();
      }
    }

    if (input === null) {
      return this.handleUnavailableObservation(
        observedAtMs,
        observedActiveLaunchCount,
        currentMinimumPauseMs,
      );
    }

    // Aging telemetry cannot reopen a gate that a concrete, previously fresh
    // quota observation already closed or replace its trusted reset schedule.
    if (input.stale) {
      return this.handleUnavailableObservation(
        observedAtMs,
        observedActiveLaunchCount,
        currentMinimumPauseMs,
      );
    }

    const previousValidWindow = this.lastValidWindow;
    const hasConcreteClosedGate = this.snapshot.phase !== "running";
    const observedWindowIdentity = `${input.providerFamily}:${input.resetsAtMs}:${input.windowDurationMs}`;
    const windowIdentity =
      !hasConcreteClosedGate &&
      this.windowIdentity !== null &&
      previousValidWindow !== null &&
      isMinorWindowEstimateCorrection(previousValidWindow, input)
        ? this.windowIdentity
        : observedWindowIdentity;
    if (
      this.windowIdentity !== null &&
      this.windowIdentity !== windowIdentity &&
      hasConcreteClosedGate &&
      previousValidWindow !== null &&
      input.observedAtMs < previousValidWindow.resetsAtMs
    ) {
      // A reset timestamp or duration correction is not proof that the old
      // quota window reset. While a concrete gate is closed, accept a new
      // generation only after the previously trusted reset deadline. This
      // prevents ordinary provider estimate corrections from releasing work.
      return this.handleUnavailableObservation(
        observedAtMs,
        observedActiveLaunchCount,
        currentMinimumPauseMs,
      );
    }

    this.lastValidWindow = input;
    if (this.windowIdentity !== windowIdentity) {
      const wasStillDraining =
        this.snapshot.phase === "draining" &&
        input.activeLaunchCount > 0 &&
        this.windowIdentity !== null;
      const previousCheckpoint = this.snapshot.checkpointPercent;
      this.windowIdentity = windowIdentity;
      this.generationRevision += 1;
      this.crossed.clear();
      this.releaseAfterDrain = wasStillDraining;
      this.snapshot = {
        phase: wasStillDraining ? "draining" : "running",
        generation: `${windowIdentity}:${this.generationRevision}`,
        checkpointPercent: wasStillDraining ? previousCheckpoint : null,
        resumeAtMs: null,
        reason: wasStillDraining
          ? "Quota reset observed; waiting for active work to finish before resuming."
          : null,
      };
    }

    if (this.snapshot.phase === "waiting-reset") {
      return this.snapshot;
    }

    if (this.snapshot.phase === "running" && this.snapshot.reason !== null) {
      this.snapshot = {
        ...this.snapshot,
        reason: null,
      };
    }

    const threshold = this.nextAheadThreshold(input);

    if (this.snapshot.phase === "paused") {
      if (threshold === null) return this.snapshot;
      this.markCrossed(threshold);
      return this.closeAtThreshold(input, threshold);
    }

    if (this.snapshot.phase === "draining") {
      if (
        threshold !== null &&
        (this.releaseAfterDrain || threshold > (this.snapshot.checkpointPercent ?? 0))
      ) {
        this.releaseAfterDrain = false;
        this.markCrossed(threshold);
        this.snapshot = {
          ...this.snapshot,
          checkpointPercent: threshold,
          reason: `Draining active work at the ${threshold}% quota checkpoint.`,
        };
      }
      if (input.activeLaunchCount > 0) return this.snapshot;
      if (this.releaseAfterDrain) {
        return this.releaseCompletedDrain();
      }
      return this.pauseAfterDrain(input, this.snapshot.checkpointPercent ?? 100);
    }

    if (threshold === null) return this.snapshot;
    this.markCrossed(threshold);
    return this.closeAtThreshold(input, threshold);
  }

  private handleUnavailableObservation(
    observedAtMs: number | null,
    observedActiveLaunchCount: number | null,
    minimumPauseMs: number,
  ): DrainFirstPacingSnapshot {
    if (this.snapshot.phase === "running") {
      // Preserve the trusted generation/checkpoint memory while admission is
      // already open. A transient telemetry gap should fail open, but clearing
      // that memory would let a delayed older sample replay a checkpoint.
      this.snapshot = {
        ...this.snapshot,
        reason: "Quota data is unavailable; pacing fails open.",
      };
      return this.snapshot;
    }

    if (this.snapshot.phase !== "draining") {
      // A concrete pause remains authoritative until its known deadline.
      // Unknown telemetry is not evidence that quota became available.
      return this.snapshot;
    }

    if (observedActiveLaunchCount === null || observedActiveLaunchCount > 0) {
      return this.snapshot;
    }

    if (this.releaseAfterDrain) {
      return this.releaseCompletedDrain();
    }

    const lastValidWindow = this.lastValidWindow;
    if (lastValidWindow === null) {
      return this.snapshot;
    }
    if (observedAtMs !== null && observedAtMs >= lastValidWindow.resetsAtMs) {
      return this.releaseCompletedDrain();
    }

    return this.pauseAfterDrain(
      {
        ...lastValidWindow,
        observedAtMs: observedAtMs ?? lastValidWindow.observedAtMs,
        activeLaunchCount: 0,
        minimumPauseMs,
      },
      this.snapshot.checkpointPercent ?? 100,
    );
  }

  private nextAheadThreshold(input: ValidPacingWindowObservation): number | null {
    if (input.providerFamily === "claude") {
      return input.usedPercent >= 90 && !this.crossed.has(90) ? 90 : null;
    }

    const startsAtMs = input.resetsAtMs - input.windowDurationMs;
    const elapsedPercent = Math.min(
      100,
      Math.max(0, ((input.observedAtMs - startsAtMs) / input.windowDurationMs) * 100),
    );
    let candidate: number | null = null;
    for (const checkpoint of CODEX_CHECKPOINTS) {
      if (input.usedPercent < checkpoint || this.crossed.has(checkpoint)) continue;
      if (checkpoint < 100 && elapsedPercent >= checkpoint) {
        this.markCrossed(checkpoint);
        continue;
      }
      candidate = checkpoint;
    }
    return candidate;
  }

  private markCrossed(threshold: number): void {
    this.crossed.add(threshold);
    if (threshold === 90) return;
    for (const checkpoint of CODEX_CHECKPOINTS) {
      if (checkpoint <= threshold) this.crossed.add(checkpoint);
    }
  }

  private closeAtThreshold(
    input: ValidPacingWindowObservation,
    threshold: number,
  ): DrainFirstPacingSnapshot {
    if (input.activeLaunchCount > 0) {
      this.snapshot = {
        phase: "draining",
        generation: this.snapshot.generation,
        checkpointPercent: threshold,
        resumeAtMs: null,
        reason: `Draining active work at the ${threshold}% quota checkpoint.`,
      };
      return this.snapshot;
    }
    return this.pauseAfterDrain(input, threshold);
  }

  private pauseAfterDrain(
    input: ValidPacingWindowObservation,
    threshold: number,
  ): DrainFirstPacingSnapshot {
    this.releaseAfterDrain = false;
    if (input.providerFamily === "claude" || threshold >= 100) {
      this.snapshot = {
        ...this.snapshot,
        phase: "waiting-reset",
        checkpointPercent: threshold,
        resumeAtMs: input.resetsAtMs,
        reason: "Active work drained; waiting for the provider-reported quota reset.",
      };
      return this.snapshot;
    }

    const startsAtMs = input.resetsAtMs - input.windowDurationMs;
    const scheduledCheckpointAtMs = startsAtMs + input.windowDurationMs * (threshold / 100);
    const resumeAtMs = Math.min(
      input.resetsAtMs,
      Math.max(scheduledCheckpointAtMs, input.observedAtMs + input.minimumPauseMs),
    );
    if (resumeAtMs <= input.observedAtMs) {
      this.snapshot = {
        ...this.snapshot,
        phase: "running",
        checkpointPercent: null,
        resumeAtMs: null,
        reason: null,
      };
      return this.snapshot;
    }
    this.snapshot = {
      ...this.snapshot,
      phase: "paused",
      checkpointPercent: threshold,
      resumeAtMs,
      reason: `Active work drained; pausing new Cafe dispatch until the ${threshold}% window mark.`,
    };
    return this.snapshot;
  }

  private handleInvalidObservationOrder(): DrainFirstPacingSnapshot {
    if (this.snapshot.phase !== "running") return this.snapshot;
    this.snapshot = {
      ...this.snapshot,
      reason: "Quota observation order is unavailable; pacing fails open.",
    };
    return this.snapshot;
  }

  private releaseCompletedDrain(): DrainFirstPacingSnapshot {
    this.releaseAfterDrain = false;
    this.snapshot = {
      ...this.snapshot,
      phase: "running",
      checkpointPercent: null,
      resumeAtMs: null,
      reason: null,
    };
    return this.snapshot;
  }

  private reset(reason: string): DrainFirstPacingSnapshot {
    this.crossed.clear();
    this.windowIdentity = null;
    this.releaseAfterDrain = false;
    this.lastValidWindow = null;
    this.latestObservedAtMs = null;
    this.snapshot = {
      phase: "running",
      generation: null,
      checkpointPercent: null,
      resumeAtMs: null,
      reason,
    };
    return this.snapshot;
  }
}
