import "../../index.css";

import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { parseYouTubeUrlQueueText, youtubeUrlQueueStore } from "../../youtubeUrlQueue";
import { YouTubeUrlQueueControls } from "./YouTubeUrlQueueControls";

beforeEach(() => {
  youtubeUrlQueueStore.clear();
  youtubeUrlQueueStore.load(
    parseYouTubeUrlQueueText(
      [
        "https://youtu.be/dQw4w9WgXcQ",
        "https://youtu.be/9bZkp7q19f0",
        "https://youtu.be/kJQP7kiw5Fk",
      ].join("\n"),
    ),
  );
});

afterEach(() => {
  youtubeUrlQueueStore.clear();
});

it("shows only a safe ordinal and keeps manual navigation independent of iframe readiness", async () => {
  await render(<YouTubeUrlQueueControls />);

  await expect
    .element(page.getByRole("toolbar", { name: "YouTube URL queue controls" }))
    .toBeVisible();
  await expect.element(page.getByText("URL 1 of 3")).toBeVisible();
  expect(document.body.textContent).not.toContain("dQw4w9WgXcQ");

  await userEvent.click(page.getByRole("button", { name: "Next YouTube URL" }));
  await expect.element(page.getByText("URL 2 of 3")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Previous YouTube URL" }));
  await expect.element(page.getByText("URL 1 of 3")).toBeVisible();
});

it("lets the user recover manually after automatic unavailable-loop protection pauses", async () => {
  let revision = youtubeUrlQueueStore.getSnapshot().revision;
  youtubeUrlQueueStore.advanceAutomatically(revision, "unplayable");
  revision = youtubeUrlQueueStore.getSnapshot().revision;
  youtubeUrlQueueStore.advanceAutomatically(revision, "unplayable");
  revision = youtubeUrlQueueStore.getSnapshot().revision;
  youtubeUrlQueueStore.advanceAutomatically(revision, "unplayable");

  await render(<YouTubeUrlQueueControls />);
  await expect.element(page.getByRole("status")).toHaveTextContent("Auto-advance paused");
  await userEvent.click(page.getByRole("button", { name: "Next YouTube URL" }));
  await expect.element(page.getByText("URL 1 of 3")).toBeVisible();
  await expect.element(page.getByText("Auto-advance paused")).not.toBeInTheDocument();
});
