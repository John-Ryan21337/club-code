import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useState } from "react";
import { YouTubeAccountSettings } from "./YouTubeAccountSettings";
const h = vi.hoisted(() => ({
  connection: {},
  check: vi.fn(),
  start: vi.fn(),
  list: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => h.connection,
}));
vi.mock("../../youtubeAccountConnection", async (original) => ({
  ...(await original<typeof import("../../youtubeAccountConnection")>()),
  getYouTubeAccountConnectionStatus: h.check,
  startYouTubeAccountConnection: h.start,
  listYouTubeOwnedPlaylists: h.list,
  disconnectYouTubeAccount: h.disconnect,
}));
function Capture() {
  const [selected, setSelected] = useState("None");
  return (
    <main style={{ maxWidth: 1100, margin: "auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Optional YouTube owned playlists</h1>
      <p style={{ margin: "12px 0" }}>
        Real settings component. Synthetic connection and playlist data. No account, Google request,
        or media playback.
      </p>
      <YouTubeAccountSettings
        environmentScopeKey="synthetic"
        onSelect={(source) => setSelected(source.id)}
      />
      <p>Capture-only selected ID: {selected}</p>
    </main>
  );
}
it("records explicit account actions without a live OAuth or playlist request", async () => {
  document.documentElement.classList.add("dark");
  h.check.mockResolvedValue("connected");
  h.start.mockResolvedValue("pending");
  h.disconnect.mockResolvedValue(undefined);
  h.list.mockResolvedValue([
    { id: "PL_SYNTHETIC_123", title: "夜の作業用 · Evening coding", itemCount: 12 },
  ]);
  const screen = await render(<Capture />);
  const path = "../../../../../docs/pr-assets/youtube-account/";
  await page.screenshot({ path: path + "before.png" });
  await page.getByRole("button", { name: "Connect YouTube", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("Complete consent");
  await page.getByRole("button", { name: "Check connection", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("not a live access check");
  await page.screenshot({ path: path + "stored-connection.png" });
  await page.getByRole("button", { name: "Load my playlists", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Load owned playlist", exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Load owned playlist", exact: true }).click();
  await expect.element(page.getByText("Capture-only selected ID: PL_SYNTHETIC_123")).toBeVisible();
  await page.screenshot({ path: path + "selected.png" });
  await page.getByRole("button", { name: "Disconnect YouTube", exact: true }).click();
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("saved permission was not removed");
  await page.screenshot({ path: path + "disconnected.png" });
  await screen.unmount();
});
