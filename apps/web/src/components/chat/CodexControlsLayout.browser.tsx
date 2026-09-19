import "../../index.css";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CodexAttachmentsControl } from "./CodexAttachmentsControl";
import { CodexExperimentalControl } from "./CodexExperimentalControl";

const locale = vi.hoisted(() => ({ mode: "en" }));
vi.mock("../../uiLocalization", () => ({
  useUiLocalization: () => ({
    t: (en: string, ja: string) =>
      locale.mode === "en" ? en : locale.mode === "ja" ? ja : `${en} / ${ja}`,
  }),
}));
vi.mock("../../environments/runtime", () => ({
  readEnvironmentConnection: () => undefined,
  requireEnvironmentConnection: () => {
    throw new Error("Synthetic fixture has no provider");
  },
  subscribeEnvironmentConnections: () => () => {},
}));
const props = {
  environmentId: EnvironmentId.make("synthetic-environment"),
  threadId: ThreadId.make("synthetic-thread"),
  providerInstanceId: ProviderInstanceId.make("synthetic-codex"),
};

it.each(["en", "ja", "dual"])(
  "keeps %s controls readable in narrow and wide panes",
  async (mode) => {
    locale.mode = mode;
    await page.viewport(1100, 1000);
    const screen = await render(
      <main
        data-testid="controls"
        style={{ width: 260 }}
        className="bg-background p-3 text-foreground"
      >
        <p className="mb-3 text-xs text-muted-foreground">Synthetic preview · Codex 0.155.1</p>
        <CodexAttachmentsControl {...props} />
        <CodexExperimentalControl {...props} />
      </main>,
    );
    const root = page.getByTestId("controls").element() as HTMLElement;
    for (const summary of root.querySelectorAll("summary")) (summary as HTMLElement).click();
    for (const width of [260, 832]) {
      root.style.width = `${width}px`;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
      const fields = root.querySelector("fieldset")!;
      const save = fields.querySelector("button")!;
      if (width === 260) expect(save.getBoundingClientRect().width).toBeGreaterThan(180);
      for (const button of root.querySelectorAll("button")) {
        const bounds = button.getBoundingClientRect();
        expect(bounds.right).toBeLessThanOrEqual(root.getBoundingClientRect().right);
        expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
      }
    }
    await screen.unmount();
  },
);
