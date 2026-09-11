import "../../index.css";

import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ServerProviderAccessResult,
} from "@cafecode/contracts";
import { ProviderAccessCheck } from "./ProviderAccessCheck";
import { trackServerSettingsWrite } from "../../serverSettingsWriteState";

const instanceId = ProviderInstanceId.make("claude-check");
const instance: ProviderInstanceConfig = {
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
};
const models = [
  { slug: "model-a", name: "Model A", isCustom: false, capabilities: null },
  { slug: "model-b", name: "Model B", isCustom: false, capabilities: null },
];
const verified: ServerProviderAccessResult = {
  instanceId,
  model: "model-a",
  status: "verified",
  checkedAt: "2026-09-11T21:00:00.000Z",
};

it("checks the selected instance once and clears verification after changing model", async () => {
  const checkAccess = vi.fn(async () => verified);
  await render(<ProviderAccessCheck {...{ instanceId, instance, models, checkAccess }} />);
  expect(checkAccess).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Check access", exact: true }).click();
  await expect.element(page.getByText("Access verified", { exact: true })).toBeVisible();
  expect(checkAccess).toHaveBeenCalledExactlyOnceWith({ instanceId, model: "model-a" });
  expect(document.querySelector("time")?.dateTime).toBe(verified.checkedAt);
  await page.getByLabelText("Model to check").selectOptions("model-b");
  await expect.element(page.getByText("Access verified", { exact: true })).not.toBeInTheDocument();
  await page.getByLabelText("Model to check").selectOptions("model-a");
  await expect.element(page.getByText("Access verified", { exact: true })).not.toBeInTheDocument();
});

it("discards a pending success after the provider configuration changes", async () => {
  let finish!: (result: ServerProviderAccessResult) => void;
  const checkAccess = vi.fn(
    () =>
      new Promise<ServerProviderAccessResult>((resolve) => {
        finish = resolve;
      }),
  );
  const screen = await render(
    <ProviderAccessCheck {...{ instanceId, instance, models, checkAccess }} />,
  );
  await page.getByRole("button", { name: "Check access", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Checking access…" })).toBeDisabled();
  await screen.rerender(
    <ProviderAccessCheck
      {...{ instanceId, models, checkAccess }}
      instance={{ ...instance, config: { binaryPath: "changed" } }}
    />,
  );
  finish(verified);
  await expect
    .element(page.getByRole("button", { name: "Check access", exact: true }))
    .toBeEnabled();
  await expect.element(page.getByText("Access verified", { exact: true })).not.toBeInTheDocument();
});

it("does not display raw RPC errors or accept a result for another model", async () => {
  const checkAccess = vi
    .fn()
    .mockRejectedValueOnce(new Error("Bearer fixture-secret"))
    .mockResolvedValueOnce({ ...verified, model: "other-model" });
  await render(<ProviderAccessCheck {...{ instanceId, instance, models, checkAccess }} />);
  const button = page.getByRole("button", { name: "Check access", exact: true });
  await button.click();
  await expect
    .element(
      page.getByText("Access could not be verified. Check the connection and try again.", {
        exact: true,
      }),
    )
    .toBeVisible();
  expect(document.body.textContent).not.toContain("fixture-secret");
  await button.click();
  await expect
    .element(
      page.getByText("Access could not be verified. Check the connection and try again.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByText("Access verified", { exact: true })).not.toBeInTheDocument();
});

it("blocks checks during optimistic settings writes and discards results spanning a write", async () => {
  let finishWrite!: () => void;
  const writing = trackServerSettingsWrite(
    () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
  );
  let finishCheck!: (result: ServerProviderAccessResult) => void;
  const checkAccess = vi.fn(
    () =>
      new Promise<ServerProviderAccessResult>((resolve) => {
        finishCheck = resolve;
      }),
  );
  await render(<ProviderAccessCheck {...{ instanceId, instance, models, checkAccess }} />);
  await expect.element(page.getByRole("button", { name: "Saving settings…" })).toBeDisabled();
  expect(checkAccess).not.toHaveBeenCalled();
  finishWrite();
  await writing;
  await page.getByRole("button", { name: "Check access", exact: true }).click();
  await trackServerSettingsWrite(async () => {});
  finishCheck(verified);
  await expect
    .element(page.getByRole("button", { name: "Check access", exact: true }))
    .toBeEnabled();
  await expect.element(page.getByText("Access verified", { exact: true })).not.toBeInTheDocument();
});

it("fits a narrow settings panel without horizontal overflow", async () => {
  await page.viewport(320, 600);
  const model = "custom-" + "a".repeat(249);
  await render(
    <ProviderAccessCheck
      {...{ instanceId, instance }}
      models={[{ ...models[0]!, slug: model }]}
      checkAccess={async () => ({ ...verified, model })}
    />,
  );
  await page.getByRole("button", { name: "Check access", exact: true }).click();
  await expect.element(page.getByText("Access verified", { exact: true })).toBeVisible();
  const select = document.querySelector("select")!;
  const button = page.getByRole("button", { name: "Check access", exact: true }).element();
  expect(select.getBoundingClientRect().right).toBeLessThanOrEqual(320);
  expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(320);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
});
