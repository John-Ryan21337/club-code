import type { MatrixColorFrame } from "./windowAtmosphere";

export type MatrixColorFrameMotion = "animated" | "frozen";

export interface MatrixColorFrameSnapshot {
  readonly frame: MatrixColorFrame;
  readonly motion: MatrixColorFrameMotion;
}

export interface MatrixColorFrameStore {
  readonly claim: (owner: object) => void;
  readonly publish: (
    owner: object,
    frame: MatrixColorFrame,
    motion: MatrixColorFrameMotion,
  ) => void;
  readonly freeze: (owner: object) => void;
  readonly release: (owner: object) => void;
  readonly getSnapshot: () => MatrixColorFrameSnapshot | null;
  readonly subscribe: (listener: () => void) => () => void;
}

function sameFrame(left: MatrixColorFrame, right: MatrixColorFrame): boolean {
  return (
    left.color === right.color &&
    left.perStream === right.perStream &&
    left.baseHue === right.baseHue &&
    left.saturation === right.saturation &&
    left.lightness === right.lightness
  );
}

/**
 * Renderer-session bridge for decorative consumers that need the exact Matrix
 * palette already resolved by WindowAtmosphere. Consumers subscribe only while
 * visible; no audio features or settings are copied into this store.
 */
export function createMatrixColorFrameStore(): MatrixColorFrameStore {
  let activeOwner: object | null = null;
  let snapshot: MatrixColorFrameSnapshot | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const freeze = (owner: object) => {
    if (activeOwner !== owner || snapshot === null || snapshot.motion === "frozen") return;
    snapshot = { ...snapshot, motion: "frozen" };
    notify();
  };

  return {
    claim: (owner) => {
      activeOwner = owner;
    },
    publish: (owner, frame, motion) => {
      if (activeOwner !== owner) return;
      if (snapshot !== null && snapshot.motion === motion && sameFrame(snapshot.frame, frame)) {
        return;
      }
      snapshot = { frame, motion };
      notify();
    },
    freeze,
    release: (owner) => {
      if (activeOwner !== owner) return;
      freeze(owner);
      activeOwner = null;
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const matrixColorFrameStore = createMatrixColorFrameStore();
