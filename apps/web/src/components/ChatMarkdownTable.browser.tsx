import "../index.css";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import ChatMarkdown from "./ChatMarkdown";

const language = vi.hoisted(() => ({ mode: "en" }));
vi.mock("../uiLocalization", () => ({
  useUiLocalization: () => ({
    t: (en: string, ja: string) =>
      language.mode === "en" ? en : language.mode === "ja" ? ja : `${en} / ${ja}`,
  }),
}));

const wide = [
  "| Role | Employer | Location | Salary | Qualifications | Application | Notes |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...Array.from(
    { length: 35 },
    (_, i) =>
      `| Example role ${i + 1} | Synthetic company | Remote / リモート | Example range | Analysis, design, documentation, and collaboration experience | [View opening](https://example.com/jobs/${i}) | Final column ${i + 1} |`,
  ),
].join("\n");
const narrow = "| Name | Status |\n| --- | --- |\n| A | Ready |";
function Fixture({ text = wide, width = 360 }: { text?: string; width?: number }) {
  return (
    <main data-testid="pane" style={{ width, maxWidth: "100%", display: "flex" }}>
      <div className="min-w-0 flex-1 p-3 bg-background text-foreground">
        <p>Synthetic job comparison</p>
        <ChatMarkdown text={text} cwd={undefined} />
      </div>
    </main>
  );
}
afterEach(() => {
  language.mode = "en";
});

it("scrolls only the table with buttons and the keyboard, reaching the last column", async () => {
  await page.viewport(1000, 800);
  const screen = await render(<Fixture />);
  const region = page.getByRole("region", { name: "Scrollable table", exact: true });
  await expect.element(region).toBeVisible();
  const scroll = region.element() as HTMLElement;
  const pane = page.getByTestId("pane").element();
  expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
  await expect
    .element(page.getByRole("button", { name: "Scroll table left", exact: true }))
    .toBeDisabled();
  await page.getByRole("button", { name: "Scroll table right", exact: true }).click();
  await vi.waitFor(() => expect(scroll.scrollLeft).toBeGreaterThan(0));
  scroll.focus();
  const previous = scroll.scrollLeft;
  await userEvent.keyboard("{ArrowRight}");
  await vi.waitFor(() => expect(scroll.scrollLeft).toBeGreaterThan(previous));
  scroll.scrollLeft = scroll.scrollWidth;
  await expect
    .element(page.getByRole("button", { name: "Scroll table right", exact: true }))
    .toBeDisabled();
  const last = scroll.querySelector("tr:last-child td:last-child")!;
  expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(
    scroll.getBoundingClientRect().right + 1,
  );
  expect(window.scrollX).toBe(0);
  await screen.unmount();
});

it("opens a bounded wide view, reaches the last row, and returns focus and inline scroll on Escape", async () => {
  await page.viewport(1200, 800);
  const screen = await render(<Fixture />);
  const inline = document.querySelector<HTMLElement>(".chat-markdown-table-scroll")!;
  const trigger = page.getByRole("button", { name: "Expand table", exact: true });
  await expect.element(trigger).toBeVisible();
  inline.scrollLeft = 130;
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Expanded table", exact: true });
  await expect.element(dialog).toBeVisible();
  const box = dialog.element().getBoundingClientRect();
  expect(box.width).toBeGreaterThan(900);
  expect(box.right).toBeLessThanOrEqual(window.innerWidth);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
  const expanded = dialog.element().querySelector<HTMLElement>(".chat-markdown-table-scroll")!;
  expect(expanded.scrollHeight).toBeGreaterThan(expanded.clientHeight);
  await vi.waitFor(() => expect(getComputedStyle(dialog.element()).opacity).toBe("1"));
  expanded.scrollTop = expanded.scrollHeight;
  expanded.scrollLeft = expanded.scrollWidth;
  expect(expanded.querySelector("th")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    expanded.getBoundingClientRect().top - 1,
  );
  const last = expanded.querySelector("tr:last-child td:last-child")!.getBoundingClientRect();
  expect(last.bottom).toBeLessThanOrEqual(expanded.getBoundingClientRect().bottom + 1);
  expect(last.right).toBeLessThanOrEqual(expanded.getBoundingClientRect().right + 1);
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
  expect(inline.scrollLeft).toBe(130);
  await screen.unmount();
});

it("reveals and removes controls as streamed content grows and the pane resizes", async () => {
  await page.viewport(1200, 800);
  const screen = await render(<Fixture text={narrow} width={600} />);
  await expect
    .element(page.getByRole("button", { name: "Expand table", exact: true }))
    .not.toBeInTheDocument();
  await screen.rerender(<Fixture text={wide} width={260} />);
  await expect
    .element(page.getByRole("button", { name: "Expand table", exact: true }))
    .toBeVisible();
  await screen.rerender(<Fixture text={narrow} width={900} />);
  await expect
    .element(page.getByRole("button", { name: "Expand table", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});

it("updates overflow controls after resizing the same table", async () => {
  const text =
    "| Employer | Location | Application |\n| --- | --- | --- |\n| Example employer | Example location | Example application instructions |";
  await page.viewport(1200, 800);
  const screen = await render(<Fixture text={text} width={240} />);
  await expect
    .element(page.getByRole("button", { name: "Expand table", exact: true }))
    .toBeVisible();
  await screen.rerender(<Fixture text={text} width={1000} />);
  await expect
    .element(page.getByRole("button", { name: "Expand table", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});

it("keeps two table scroll positions independent", async () => {
  await page.viewport(1000, 800);
  const screen = await render(<Fixture text={`${wide}\n\nAnother table:\n\n${wide}`} />);
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".chat-markdown-table-toolbar")).toHaveLength(2),
  );
  const frames = document.querySelectorAll<HTMLElement>(".chat-markdown-table-frame");
  frames[0]!.querySelector<HTMLButtonElement>('button[aria-label="Scroll table right"]')!.click();
  const scrolls = document.querySelectorAll<HTMLElement>(".chat-markdown-table-scroll");
  await vi.waitFor(() => expect(scrolls[0]!.scrollLeft).toBeGreaterThan(0));
  expect(scrolls[1]!.scrollLeft).toBe(0);
  await screen.unmount();
});

it.each(["en", "ja", "dual"])(
  "keeps %s controls and the expanded view inside a phone viewport",
  async (mode) => {
    language.mode = mode;
    await page.viewport(390, 780);
    const screen = await render(<Fixture width={280} />);
    const frame = document.querySelector<HTMLElement>(".chat-markdown-table-frame")!;
    await vi.waitFor(() =>
      expect(frame.querySelector(".chat-markdown-table-toolbar")).not.toBeNull(),
    );
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth + 1);
    const expand = frame.querySelector<HTMLButtonElement>('[data-slot="dialog-trigger"]')!;
    expand.click();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    const bounds = page.getByRole("dialog").element().getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(390);
    expect(bounds.bottom).toBeLessThanOrEqual(780);
    await userEvent.keyboard("{Escape}");
    await screen.unmount();
  },
);
