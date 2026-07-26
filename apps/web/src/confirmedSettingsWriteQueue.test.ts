import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetConfirmedSettingsWriteQueueForTests,
  enqueueConfirmedSettingsWrite,
} from "./confirmedSettingsWriteQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("confirmed settings write queue", () => {
  beforeEach(() => __resetConfirmedSettingsWriteQueueForTests());

  it("commits successive operator choices in invocation order", async () => {
    const first = deferred();
    const events: string[] = [];
    const firstWrite = enqueueConfirmedSettingsWrite(async () => {
      events.push("first-start");
      await first.promise;
      events.push("first-end");
    });
    const secondWrite = enqueueConfirmedSettingsWrite(async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    first.resolve();
    await Promise.all([firstWrite, secondWrite]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("continues with the latest choice after an earlier write fails", async () => {
    const first = deferred();
    const events: string[] = [];
    const firstWrite = enqueueConfirmedSettingsWrite(() => first.promise);
    const secondWrite = enqueueConfirmedSettingsWrite(async () => {
      events.push("second");
    });

    first.reject(new Error("persistence unavailable"));
    await expect(firstWrite).rejects.toThrow("persistence unavailable");
    await expect(secondWrite).resolves.toBeUndefined();
    expect(events).toEqual(["second"]);
  });
});
