import "../index.css";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import ChatMarkdown from "./ChatMarkdown";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

const tableStart = [
  "| Role | Employer | Location | Notes |",
  "| --- | --- | --- | --- |",
  "| Analyst | Example company | Remote | Initial note |",
].join("\n");

function Fixture({ text, streaming = true }: { text: string; streaming?: boolean }) {
  return (
    <main style={{ width: 400, maxWidth: "100%" }}>
      <ChatMarkdown text={text} cwd={undefined} isStreaming={streaming} />
    </main>
  );
}

it("retains the table viewport, scroll position, and open expanded view across text chunks", async () => {
  await page.viewport(1200, 800);
  const screen = await render(<Fixture text={tableStart} />);
  try {
    const viewport = document.querySelector<HTMLElement>(".chat-markdown-table-scroll")!;
    await expect
      .element(page.getByRole("button", { name: "Expand table", exact: true }))
      .toBeVisible();
    viewport.scrollLeft = 90;
    const scrollLeft = viewport.scrollLeft;
    await page.getByRole("button", { name: "Expand table", exact: true }).click();
    await screen.rerender(
      <Fixture text={`${tableStart}\n| Engineer | Another company | Hybrid | New`} />,
    );
    expect(document.querySelector(".chat-markdown-table-scroll")).toBe(viewport);
    expect(viewport.scrollLeft).toBe(scrollLeft);
    await expect
      .element(page.getByRole("dialog", { name: "Expanded table", exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
  } finally {
    await screen.unmount();
  }
});

it("keeps completed table columns and rows in place as the next cell grows", async () => {
  const screen = await render(<Fixture text={tableStart} />);
  try {
    const headers = () =>
      Array.from(document.querySelectorAll("th"), (cell) => cell.getBoundingClientRect());
    const before = headers();
    const rowHeight = document.querySelector("tbody tr")!.getBoundingClientRect().height;
    let text = `${tableStart}\n| `;
    for (const fragment of [
      "A longer",
      " role description with",
      " several words for this position",
      " | Employer | Remote | Notes |",
    ]) {
      text += fragment;
      await screen.rerender(<Fixture text={text} />);
      for (const [index, box] of headers().entries()) {
        expect(Math.abs(box.x - before[index]!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.width - before[index]!.width)).toBeLessThanOrEqual(1);
      }
      expect(document.querySelector("tbody tr")!.getBoundingClientRect().height).toBe(rowHeight);
    }
    await screen.rerender(<Fixture text={text} streaming={false} />);
    for (const [index, box] of headers().entries()) {
      expect(Math.abs(box.width - before[index]!.width)).toBeLessThanOrEqual(1);
    }
  } finally {
    await screen.unmount();
  }
});

it("renders salary ranges and emphasis as readable, normally copied prose", async () => {
  const text =
    "Compare $85,000 to $110,000 per year and *keep every word spaced*; budget $25–$40 per hour.";
  const plain =
    "Compare $85,000 to $110,000 per year and keep every word spaced; budget $25–$40 per hour.";
  const screen = await render(<Fixture text={text} streaming={false} />);
  const paste = document.createElement("textarea");
  document.body.append(paste);
  try {
    const paragraph = document.querySelector(".chat-markdown p")!;
    expect(paragraph.querySelector(".katex")).toBeNull();
    expect(paragraph.textContent).toBe(plain);
    expect(paragraph.querySelector("em")!.textContent).toBe("keep every word spaced");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe(plain);
    await userEvent.copy();
    paste.focus();
    await userEvent.paste();
    expect(paste.value).toBe(plain);
  } finally {
    paste.remove();
    await screen.unmount();
  }
});
