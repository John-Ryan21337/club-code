import {
  DrainFirstPacingController,
  type DrainFirstPacingSnapshot,
  type PacingWindowObservation,
} from "./drainFirstPacingPolicy.ts";

export interface PacingAdmissionKey {
  readonly environmentId: string;
  readonly providerInstanceId: string;
  readonly providerAccountId: string;
}

export interface PacingAdmissionClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BoundedPacingAdmissionOptions {
  readonly maxWaitingGlobal: number;
  readonly maxWaitingPerKey: number;
  readonly maxTrackedKeys: number;
  /**
   * At or above this usage percentage, a complete provider observation grants
   * only a bounded number of launches. The default is 80.
   */
  readonly cautionBandStartPercent?: number;
  /**
   * Launch authorizations granted by one fresh caution-band observation.
   * The default is one and the hard maximum is 64.
   */
  readonly maxCautionBandLaunchesPerObservation?: number;
  readonly clock?: PacingAdmissionClock;
}

export interface NewLaunchRequest<T> {
  readonly kind: "new-launch";
  readonly key: PacingAdmissionKey;
  readonly launch: () => T | PromiseLike<T>;
}

export interface NewLaunchAdmission<T> {
  readonly promise: Promise<T>;
  /** Cancels only while waiting. It is a no-op after launch begins. */
  cancel(): boolean;
}

export type PacingAdmissionObservation = Omit<
  PacingWindowObservation,
  "observationSequence" | "activeLaunchCount"
> & {
  /**
   * Monotonic evidence from the provider-observation owner, scoped to one
   * admission key and coordinator lifetime. The integration must increment it
   * only after a provider usage read completes and must preserve it when that
   * same read is replayed. Local wall-clock time is not sufficient evidence.
   */
  readonly providerObservationSequence: number | null;
};

export class PacingAdmissionCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PacingAdmissionCapacityError";
  }
}

export class PacingAdmissionCancelledError extends Error {
  constructor() {
    super("The new launch was cancelled before admission.");
    this.name = "PacingAdmissionCancelledError";
  }
}

export class PacingAdmissionDisposedError extends Error {
  constructor() {
    super("The pacing admission coordinator was disposed before launch.");
    this.name = "PacingAdmissionDisposedError";
  }
}

type WaitingStatus = "waiting" | "starting" | "cancelled" | "disposed";

interface WaitingEntry {
  readonly state: KeyState;
  readonly launch: () => unknown | PromiseLike<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  status: WaitingStatus;
}

interface KeyState {
  readonly identity: string;
  readonly controller: DrainFirstPacingController;
  readonly waiting: WaitingEntry[];
  activeCount: number;
  nextObservationSequence: number;
  latestProviderObservationSequence: number | null;
  cautionAuthorizationSequence: number | null;
  cautionAuthorizationsRemaining: number;
  cautionRestricted: boolean;
  pacingObservationEnabled: boolean;
  latestObservation: PacingAdmissionObservation | null;
}

const systemClock: PacingAdmissionClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const HARD_MAX_WAITING_GLOBAL = 4_096;
const HARD_MAX_WAITING_PER_KEY = 512;
const HARD_MAX_TRACKED_KEYS = 1_024;
const HARD_MAX_CAUTION_BAND_LAUNCHES = 64;
const DEFAULT_CAUTION_BAND_START_PERCENT = 80;
const DEFAULT_MAX_CAUTION_BAND_LAUNCHES = 1;
const PROVIDER_DRAIN_CLOSURE_PERCENT = 90;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function boundedPositiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be a positive safe integer no greater than ${maximum}.`);
  }
  return value;
}

function boundedCautionBandStart(value: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value >= PROVIDER_DRAIN_CLOSURE_PERCENT
  ) {
    throw new RangeError(
      `cautionBandStartPercent must be between 0 (inclusive) and ${PROVIDER_DRAIN_CLOSURE_PERCENT} (exclusive).`,
    );
  }
  return value;
}

function opaqueIdentityPart(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new TypeError(`${name} must contain between 1 and 512 characters.`);
  }
  return value;
}

export function pacingAdmissionKeyIdentity(key: PacingAdmissionKey): string {
  return JSON.stringify([
    opaqueIdentityPart(key.environmentId, "environmentId"),
    opaqueIdentityPart(key.providerInstanceId, "providerInstanceId"),
    opaqueIdentityPart(key.providerAccountId, "providerAccountId"),
  ]);
}

function isFreshResetObservation(observation: PacingAdmissionObservation): boolean {
  return (
    !observation.stale &&
    typeof observation.resetsAtMs === "number" &&
    Number.isFinite(observation.resetsAtMs) &&
    observation.resetsAtMs > observation.observedAtMs &&
    typeof observation.windowDurationMs === "number" &&
    Number.isFinite(observation.windowDurationMs) &&
    observation.windowDurationMs > 0 &&
    Number.isFinite(observation.observedAtMs)
  );
}

function providerObservationSequence(value: number | null): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isCompleteFreshProviderObservation(
  observation: PacingAdmissionObservation,
): observation is PacingAdmissionObservation & {
  readonly providerObservationSequence: number;
  readonly usedPercent: number;
  readonly resetsAtMs: number;
  readonly windowDurationMs: number;
} {
  return (
    isFreshResetObservation(observation) &&
    typeof observation.usedPercent === "number" &&
    observation.usedPercent >= 0 &&
    observation.usedPercent <= 100 &&
    providerObservationSequence(observation.providerObservationSequence) !== null
  );
}

function captureObservation(observation: PacingAdmissionObservation): PacingAdmissionObservation {
  return {
    providerFamily: observation.providerFamily,
    usedPercent: observation.usedPercent,
    resetsAtMs: observation.resetsAtMs,
    windowDurationMs: observation.windowDurationMs,
    observedAtMs: observation.observedAtMs,
    stale: observation.stale,
    enabled: observation.enabled,
    minimumPauseMs: observation.minimumPauseMs,
    providerObservationSequence: observation.providerObservationSequence,
  };
}

/**
 * A bounded, non-preemptive admission boundary for new provider launches.
 *
 * The coordinator owns no active provider handle. Once a launch thunk begins,
 * cancellation and disposal cannot signal or otherwise affect that work.
 */
export class BoundedPacingAdmissionCoordinator {
  private readonly maxWaitingGlobal: number;
  private readonly maxWaitingPerKey: number;
  private readonly maxTrackedKeys: number;
  private readonly cautionBandStartPercent: number;
  private readonly maxCautionBandLaunchesPerObservation: number;
  private readonly clock: PacingAdmissionClock;
  private readonly states = new Map<string, KeyState>();
  private readonly waiting: WaitingEntry[] = [];
  private wakeHandle: unknown | null = null;
  private wakeAtMs: number | null = null;
  private drainInProgress = false;
  private disposed = false;

  constructor(options: BoundedPacingAdmissionOptions) {
    this.maxWaitingGlobal = boundedPositiveInteger(
      options.maxWaitingGlobal,
      "maxWaitingGlobal",
      HARD_MAX_WAITING_GLOBAL,
    );
    this.maxWaitingPerKey = boundedPositiveInteger(
      options.maxWaitingPerKey,
      "maxWaitingPerKey",
      HARD_MAX_WAITING_PER_KEY,
    );
    this.maxTrackedKeys = boundedPositiveInteger(
      options.maxTrackedKeys,
      "maxTrackedKeys",
      HARD_MAX_TRACKED_KEYS,
    );
    this.cautionBandStartPercent = boundedCautionBandStart(
      options.cautionBandStartPercent ?? DEFAULT_CAUTION_BAND_START_PERCENT,
    );
    this.maxCautionBandLaunchesPerObservation = boundedPositiveInteger(
      options.maxCautionBandLaunchesPerObservation ?? DEFAULT_MAX_CAUTION_BAND_LAUNCHES,
      "maxCautionBandLaunchesPerObservation",
      HARD_MAX_CAUTION_BAND_LAUNCHES,
    );
    this.clock = options.clock ?? systemClock;
  }

  observe(
    key: PacingAdmissionKey,
    observation: PacingAdmissionObservation,
  ): DrainFirstPacingSnapshot {
    this.assertAvailable();
    const state = this.getOrCreateState(key);
    const capturedObservation = captureObservation(observation);
    const supportedAndEnabled =
      capturedObservation.enabled && capturedObservation.providerFamily !== "other";
    const sourceSequence = providerObservationSequence(
      capturedObservation.providerObservationSequence,
    );
    const strictlyNewer =
      sourceSequence !== null &&
      (state.latestProviderObservationSequence === null ||
        sourceSequence > state.latestProviderObservationSequence);

    if (!supportedAndEnabled) {
      if (strictlyNewer) state.latestProviderObservationSequence = sourceSequence;
      state.pacingObservationEnabled = false;
      this.allowUnrestrictedFanout(state);
      state.latestObservation = capturedObservation;
      const snapshot = this.applyPolicyObservation(state, capturedObservation);
      this.scheduleWake();
      this.drain();
      return snapshot;
    }

    const wasPacingObservationEnabled = state.pacingObservationEnabled;
    state.pacingObservationEnabled = true;
    if (!strictlyNewer) {
      // A replay is not a new provider read. In particular, enabling pacing
      // again cannot reuse the observation that preceded an explicit disable.
      if (!wasPacingObservationEnabled) this.requireFreshCautionAuthorization(state);
      return state.controller.getSnapshot();
    }
    state.latestProviderObservationSequence = sourceSequence;
    const hasCompleteObservation = isCompleteFreshProviderObservation(capturedObservation);
    const hasNewResetWindow =
      !hasCompleteObservation && state.controller.isStrictlyNewerResetWindow(capturedObservation);

    // A provider reset wait is released only by a complete, fresh provider
    // observation or a strictly advanced provider-issued reset window. A
    // timer, stale cache entry, or malformed sample is not reset evidence.
    if (
      state.controller.getSnapshot().phase === "waiting-reset" &&
      !hasCompleteObservation &&
      !hasNewResetWindow
    ) {
      return state.controller.getSnapshot();
    }

    state.latestObservation = capturedObservation;
    if (hasCompleteObservation) {
      if (capturedObservation.usedPercent >= this.cautionBandStartPercent) {
        state.cautionRestricted = true;
        state.cautionAuthorizationSequence = capturedObservation.providerObservationSequence;
        state.cautionAuthorizationsRemaining = this.maxCautionBandLaunchesPerObservation;
      } else {
        this.allowUnrestrictedFanout(state);
      }
    } else if (hasNewResetWindow) {
      // Claude may omit utilization outside threshold bands. A strictly
      // advanced provider-issued reset timestamp proves a new window, but not
      // that broad fan-out is safe, so authorize only the bounded caution
      // allowance until complete telemetry arrives.
      state.cautionRestricted = true;
      state.cautionAuthorizationSequence = sourceSequence;
      state.cautionAuthorizationsRemaining = this.maxCautionBandLaunchesPerObservation;
    } else {
      // A newer but incomplete observation supersedes any unused grant. It
      // cannot be repaired or replayed later under the same source sequence.
      this.requireFreshCautionAuthorization(state);
    }
    const snapshot = this.applyPolicyObservation(
      state,
      hasCompleteObservation || hasNewResetWindow
        ? capturedObservation
        : {
            ...capturedObservation,
            usedPercent: null,
            stale: true,
          },
    );
    if (!state.controller.canStartNewWork() && state.cautionRestricted && !hasNewResetWindow) {
      // Closing the policy gate also burns any unused authorization. Neither
      // a deadline nor active-work completion can restore it.
      this.requireFreshCautionAuthorization(state);
    }
    this.scheduleWake();
    this.drain();
    return snapshot;
  }

  getSnapshot(key: PacingAdmissionKey): DrainFirstPacingSnapshot | null {
    return this.states.get(pacingAdmissionKeyIdentity(key))?.controller.getSnapshot() ?? null;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  get activeCount(): number {
    let count = 0;
    for (const state of this.states.values()) count += state.activeCount;
    return count;
  }

  submitNewLaunch<T>(request: NewLaunchRequest<T>): NewLaunchAdmission<T> {
    if (this.disposed) {
      return this.rejectedAdmission<T>(new PacingAdmissionDisposedError());
    }

    let state: KeyState;
    try {
      state = this.getOrCreateState(request.key);
    } catch (error) {
      return this.rejectedAdmission<T>(error);
    }

    if (!this.canAdmitNewLaunch(state)) {
      if (this.waiting.length >= this.maxWaitingGlobal) {
        return this.rejectedAdmission<T>(
          new PacingAdmissionCapacityError("The global pacing wait limit was reached."),
        );
      }
      if (state.waiting.length >= this.maxWaitingPerKey) {
        return this.rejectedAdmission<T>(
          new PacingAdmissionCapacityError(
            "The pacing wait limit for this provider key was reached.",
          ),
        );
      }
    }

    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
      resolve = onResolve as (value: unknown) => void;
      reject = onReject;
    });
    const entry: WaitingEntry = {
      state,
      launch: request.launch,
      resolve,
      reject,
      status: "waiting",
    };
    this.waiting.push(entry);
    state.waiting.push(entry);
    this.drain();

    return {
      promise,
      cancel: () => this.cancelWaiting(entry),
    };
  }

  /**
   * Rejects queued launches and releases coordinator resources. Active launch
   * promises continue naturally and receive no signal from this method.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearWake();
    const error = new PacingAdmissionDisposedError();
    const queued = this.waiting.splice(0);
    for (const entry of queued) {
      if (entry.status !== "waiting") continue;
      entry.status = "disposed";
      this.removeWaiting(entry);
      entry.reject(error);
    }
    for (const state of this.states.values()) {
      if (state.activeCount === 0) this.states.delete(state.identity);
    }
  }

  private assertAvailable(): void {
    if (this.disposed) throw new PacingAdmissionDisposedError();
  }

  private getOrCreateState(key: PacingAdmissionKey): KeyState {
    const identity = pacingAdmissionKeyIdentity(key);
    const current = this.states.get(identity);
    if (current !== undefined) return current;
    if (this.states.size >= this.maxTrackedKeys) {
      throw new PacingAdmissionCapacityError("The pacing key tracking limit was reached.");
    }
    const state: KeyState = {
      identity,
      controller: new DrainFirstPacingController(),
      waiting: [],
      activeCount: 0,
      nextObservationSequence: 0,
      latestProviderObservationSequence: null,
      cautionAuthorizationSequence: null,
      cautionAuthorizationsRemaining: 0,
      cautionRestricted: false,
      pacingObservationEnabled: false,
      latestObservation: null,
    };
    this.states.set(identity, state);
    return state;
  }

  private rejectedAdmission<T>(error: unknown): NewLaunchAdmission<T> {
    return {
      promise: Promise.reject(error),
      cancel: () => false,
    };
  }

  private allowUnrestrictedFanout(state: KeyState): void {
    state.cautionRestricted = false;
    state.cautionAuthorizationSequence = null;
    state.cautionAuthorizationsRemaining = 0;
  }

  private requireFreshCautionAuthorization(state: KeyState): void {
    state.cautionRestricted = true;
    state.cautionAuthorizationSequence = null;
    state.cautionAuthorizationsRemaining = 0;
  }

  private canAdmitNewLaunch(state: KeyState): boolean {
    return (
      state.controller.canStartNewWork() &&
      (!state.cautionRestricted ||
        (state.cautionAuthorizationsRemaining > 0 &&
          state.cautionAuthorizationSequence !== null &&
          state.cautionAuthorizationSequence === state.latestProviderObservationSequence))
    );
  }

  private consumeCautionAuthorization(state: KeyState): boolean {
    if (!this.canAdmitNewLaunch(state)) return false;
    if (!state.cautionRestricted) return true;
    state.cautionAuthorizationsRemaining -= 1;
    if (state.cautionAuthorizationsRemaining === 0) {
      state.cautionAuthorizationSequence = null;
    }
    return true;
  }

  private cancelWaiting(entry: WaitingEntry): boolean {
    if (entry.status !== "waiting") return false;
    entry.status = "cancelled";
    this.removeWaiting(entry);
    entry.reject(new PacingAdmissionCancelledError());
    this.releaseUnusedState(entry.state);
    return true;
  }

  private drain(): void {
    if (this.disposed || this.drainInProgress) return;
    this.drainInProgress = true;
    try {
      while (true) {
        const entry = this.waiting.find(
          (candidate) => candidate.status === "waiting" && this.canAdmitNewLaunch(candidate.state),
        );
        if (entry === undefined) return;
        this.start(entry);
        // A launch thunk may synchronously close another gate, cancel a
        // waiter, or dispose this coordinator. Re-scan after every start.
        if (this.disposed) return;
      }
    } finally {
      this.drainInProgress = false;
    }
  }

  private start(entry: WaitingEntry): void {
    // Consume synchronously before invoking user code. A reentrant submission
    // therefore observes the depleted grant and cannot join the same fan-out.
    if (!this.consumeCautionAuthorization(entry.state)) return;
    entry.status = "starting";
    this.removeWaiting(entry);
    entry.state.activeCount += 1;

    let result: unknown | PromiseLike<unknown>;
    try {
      result = entry.launch();
    } catch (error) {
      this.finish(entry.state);
      entry.reject(error);
      return;
    }

    Promise.resolve(result).then(
      (value) => {
        this.finish(entry.state);
        entry.resolve(value);
      },
      (error: unknown) => {
        this.finish(entry.state);
        entry.reject(error);
      },
    );
  }

  private finish(state: KeyState): void {
    state.activeCount -= 1;
    if (this.disposed) {
      if (state.activeCount === 0) this.states.delete(state.identity);
      return;
    }

    const observation = state.latestObservation;
    if (observation !== null && state.controller.getSnapshot().phase === "draining") {
      this.applyPolicyObservation(state, {
        ...observation,
        observedAtMs: this.clock.now(),
        stale: true,
      });
    }
    this.scheduleWake();
    this.drain();
    this.releaseUnusedState(state);
  }

  private removeWaiting(entry: WaitingEntry): void {
    const globalIndex = this.waiting.indexOf(entry);
    if (globalIndex >= 0) this.waiting.splice(globalIndex, 1);
    const keyIndex = entry.state.waiting.indexOf(entry);
    if (keyIndex >= 0) entry.state.waiting.splice(keyIndex, 1);
  }

  private releaseUnusedState(state: KeyState): void {
    if (
      state.activeCount === 0 &&
      state.waiting.length === 0 &&
      state.latestObservation === null &&
      state.controller.getSnapshot().phase === "running"
    ) {
      this.states.delete(state.identity);
    }
  }

  private scheduleWake(): void {
    if (this.disposed) return;
    let earliest: number | null = null;
    for (const state of this.states.values()) {
      const snapshot = state.controller.getSnapshot();
      if (snapshot.phase !== "paused" || snapshot.resumeAtMs === null) continue;
      earliest = earliest === null ? snapshot.resumeAtMs : Math.min(earliest, snapshot.resumeAtMs);
    }
    if (earliest === this.wakeAtMs) return;
    this.clearWake();
    if (earliest === null) return;
    this.wakeAtMs = earliest;
    this.wakeHandle = this.clock.setTimeout(
      () => this.onWake(),
      Math.min(MAX_TIMER_DELAY_MS, Math.max(0, earliest - this.clock.now())),
    );
  }

  private clearWake(): void {
    if (this.wakeHandle !== null) this.clock.clearTimeout(this.wakeHandle);
    this.wakeHandle = null;
    this.wakeAtMs = null;
  }

  private onWake(): void {
    this.wakeHandle = null;
    this.wakeAtMs = null;
    if (this.disposed) return;
    const now = this.clock.now();
    for (const state of this.states.values()) {
      const snapshot = state.controller.getSnapshot();
      const observation = state.latestObservation;
      if (
        snapshot.phase !== "paused" ||
        snapshot.resumeAtMs === null ||
        snapshot.resumeAtMs > now ||
        observation === null
      ) {
        continue;
      }
      this.applyPolicyObservation(state, {
        ...observation,
        observedAtMs: now,
        stale: true,
      });
    }
    this.scheduleWake();
    this.drain();
  }

  private applyPolicyObservation(
    state: KeyState,
    observation: PacingAdmissionObservation,
  ): DrainFirstPacingSnapshot {
    if (!Number.isSafeInteger(state.nextObservationSequence)) {
      throw new RangeError("The pacing observation sequence was exhausted.");
    }
    const observationSequence = state.nextObservationSequence;
    state.nextObservationSequence += 1;
    return state.controller.observe({
      ...observation,
      observationSequence,
      activeLaunchCount: state.activeCount,
    });
  }
}
