import { describe, expect, it } from "vitest";

import {
  filterProjectsForMeetingPrivacy,
  filterThreadsForMeetingPrivacy,
  MAX_MEETING_PRIVACY_HIDDEN_PROJECTS,
  meetingPrivacyProjectKey,
  resolveMeetingPrivacyRouteDisposition,
  sanitizeMeetingPrivacyHiddenProjectKeys,
} from "./meetingPrivacy";

const projects = [
  {
    id: "project-public",
    environmentId: "environment-local",
    cwd: "C:\\work\\public",
    name: "Public",
  },
  {
    id: "project-secret",
    environmentId: "environment-local",
    cwd: "C:\\work\\secret",
    name: "Secret client",
  },
  {
    id: "project-remote",
    environmentId: "environment-remote",
    cwd: "C:\\work\\secret",
    name: "Same path, different server",
  },
] as const;

describe("meeting privacy presentation filtering", () => {
  it("hides only the selected environment-scoped project and all of its threads", () => {
    const hiddenProjectKeys = [meetingPrivacyProjectKey(projects[1])];
    const threads = [
      {
        id: "thread-public",
        environmentId: "environment-local",
        projectId: "project-public",
        title: "Public thread",
      },
      {
        id: "thread-secret",
        environmentId: "environment-local",
        projectId: "project-secret",
        title: "Secret roadmap",
      },
      {
        id: "thread-remote",
        environmentId: "environment-remote",
        projectId: "project-remote",
        title: "Remote thread",
      },
    ] as const;

    expect(
      filterProjectsForMeetingPrivacy(projects, {
        enabled: true,
        hiddenProjectKeys,
      }).map((project) => project.name),
    ).toEqual(["Public", "Same path, different server"]);
    expect(
      filterThreadsForMeetingPrivacy(threads, projects, {
        enabled: true,
        hiddenProjectKeys,
      }).map((thread) => thread.title),
    ).toEqual(["Public thread", "Remote thread"]);
  });

  it("does not apply presentation filtering while meeting privacy is off", () => {
    const hiddenProjectKeys = [meetingPrivacyProjectKey(projects[1])];

    expect(
      filterProjectsForMeetingPrivacy(projects, {
        enabled: false,
        hiddenProjectKeys,
      }),
    ).toEqual(projects);
  });

  it("uses cross-platform normalized identities without merging environments", () => {
    expect(
      meetingPrivacyProjectKey({
        environmentId: "environment-local",
        cwd: "C:/Work/Secret/",
      }),
    ).toBe(
      meetingPrivacyProjectKey({
        environmentId: "environment-local",
        cwd: "c:\\work\\secret",
      }),
    );
    expect(
      meetingPrivacyProjectKey({
        environmentId: "environment-local",
        cwd: "\\\\Server\\Share\\Private\\",
      }),
    ).toBe(
      meetingPrivacyProjectKey({
        environmentId: "environment-local",
        cwd: "\\\\server\\share\\private",
      }),
    );
    expect(
      meetingPrivacyProjectKey({
        environmentId: "environment-remote",
        cwd: "/srv/private/",
      }),
    ).not.toBe(
      meetingPrivacyProjectKey({
        environmentId: "environment-local",
        cwd: "/srv/private",
      }),
    );
  });

  it("fails closed for unresolved deep links and redirects known hidden projects", () => {
    const hiddenProjectKeys = new Set([meetingPrivacyProjectKey(projects[1])]);

    expect(
      resolveMeetingPrivacyRouteDisposition({
        enabled: true,
        hiddenProjectKeys,
        project: null,
      }),
    ).toBe("pending");
    expect(
      resolveMeetingPrivacyRouteDisposition({
        enabled: true,
        hiddenProjectKeys,
        project: projects[1],
      }),
    ).toBe("redirect");
    expect(
      resolveMeetingPrivacyRouteDisposition({
        enabled: true,
        hiddenProjectKeys,
        project: projects[0],
      }),
    ).toBe("allow");
  });

  it("bounds and sanitizes persisted identities without accepting control characters", () => {
    const oversized = "x".repeat(8_193);
    const input = [
      "environment-local:/valid",
      "environment-local:/valid",
      "",
      "environment-local:/line\nbreak",
      `environment-local:/${oversized}`,
      ...Array.from(
        { length: MAX_MEETING_PRIVACY_HIDDEN_PROJECTS + 20 },
        (_, index) => `environment-local:/project-${index}`,
      ),
    ];

    const result = sanitizeMeetingPrivacyHiddenProjectKeys(input);

    expect(result).toHaveLength(MAX_MEETING_PRIVACY_HIDDEN_PROJECTS);
    expect(result[0]).toBe("environment-local:/valid");
    expect(result).not.toContain("environment-local:/line\nbreak");
  });
});
