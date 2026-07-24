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

export interface CompletionBurstCoalescer {
  notify: () => void;
  dispose: () => void;
}

export function createCompletionBurstCoalescer(
  onBurst: () => void,
  options: { readonly settleMs?: number; readonly cooldownMs?: number } = {},
): CompletionBurstCoalescer {
  const settleMs = options.settleMs ?? 700;
  const cooldownMs = options.cooldownMs ?? 4_000;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastPlayedAt = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const fire = () => {
    timeout = null;
    if (disposed) return;
    lastPlayedAt = Date.now();
    onBurst();
  };

  return {
    notify: () => {
      if (disposed || timeout !== null) return;
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
