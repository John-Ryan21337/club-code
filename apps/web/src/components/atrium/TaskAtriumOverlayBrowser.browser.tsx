import "../../index.css";

import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

// Electron detection is fixed at module initialization. Keep the browser
// boundary in its own module graph instead of pretending it changes at runtime.
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => true,
}));
vi.mock("./TaskAtrium", () => ({
  TaskAtriumBoard: () => <div>Atrium content</div>,
}));

import { TaskAtriumOverlay } from "./TaskAtriumOverlay";
import { useTaskAtriumStore } from "./taskAtriumStore";
import { useUiStateStore } from "../../uiStateStore";

it("preserves browser placement on Windows even with a window-controls overlay", async () => {
  const root = document.documentElement;
  const originalWco = root.classList.contains("wco");
  const platformSpy = vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  root.classList.add("wco");
  useTaskAtriumStore.getState().setOpen(true);
  const screen = await render(<TaskAtriumOverlay />);
  try {
    await vi.waitFor(() => {
      const popup = page.getByRole("dialog", { name: "Task Atrium" }).element();
      const close = page.getByRole("button", { name: "Close Task Atrium" }).element();
      const gap = Number.parseFloat(getComputedStyle(root).fontSize);
      expect(popup.className).not.toContain("wco:[--cafe-atrium-titlebar-inset");
      expect(close.getBoundingClientRect().top).toBeCloseTo(gap, 1);
      expect(window.innerWidth - close.getBoundingClientRect().right).toBeCloseTo(gap, 1);
    });
    await page.getByRole("button", { name: "Close Task Atrium" }).click();
    await vi.waitFor(() => expect(useTaskAtriumStore.getState().open).toBe(false));
  } finally {
    useTaskAtriumStore.getState().setOpen(false);
    await screen.unmount();
    root.classList.toggle("wco", originalWco);
    platformSpy.mockRestore();
  }
});

it("removes an open Atrium board when meeting privacy becomes active", async () => {
  const previous = useUiStateStore.getState();
  useUiStateStore.setState({ meetingPrivacyEnabled: false, meetingPrivacyHiddenProjectKeys: [] });
  useTaskAtriumStore.getState().setOpen(true);
  const screen = await render(<TaskAtriumOverlay />);
  try {
    await expect.element(page.getByText("Atrium content", { exact: true })).toBeVisible();
    useUiStateStore.setState({
      meetingPrivacyEnabled: true,
      meetingPrivacyHiddenProjectKeys: ["synthetic-project"],
    });
    await expect.element(page.getByText("Atrium content", { exact: true })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Task Atrium is hidden while meeting privacy is on.");
  } finally {
    await screen.unmount();
    useTaskAtriumStore.getState().setOpen(false);
    useUiStateStore.setState({
      meetingPrivacyEnabled: previous.meetingPrivacyEnabled,
      meetingPrivacyHiddenProjectKeys: previous.meetingPrivacyHiddenProjectKeys,
    });
  }
});
