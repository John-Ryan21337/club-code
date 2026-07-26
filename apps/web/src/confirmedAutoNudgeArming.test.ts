import { describe, expect, it, vi } from "vitest";

import { ConfirmedAutoNudgeArming } from "./confirmedAutoNudgeArming";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("confirmed auto nudge arming", () => {
  it("starts exactly once only after settings persistence succeeds", async () => {
    const persistence = deferred();
    const start = vi.fn();
    const arming: boolean[] = [];
    const coordinator = new ConfirmedAutoNudgeArming();

    const result = coordinator.arm({
      persistEnabled: () => persistence.promise,
      start,
      setArming: (value) => arming.push(value),
    });
    expect(start).not.toHaveBeenCalled();

    persistence.resolve();
    await expect(result).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(arming).toEqual([true, false]);
  });

  it("does not start when settings persistence fails", async () => {
    const start = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming();

    await expect(
      coordinator.arm({
        persistEnabled: () => Promise.reject(new Error("settings unavailable")),
        start,
        setArming: () => undefined,
      }),
    ).rejects.toThrow("settings unavailable");
    expect(start).not.toHaveBeenCalled();
  });

  it("does not start after disable or navigation invalidates an in-flight arm", async () => {
    const persistence = deferred();
    const start = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming();
    const result = coordinator.arm({
      persistEnabled: () => persistence.promise,
      start,
      setArming: () => undefined,
    });

    coordinator.invalidate();
    persistence.resolve();

    await expect(result).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});
