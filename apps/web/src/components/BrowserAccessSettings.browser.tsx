import { DEFAULT_CLIENT_SETTINGS } from "@cafecode/contracts/settings";
import type { ThreadId } from "@cafecode/contracts";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";

import { __resetClientSettingsPersistenceForTests, useUpdateSettings } from "../hooks/useSettings";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  current: null as { clientSettings: typeof DEFAULT_CLIENT_SETTINGS } | null,
  write: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ server: { updateClientSettings: mocks.write } }),
}));
vi.mock("~/rpc/serverState", () => ({
  getServerConfig: () => mocks.current,
  useServerConfig: () => mocks.current,
  useServerSettings: () => ({}),
  applySettingsUpdated: vi.fn(),
  applyClientSettingsUpdated: (settings: typeof DEFAULT_CLIENT_SETTINGS) => {
    mocks.publish(settings);
    mocks.current = { clientSettings: settings };
  },
}));

function SettingsFixture() {
  const { updateClientSettingsConfirmed } = useUpdateSettings();
  const [status, setStatus] = useState("Ready");
  const write = (disabled: boolean) => {
    void updateClientSettingsConfirmed({
      agentBrowserDisabledThreadIds: disabled ? ["thread-1" as ThreadId] : [],
    }).then(
      () => setStatus("Saved"),
      () => setStatus("Write failed"),
    );
  };
  return (
    <>
      <button onClick={() => write(true)}>Disable access</button>
      <button onClick={() => write(false)}>Enable access</button>
      <p>{status}</p>
    </>
  );
}

let screen: Awaited<ReturnType<typeof render>> | undefined;
beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  mocks.current = { clientSettings: DEFAULT_CLIENT_SETTINGS };
  mocks.write.mockReset();
  mocks.publish.mockReset();
});
afterEach(() => screen?.unmount());

it("publishes a confirmed access change only after persistence succeeds", async () => {
  const pending = deferred();
  mocks.write.mockReturnValue(pending.promise);
  screen = await render(<SettingsFixture />);
  await userEvent.click(page.getByRole("button", { name: "Disable access" }));
  await expect.poll(() => mocks.write.mock.calls.length).toBe(1);
  expect(mocks.publish).not.toHaveBeenCalled();
  pending.resolve();
  await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(mocks.current?.clientSettings.agentBrowserDisabledThreadIds).toEqual(["thread-1"]);
});

it("keeps failed changes out of memory and permits the next write", async () => {
  mocks.write
    .mockRejectedValueOnce(new Error("Synthetic persistence failure"))
    .mockResolvedValue(undefined);
  screen = await render(<SettingsFixture />);
  await userEvent.click(page.getByRole("button", { name: "Disable access" }));
  await expect.element(page.getByText("Write failed", { exact: true })).toBeVisible();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.current?.clientSettings.agentBrowserDisabledThreadIds).toEqual([]);
  await userEvent.click(page.getByRole("button", { name: "Disable access" }));
  await expect.element(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(mocks.current?.clientSettings.agentBrowserDisabledThreadIds).toEqual(["thread-1"]);
});

it("serializes opposite access changes in invocation order", async () => {
  const first = deferred();
  const second = deferred();
  mocks.write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  screen = await render(<SettingsFixture />);
  await userEvent.click(page.getByRole("button", { name: "Disable access" }));
  await userEvent.click(page.getByRole("button", { name: "Enable access" }));
  expect(mocks.write).toHaveBeenCalledTimes(1);
  first.resolve();
  await expect.poll(() => mocks.write.mock.calls.length).toBe(2);
  expect(mocks.current?.clientSettings.agentBrowserDisabledThreadIds).toEqual(["thread-1"]);
  second.resolve();
  await expect.poll(() => mocks.publish.mock.calls.length).toBe(2);
  expect(mocks.current?.clientSettings.agentBrowserDisabledThreadIds).toEqual([]);
});
