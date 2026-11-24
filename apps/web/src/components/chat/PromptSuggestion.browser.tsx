import "../../index.css";
import { EnvironmentId, ThreadId, TurnId } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PromptSuggestion } from "./PromptSuggestion";

const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../environments/runtime", () => ({
  requireEnvironmentConnection: () => ({ client: { server: { suggestNextPrompt: mock.request } } }),
}));
const props = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("one"),
  turnId: TurnId.make("turn"),
  eligible: true,
};
beforeEach(() => {
  mock.request.mockReset();
  mock.request.mockResolvedValue({ suggestion: "Run the regression test." });
});

it("requires an explicit click, then fills the draft without a submit action", async () => {
  const accept = vi.fn(() => true);
  const screen = await render(<PromptSuggestion {...props} onAccept={accept} />);
  await expect.element(page.getByRole("button", { name: "Use suggestion" })).toBeVisible();
  if (import.meta.env.VITE_CAPTURE_PROMPT_SUGGESTION === "1") {
    await page.viewport(1100, 800);
    await page.screenshot({
      path: "../../../../../.pr-staging/prompt-suggestion-desktop.png",
      save: true,
    });
    await page.viewport(390, 844);
    expect(
      page.getByRole("group", { name: "Suggested next prompt" }).element().getBoundingClientRect()
        .width,
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: "../../../../../.pr-staging/prompt-suggestion-mobile.png",
      save: true,
    });
  }
  expect(accept).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Use suggestion" }).click();
  expect(accept).toHaveBeenCalledWith("Run the regression test.");
  await expect
    .element(page.getByRole("button", { name: "Use suggestion" }))
    .not.toBeInTheDocument();
  await screen.unmount();
});

it("does not request while typing and keeps dismissal across eligibility changes", async () => {
  const accept = vi.fn(() => true);
  const screen = await render(<PromptSuggestion {...props} eligible={false} onAccept={accept} />);
  expect(mock.request).not.toHaveBeenCalled();
  await screen.rerender(<PromptSuggestion {...props} onAccept={accept} />);
  await expect.element(page.getByRole("button", { name: "Dismiss suggestion" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss suggestion" }).click();
  await screen.rerender(<PromptSuggestion {...props} eligible={false} onAccept={accept} />);
  await screen.rerender(<PromptSuggestion {...props} onAccept={accept} />);
  await expect
    .element(page.getByRole("button", { name: "Use suggestion" }))
    .not.toBeInTheDocument();
  expect(accept).not.toHaveBeenCalled();
  expect(mock.request).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

it("ignores a late response after the composer becomes busy", async () => {
  let finish!: (value: { suggestion: string }) => void;
  mock.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = await render(<PromptSuggestion {...props} onAccept={() => true} />);
  await expect.poll(() => mock.request.mock.calls.length, { timeout: 5000 }).toBe(1);
  await screen.rerender(<PromptSuggestion {...props} eligible={false} onAccept={() => true} />);
  finish({ suggestion: "Outdated suggestion" });
  await expect.element(page.getByText("Outdated suggestion")).not.toBeInTheDocument();
  await screen.unmount();
});
