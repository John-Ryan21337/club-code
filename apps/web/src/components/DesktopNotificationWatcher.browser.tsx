import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useUiStateStore } from "../uiStateStore";
import { meetingPrivacyProjectKey } from "../meetingPrivacy";

const fixture = vi.hoisted(() => ({
  projects: [
    { id: "public", environmentId: "local", cwd: "/synthetic/public" },
    { id: "hidden", environmentId: "local", cwd: "/synthetic/hidden" },
  ],
  threads: [
    { id: "public-thread", projectId: "public", title: "Public title" },
    { id: "hidden-thread", projectId: "hidden", title: "Hidden title" },
    { id: "unknown-thread", projectId: "unknown", title: "Unresolved title" },
  ].map((thread) =>
    Object.assign({}, thread, {
      environmentId: "local",
      session: { status: "running", activeTurnId: "synthetic-turn" as string | null },
    }),
  ),
}));

vi.mock("../env", () => ({ isElectron: true }));
vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({ notificationsEnabled: true }),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => ({ navigate: vi.fn() }),
}));
vi.mock("../store", () => ({
  useStore: (selector: (state: typeof fixture) => unknown) => selector(fixture),
  selectProjectsAcrossEnvironments: (state: typeof fixture) => state.projects,
  selectSidebarThreadsAcrossEnvironments: (state: typeof fixture) => state.threads,
}));

import { DesktopNotificationWatcher } from "./DesktopNotificationWatcher";

const titles: string[] = [];
beforeEach(() => {
  titles.length = 0;
  fixture.threads = fixture.threads.map((thread) =>
    Object.assign({}, thread, { session: { status: "running", activeTurnId: "synthetic-turn" } }),
  );
  useUiStateStore.setState({
    meetingPrivacyEnabled: true,
    meetingPrivacyHiddenProjectKeys: [meetingPrivacyProjectKey(fixture.projects[1]!)],
  });
  vi.stubGlobal(
    "Notification",
    class {
      constructor(title: string) {
        titles.push(title);
      }
      addEventListener() {}
    },
  );
});
afterEach(() => {
  useUiStateStore.setState({ meetingPrivacyEnabled: false, meetingPrivacyHiddenProjectKeys: [] });
  vi.unstubAllGlobals();
});

it("suppresses hidden and unresolved completion titles without changing provider state", async () => {
  const screen = await render(<DesktopNotificationWatcher />);
  expect(titles).toEqual([]);
  expect(fixture.threads.every((thread) => thread.session.status === "running")).toBe(true);

  fixture.threads = fixture.threads.map((thread) =>
    Object.assign({}, thread, { session: { status: "idle", activeTurnId: null } }),
  );
  await screen.rerender(<DesktopNotificationWatcher />);
  expect(titles).toEqual(["Public title"]);

  useUiStateStore.getState().setMeetingPrivacyEnabled(false);
  await screen.rerender(<DesktopNotificationWatcher />);
  expect(titles).toEqual(["Public title"]);

  fixture.threads = fixture.threads.map((thread) =>
    Object.assign({}, thread, { session: { status: "running", activeTurnId: "next-turn" } }),
  );
  await screen.rerender(<DesktopNotificationWatcher />);
  fixture.threads = fixture.threads.map((thread) =>
    Object.assign({}, thread, { session: { status: "idle", activeTurnId: null } }),
  );
  await screen.rerender(<DesktopNotificationWatcher />);
  expect(titles).toEqual(["Public title", "Public title", "Hidden title", "Unresolved title"]);
});
