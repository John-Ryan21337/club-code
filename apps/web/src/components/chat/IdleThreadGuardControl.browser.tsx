import "../../index.css";
import { EnvironmentId, ThreadId } from "@cafecode/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { UiLocalizationProvider } from "../../uiLocalization";
import {
  __resetIdleThreadGuardForTests,
  readIdleThreadGuardConfig,
  IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE,
} from "../../idleThreadGuard";
import { IdleThreadGuardControl } from "./IdleThreadGuardControl";

const scope = {
  environmentId: EnvironmentId.make("control-environment"),
  threadId: ThreadId.make("control-thread"),
};
beforeEach(() => {
  __resetIdleThreadGuardForTests();
  localStorage.clear();
});

it("starts off, rejects sub-hour settings, and saves only this environment/thread", async () => {
  const screen = await render(<IdleThreadGuardControl scope={scope} disabled={false} />);
  await screen.getByRole("button", { name: "Expand Idle Thread Guard controls" }).click();
  const toggle = screen.getByRole("switch", { name: "Enable Idle Thread Guard for this thread" });
  await expect.element(toggle).not.toBeChecked();
  await screen.getByLabelText("Idle hours", { exact: true }).fill("0");
  await toggle.click();
  expect(readIdleThreadGuardConfig(scope)).toBeNull();
  await screen.getByLabelText("Idle hours", { exact: true }).fill("3");
  await screen.getByLabelText("Status request", { exact: true }).fill("Synthetic custom request");
  await toggle.click();
  await expect
    .poll(() => readIdleThreadGuardConfig(scope))
    .toMatchObject({ ...scope, enabled: true, idleHours: 3, prompt: "Synthetic custom request" });
  expect(
    readIdleThreadGuardConfig({ ...scope, environmentId: EnvironmentId.make("other-environment") }),
  ).toBeNull();
  await toggle.click();
  await expect.poll(() => readIdleThreadGuardConfig(scope)?.enabled).toBe(false);
});

it("resets unsaved drafts when the selected thread changes", async () => {
  const screen = await render(<IdleThreadGuardControl scope={scope} disabled={false} />);
  await screen.getByRole("button", { name: "Expand Idle Thread Guard controls" }).click();
  await screen
    .getByLabelText("Status request", { exact: true })
    .fill("Unsaved thread-specific request");
  await screen.rerender(
    <IdleThreadGuardControl
      scope={{ ...scope, threadId: ThreadId.make("second-thread") }}
      disabled={false}
    />,
  );
  await screen.getByRole("button", { name: "Expand Idle Thread Guard controls" }).click();
  await expect
    .element(screen.getByLabelText("Status request", { exact: true }))
    .not.toHaveValue("Unsaved thread-specific request");
});

it("updates a built-in prompt with the language and preserves custom drafts exactly", async () => {
  const screen = await render(
    <UiLocalizationProvider preference="en">
      <IdleThreadGuardControl scope={scope} disabled={false} />
    </UiLocalizationProvider>,
  );
  await screen.getByRole("button", { name: "Expand Idle Thread Guard controls" }).click();
  await screen.rerender(
    <UiLocalizationProvider preference="ja">
      <IdleThreadGuardControl scope={scope} disabled={false} />
    </UiLocalizationProvider>,
  );
  await expect
    .element(screen.getByLabelText("状況確認メッセージ", { exact: true }))
    .toHaveValue(IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE);
  await screen
    .getByLabelText("状況確認メッセージ", { exact: true })
    .fill("  Exact custom 日本語 request  ");
  await screen.rerender(
    <UiLocalizationProvider preference="en">
      <IdleThreadGuardControl scope={scope} disabled={false} />
    </UiLocalizationProvider>,
  );
  await expect
    .element(screen.getByLabelText("Status request", { exact: true }))
    .toHaveValue("  Exact custom 日本語 request  ");
});

it("reports storage failure without showing an enabled state", async () => {
  const screen = await render(<IdleThreadGuardControl scope={scope} disabled={false} />);
  await screen.getByRole("button", { name: "Expand Idle Thread Guard controls" }).click();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("synthetic storage failure");
  });
  try {
    const toggle = screen.getByRole("switch", { name: "Enable Idle Thread Guard for this thread" });
    await toggle.click();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Guard settings were not saved. Try again.");
    await expect.element(toggle).not.toBeChecked();
    expect(readIdleThreadGuardConfig(scope)).toBeNull();
  } finally {
    write.mockRestore();
  }
});
