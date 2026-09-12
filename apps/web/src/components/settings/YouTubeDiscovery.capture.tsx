import "../../index.css";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { YouTubeDiscoverySettings } from "./YouTubeDiscoverySettings";
import { SettingsSection } from "./settingsLayout";

const connection = vi.hoisted(() => ({}));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => connection,
}));
vi.mock("../../youtubeDiscovery", async (original) => ({
  ...(await original<typeof import("../../youtubeDiscovery")>()),
  searchYouTube: async () => [
    { kind: "video", id: "dQw4w9WgXcQ", title: "Synthetic result · quiet evening piano" },
    { kind: "playlist", id: "PL_SYNTHETIC_123", title: "Synthetic playlist · 夜の作業用音楽" },
  ],
}));

function Harness() {
  const [selection, setSelection] = useState("No result selected");
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold">Cafe Code · Public YouTube search</h1>
          <p className="text-sm text-muted-foreground">
            UI harness · synthetic results · no Google request or media playback
          </p>
        </header>
        <SettingsSection title="Streaming player">
          <YouTubeDiscoverySettings
            environmentScopeKey="synthetic"
            onSelect={(source) => setSelection(`Selected ${source.kind}: ${source.id}`)}
          />
        </SettingsSection>
        <p data-selection className="rounded-xl border p-4 text-sm">
          {selection}
        </p>
      </div>
    </main>
  );
}

it("captures explicit search and selection using synthetic results", async () => {
  await page.viewport(960, 800);
  document.documentElement.classList.add("dark");
  const screen = await render(<Harness />);
  await page.screenshot({ path: "../../../../../docs/pr-assets/youtube-discovery/before.png" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await page.getByLabelText("Public YouTube search").fill("quiet evening piano");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Load playlist" })).toBeVisible();
  await page.screenshot({ path: "../../../../../docs/pr-assets/youtube-discovery/results.png" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await page.getByRole("button", { name: "Load playlist" }).click();
  await expect
    .element(page.getByText("Selected playlist: PL_SYNTHETIC_123", { exact: true }))
    .toBeVisible();
  await page.screenshot({ path: "../../../../../docs/pr-assets/youtube-discovery/selected.png" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await screen.unmount();
  document.documentElement.classList.remove("dark");
});
