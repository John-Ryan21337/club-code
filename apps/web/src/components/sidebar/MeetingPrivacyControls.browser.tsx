import "../../index.css";

import { EnvironmentId, ProjectId } from "@cafecode/contracts";
import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { meetingPrivacyProjectKey } from "../../meetingPrivacy";
import type { Project } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { MeetingPrivacyControls } from "./MeetingPrivacyControls";

const projects: Project[] = [
  {
    id: ProjectId.make("project-public"),
    environmentId: EnvironmentId.make("environment-local"),
    name: "Public demo",
    cwd: "/workspace/public-demo",
    defaultModelSelection: null,
    scripts: [],
  },
  {
    id: ProjectId.make("project-secret"),
    environmentId: EnvironmentId.make("environment-local"),
    name: "Confidential acquisition",
    cwd: "/workspace/confidential-acquisition",
    defaultModelSelection: null,
    scripts: [],
  },
];

beforeEach(() => {
  const state = useUiStateStore.getState();
  state.setMeetingPrivacyEnabled(false);
  state.clearMeetingPrivacyHiddenProjects();
});

describe("MeetingPrivacyControls", () => {
  it("does not put hidden names or paths in the document until manage is explicitly opened", async () => {
    const state = useUiStateStore.getState();
    state.setProjectMeetingPrivacyHidden(meetingPrivacyProjectKey(projects[1]!), true);
    state.setMeetingPrivacyEnabled(true);

    await render(<MeetingPrivacyControls projects={projects} />);

    expect(document.body.textContent).not.toContain("Confidential acquisition");
    expect(document.body.textContent).not.toContain("/workspace/confidential-acquisition");
    await expect
      .element(page.getByRole("button", { name: "Turn off meeting privacy" }))
      .toHaveAttribute("aria-pressed", "true");

    await userEvent.click(page.getByRole("button", { name: "Manage meeting privacy" }));
    await expect.element(page.getByText("Confidential acquisition")).toBeVisible();
    await expect.element(page.getByText("/workspace/confidential-acquisition")).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Unhide", exact: true }));
    await expect.element(page.getByText("Confidential acquisition")).not.toBeInTheDocument();
  });

  it("provides a direct global toggle without enumerating the hidden list", async () => {
    await render(<MeetingPrivacyControls projects={projects} />);

    const toggle = page.getByRole("button", { name: "Turn on meeting privacy" });
    await userEvent.click(toggle);

    await expect
      .element(page.getByRole("button", { name: "Turn off meeting privacy" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(document.body.textContent).not.toContain("Public demo");
    expect(document.body.textContent).not.toContain("Confidential acquisition");
  });
});
