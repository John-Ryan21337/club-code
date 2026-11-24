interface SessionSnapshot {
  readonly status: string;
  readonly activeTurnId: string | null;
  readonly updatedAt: string;
}

export function isStaleInactiveSessionSnapshot(
  incoming: SessionSnapshot,
  current: SessionSnapshot | null,
): boolean {
  return (
    current !== null &&
    incoming.updatedAt < current.updatedAt &&
    (incoming.status === "starting" ||
      (incoming.activeTurnId === null &&
        (incoming.status === "ready" ||
          incoming.status === "error" ||
          incoming.status === "interrupted" ||
          incoming.status === "stopped")))
  );
}
