import { afterEach, beforeEach, expect, it } from "vitest";

import {
  addCompletionAlertFiles,
  getNextCompletionAlertFile,
  listCompletionAlertFiles,
  removeCompletionAlertFile,
  resetCompletionAlertFileCycleForTest,
} from "../../completionAlertFiles";

function deleteAlertDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("cafe-code-completion-alerts");
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Could not reset completion alert test storage.")),
      { once: true },
    );
  });
}

beforeEach(async () => {
  resetCompletionAlertFileCycleForTest();
  await deleteAlertDatabase();
});

afterEach(async () => {
  await deleteAlertDatabase();
});

it("stores local alert files in IndexedDB, cycles them, and removes them", async () => {
  const first = new File(["first-audio"], "first.mp3", { type: "audio/mpeg" });
  const second = new File(["second-audio"], "second.wav", { type: "audio/wav" });

  const added = await addCompletionAlertFiles([first, second], async (data) =>
    new TextDecoder().decode(data).startsWith("first") ? 1.25 : 2.5,
  );
  expect(added.map((file) => file.name)).toEqual(["first.mp3", "second.wav"]);
  expect(await listCompletionAlertFiles()).toHaveLength(2);

  expect(await (await getNextCompletionAlertFile())?.text()).toBe("first-audio");
  expect(await (await getNextCompletionAlertFile())?.text()).toBe("second-audio");
  expect(await (await getNextCompletionAlertFile())?.text()).toBe("first-audio");

  await removeCompletionAlertFile(added[0]!.id);
  expect((await listCompletionAlertFiles()).map((file) => file.name)).toEqual(["second.wav"]);
});
