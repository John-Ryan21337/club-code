import "../../index.css";

import { page, userEvent } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { YouTubePlaylistController } from "../../youtubeIframeCommands";
import { YouTubePlaylistControls } from "./YouTubePlaylistControls";

it("disables playlist navigation until the iframe is ready", async () => {
  await render(<YouTubePlaylistControls controller={null} status="connecting" />);

  await expect
    .element(page.getByRole("toolbar", { name: "YouTube playlist controls" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Previous YouTube playlist item" }))
    .toBeDisabled();
  await expect
    .element(page.getByRole("button", { name: "Next YouTube playlist item" }))
    .toBeDisabled();
});

it("dispatches each playlist operation exactly once", async () => {
  const nextVideo = vi.fn();
  const previousVideo = vi.fn();
  const controller: YouTubePlaylistController = {
    next: nextVideo,
    previous: previousVideo,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };
  await render(<YouTubePlaylistControls controller={controller} status="ready" />);

  await userEvent.click(page.getByRole("button", { name: "Previous YouTube playlist item" }));
  await userEvent.click(page.getByRole("button", { name: "Next YouTube playlist item" }));

  expect(previousVideo).toHaveBeenCalledTimes(1);
  expect(nextVideo).toHaveBeenCalledTimes(1);
});

it("explains an unavailable private or blocked playlist", async () => {
  await render(<YouTubePlaylistControls controller={null} status="unavailable" />);

  await expect.element(page.getByRole("status")).toHaveTextContent("Unavailable");
  await expect
    .element(page.getByRole("button", { name: "Next YouTube playlist item" }))
    .toHaveAttribute(
      "title",
      "Playlist unavailable: use a public or embeddable unlisted playlist.",
    );
});
