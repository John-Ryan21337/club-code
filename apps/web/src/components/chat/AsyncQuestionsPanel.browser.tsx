import "../../index.css";
import { EventId, type OrchestrationThreadActivity } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AsyncQuestionsPanel } from "./AsyncQuestionsPanel";

const localization = vi.hoisted(() => ({ dual: false }));
vi.mock("../../uiLocalization", () => ({
  useUiLocalization: () => ({
    t: (english: string, japanese: string) =>
      localization.dual ? `${english} / ${japanese}` : english,
  }),
}));

const activities: OrchestrationThreadActivity[] = [
  {
    id: EventId.make("question-event"),
    createdAt: "2026-09-18T20:30:00Z",
    tone: "info",
    kind: "user-input.async-requested",
    summary: "Optional questions",
    turnId: null,
    payload: {
      itemId: "message-1",
      questions: [{ title: "Which approach?", options: ["Small", "Complete"] }],
    },
  },
];

beforeEach(() => {
  localStorage.clear();
});

it("shows one question when a completed provider item is replayed with a new event id", async () => {
  const onAddAnswer = vi.fn(() => true);
  const screen = await render(
    <AsyncQuestionsPanel
      scopeKey="test-thread"
      activities={[...activities, { ...activities[0]!, id: EventId.make("snapshot-replay") }]}
      disabled={false}
      onAddAnswer={onAddAnswer}
    />,
  );
  await expect.element(page.getByRole("textbox")).toBeVisible();
  await page.getByRole("textbox").fill("Answer once");
  await page.getByRole("button", { name: "Add answer to prompt", exact: true }).click();
  expect(onAddAnswer).toHaveBeenCalledTimes(1);
  await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
  await screen.unmount();
});

it("requires an explicit answer, stages it without sending, and keeps rejected drafts", async () => {
  const onAddAnswer = vi.fn(() => false);
  const screen = await render(
    <AsyncQuestionsPanel
      scopeKey="test-thread"
      activities={activities}
      disabled={false}
      onAddAnswer={onAddAnswer}
    />,
  );
  const add = page.getByRole("button", { name: "Add answer to prompt", exact: true });
  await expect.element(add).toBeDisabled();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  expect(onAddAnswer).not.toHaveBeenCalled();
  await add.click();
  expect(onAddAnswer).toHaveBeenCalledWith("Which approach?\nComplete");
  await expect.element(add).toBeVisible();
  onAddAnswer.mockReturnValue(true);
  await page
    .getByRole("textbox", { name: "Answer: Which approach?", exact: true })
    .fill("My own answer");
  await add.click();
  expect(onAddAnswer).toHaveBeenLastCalledWith("Which approach?\nMy own answer");
  await expect
    .element(page.getByText("Optional questions", { exact: false }))
    .not.toBeInTheDocument();
  await screen.unmount();
});

it("refuses oversized provider questions and keeps controls disabled while unavailable", async () => {
  const onAddAnswer = vi.fn(() => true);
  const screen = await render(
    <AsyncQuestionsPanel
      scopeKey="test-thread"
      activities={activities}
      disabled
      onAddAnswer={onAddAnswer}
    />,
  );
  await expect.element(page.getByRole("button", { name: "Small", exact: true })).toBeDisabled();
  await screen.rerender(
    <AsyncQuestionsPanel
      scopeKey="test-thread"
      activities={[{ ...activities[0]!, payload: { questions: [{ title: "x".repeat(4_001) }] } }]}
      disabled={false}
      onAddAnswer={onAddAnswer}
    />,
  );
  await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
  expect(onAddAnswer).not.toHaveBeenCalled();
  await screen.unmount();
});

it("keeps bilingual actions inside a narrow composer", async () => {
  localization.dual = true;
  await page.viewport(360, 800);
  const screen = await render(
    <div style={{ width: 260 }} data-testid="narrow-questions">
      <AsyncQuestionsPanel
        scopeKey="test-thread"
        activities={activities}
        disabled={false}
        onAddAnswer={() => true}
      />
    </div>,
  );
  try {
    const panel = document.querySelector('[data-testid="narrow-questions"]')!;
    const bounds = panel.getBoundingClientRect();
    for (const button of panel.querySelectorAll("button")) {
      const rect = button.getBoundingClientRect();
      expect(rect.right).toBeLessThanOrEqual(bounds.right);
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
    }
  } finally {
    await screen.unmount();
    localization.dual = false;
    await page.viewport(1200, 800);
  }
});

it("deletes only the selected question and remembers it across replay and remount", async () => {
  const onAddAnswer = vi.fn(() => true);
  const questions = [
    {
      ...activities[0]!,
      payload: {
        itemId: "message-1",
        questions: [{ title: "Which approach?" }, { title: "Which color?" }],
      },
    },
  ];
  let screen = await render(
    <AsyncQuestionsPanel
      scopeKey="test-thread"
      activities={questions}
      disabled={false}
      onAddAnswer={onAddAnswer}
    />,
  );
  await page
    .getByRole("textbox", { name: "Answer: Which approach?", exact: true })
    .fill("Unused draft");
  await page.getByRole("button", { name: "Delete question: Which approach?", exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Answer: Which approach?", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("textbox", { name: "Answer: Which color?", exact: true }))
    .toBeVisible();
  expect(onAddAnswer).not.toHaveBeenCalled();
  const stored = localStorage.getItem("cafe-code:async-questions-dismissed:test-thread")!;
  expect(stored).toContain("message-1");
  expect(stored).not.toContain("Which approach?");
  expect(stored).not.toContain("Unused draft");
  await screen.unmount();
  screen = await render(
    <AsyncQuestionsPanel
      scopeKey="test-thread"
      activities={[{ ...questions[0]!, id: EventId.make("replayed-question") }]}
      disabled
      onAddAnswer={onAddAnswer}
    />,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Answer: Which approach?", exact: true }))
    .not.toBeInTheDocument();
  // Removing an optional question remains available while the composer is disabled.
  await page.getByRole("button", { name: "Delete question: Which color?", exact: true }).click();
  await expect
    .element(page.getByText("Optional questions", { exact: false }))
    .not.toBeInTheDocument();
  expect(onAddAnswer).not.toHaveBeenCalled();
  await screen.unmount();
  screen = await render(
    <AsyncQuestionsPanel
      scopeKey="other-thread"
      activities={questions}
      disabled={false}
      onAddAnswer={onAddAnswer}
    />,
  );
  await expect
    .element(page.getByRole("textbox", { name: "Answer: Which approach?", exact: true }))
    .toBeVisible();
  await screen.unmount();
});
