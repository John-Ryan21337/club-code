export interface CompletionTurnSnapshot {
  readonly turnId: string | null;
  readonly state: string | null;
}

export function isRunningToCompletedTransition(
  previous: CompletionTurnSnapshot | undefined,
  next: CompletionTurnSnapshot,
): boolean {
  return (
    previous !== undefined &&
    previous.turnId !== null &&
    previous?.turnId === next.turnId &&
    previous.state === "running" &&
    next.state === "completed"
  );
}

/**
 * Which observed threads just finished, given the previous and next snapshot of
 * every visible thread's latest turn.
 *
 * A `null` previous map means "no baseline yet" — the first sync after client
 * settings hydrate, a reconnect that refilled the store, or a remount. In that
 * case nothing has been *observed* running, so nothing may play: returning an
 * empty list here is what keeps hydration and reconnect silent. Threads that
 * disappear from `next` are simply dropped, and a thread whose turn id changed
 * is not a completion of the turn we were watching.
 */
export function collectCompletionTransitionKeys(
  previous: ReadonlyMap<string, CompletionTurnSnapshot> | null,
  next: ReadonlyMap<string, CompletionTurnSnapshot>,
): readonly string[] {
  if (previous === null) return [];
  const keys: string[] = [];
  for (const [key, nextTurn] of next) {
    if (isRunningToCompletedTransition(previous.get(key), nextTurn)) keys.push(key);
  }
  return keys;
}

export interface CompletionBurstCoalescer {
  notify: () => void;
  dispose: () => void;
  /** Exposed for tests: whether a burst is currently playing. */
  isRunning: () => boolean;
}

/**
 * `onBurst` may be async. A burst that is still playing swallows further
 * notifications and the cooldown is measured from when it *finishes*, because a
 * dual native alert can outlast the cooldown and two overlapping runs would
 * stack AudioContexts and talk over each other. Cancelling audio that is
 * already playing is the caller's job (it owns the abort signals); `dispose`
 * only guarantees that no *new* burst starts.
 */
export function createCompletionBurstCoalescer(
  onBurst: () => void | Promise<void>,
  options: { readonly settleMs?: number; readonly cooldownMs?: number } = {},
): CompletionBurstCoalescer {
  const settleMs = options.settleMs ?? 700;
  const cooldownMs = options.cooldownMs ?? 4_000;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastPlayedAt = Number.NEGATIVE_INFINITY;
  let disposed = false;
  let running = false;

  const fire = () => {
    timeout = null;
    if (disposed) return;
    lastPlayedAt = Date.now();
    running = true;
    const settle = () => {
      running = false;
      lastPlayedAt = Date.now();
    };
    // Invoke synchronously so a caller that fires on a timer sees the burst
    // start in that same tick; only the *completion* is awaited.
    let result: void | Promise<void>;
    try {
      result = onBurst();
    } catch {
      settle();
      return;
    }
    // A synchronous burst is already finished; only an actual promise keeps the
    // "still playing" gate closed.
    if (typeof (result as Promise<void> | undefined)?.then === "function") {
      void Promise.resolve(result)
        .catch(() => undefined)
        .finally(settle);
      return;
    }
    settle();
  };

  return {
    isRunning: () => running,
    notify: () => {
      if (disposed || running || timeout !== null) return;
      const delay = Math.max(settleMs, lastPlayedAt + cooldownMs - Date.now());
      timeout = setTimeout(fire, delay);
    },
    dispose: () => {
      disposed = true;
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    },
  };
}
