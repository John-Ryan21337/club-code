export interface ManualFollowUpPriorityTarget {
  readonly environmentId: string;
  readonly threadId: string;
}

export interface ManualFollowUpPriorityStore {
  readonly replace: (owner: object, targets: readonly ManualFollowUpPriorityTarget[]) => void;
  readonly release: (owner: object) => void;
  readonly has: (target: ManualFollowUpPriorityTarget) => boolean;
}

function targetKey(target: ManualFollowUpPriorityTarget): string {
  return JSON.stringify([target.environmentId, target.threadId]);
}

/**
 * Renderer-document arbitration metadata for operator-created dispatches.
 *
 * The store deliberately retains only exact environment/thread identities,
 * never prompt text or attachments. Owners replace their complete target set
 * atomically so a direct send or queued item can become an in-flight turn
 * start, steer, or interrupt recovery without briefly yielding priority to
 * Auto Nudge. This singleton coordinates one JavaScript realm; it is not
 * cross-window or server-authoritative queue state.
 */
export function createManualFollowUpPriorityStore(): ManualFollowUpPriorityStore {
  const targetsByOwner = new Map<object, ReadonlySet<string>>();
  const ownerCountByTarget = new Map<string, number>();

  const release = (owner: object) => {
    const previousTargets = targetsByOwner.get(owner);
    if (previousTargets === undefined) {
      return;
    }
    targetsByOwner.delete(owner);
    for (const key of previousTargets) {
      const nextCount = (ownerCountByTarget.get(key) ?? 1) - 1;
      if (nextCount <= 0) {
        ownerCountByTarget.delete(key);
      } else {
        ownerCountByTarget.set(key, nextCount);
      }
    }
  };

  return {
    replace: (owner, targets) => {
      const nextTargets = new Set(targets.map(targetKey));
      const previousTargets = targetsByOwner.get(owner);

      for (const key of previousTargets ?? []) {
        if (nextTargets.has(key)) {
          continue;
        }
        const nextCount = (ownerCountByTarget.get(key) ?? 1) - 1;
        if (nextCount <= 0) {
          ownerCountByTarget.delete(key);
        } else {
          ownerCountByTarget.set(key, nextCount);
        }
      }
      for (const key of nextTargets) {
        if (previousTargets?.has(key) === true) {
          continue;
        }
        ownerCountByTarget.set(key, (ownerCountByTarget.get(key) ?? 0) + 1);
      }

      if (nextTargets.size === 0) {
        targetsByOwner.delete(owner);
      } else {
        targetsByOwner.set(owner, nextTargets);
      }
    },
    release,
    has: (target) => ownerCountByTarget.has(targetKey(target)),
  };
}

export const manualFollowUpPriorityStore = createManualFollowUpPriorityStore();
