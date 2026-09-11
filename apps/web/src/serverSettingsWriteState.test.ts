import { expect, it } from "vitest";
import {
  getServerSettingsWriteState,
  subscribeServerSettingsWrites,
  trackServerSettingsWrite,
} from "./serverSettingsWriteState";

it("tracks overlapping writes until each completes and advances the invalidation revision", async () => {
  const initial = getServerSettingsWriteState();
  const seen: number[] = [];
  const unsubscribe = subscribeServerSettingsWrites(() =>
    seen.push(getServerSettingsWriteState().pending),
  );
  let finish!: () => void;
  const first = trackServerSettingsWrite(
    () =>
      new Promise<void>((resolve) => {
        expect(getServerSettingsWriteState().pending).toBe(1);
        finish = resolve;
      }),
  );
  await expect(
    trackServerSettingsWrite(async () => {
      throw new Error("save failed");
    }),
  ).rejects.toThrow("save failed");
  expect(getServerSettingsWriteState()).toEqual({ pending: 1, revision: initial.revision + 2 });
  finish();
  await first;
  expect(getServerSettingsWriteState()).toEqual({ pending: 0, revision: initial.revision + 2 });
  unsubscribe();
  expect(seen).toEqual([1, 2, 1, 0]);
});
