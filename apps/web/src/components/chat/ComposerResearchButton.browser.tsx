import "../../index.css";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { useDeepResearch } from "../../hooks/useDeepResearch";
import { buildDeepResearchPrompt } from "../../deepResearch";
import { ComposerResearchButton } from "./ComposerResearchButton";

vi.mock("../../uiLocalization", () => ({
  useUiLocalization: () => ({ t: (english: string) => english }),
}));

afterEach(cleanup);

function Composer({
  scope = "thread-1",
  accept = true,
  onSend,
}: {
  scope?: string;
  accept?: boolean;
  onSend: (text: string) => void;
}) {
  const [enabled, setEnabled] = useDeepResearch(scope);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSend(buildDeepResearchPrompt("Research batteries", enabled)!);
        if (accept) setEnabled(false);
      }}
    >
      <ComposerResearchButton enabled={enabled} onToggle={() => setEnabled(!enabled)} />
      <button type="submit">Send</button>
    </form>
  );
}

it("uses the toggle once and sends the following message normally", async () => {
  const onSend = vi.fn();
  await render(<Composer onSend={onSend} />);
  const toggle = page.getByRole("button", { name: "Deep research", exact: true });
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  expect(onSend).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(onSend.mock.calls[0]![0]).toContain("wait for my answers");
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(onSend).toHaveBeenLastCalledWith("Research batteries");
});

it("keeps rejected submissions armed and clears the mode when changing threads", async () => {
  const onSend = vi.fn();
  const screen = await render(<Composer accept={false} onSend={onSend} />);
  const toggle = page.getByRole("button", { name: "Deep research", exact: true });
  await toggle.click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await screen.rerender(<Composer scope="thread-2" onSend={onSend} />);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await screen.rerender(<Composer scope="thread-1" onSend={onSend} />);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
});

it("can be turned off and respects disabled state", async () => {
  const onSend = vi.fn();
  const screen = await render(<Composer onSend={onSend} />);
  const toggle = page.getByRole("button", { name: "Deep research", exact: true });
  await toggle.click();
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await screen.rerender(<ComposerResearchButton enabled={false} disabled onToggle={vi.fn()} />);
  await expect.element(toggle).toBeDisabled();
});
