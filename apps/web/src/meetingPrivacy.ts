import { derivePhysicalProjectKeyFromPath } from "./logicalProject";

export const MAX_MEETING_PRIVACY_HIDDEN_PROJECTS = 256;
export const MAX_MEETING_PRIVACY_PROJECT_KEY_LENGTH = 8_192;

export interface MeetingPrivacyProjectIdentity {
  readonly id: string;
  readonly environmentId: string;
  readonly cwd: string;
}

export interface MeetingPrivacyThreadIdentity {
  readonly environmentId: string;
  readonly projectId: string;
}

export function sanitizeMeetingPrivacyHiddenProjectKeys(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const keys: string[] = [];
  for (const candidate of input) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > MAX_MEETING_PRIVACY_PROJECT_KEY_LENGTH ||
      candidate.includes("\0") ||
      /[\r\n]/.test(candidate) ||
      seen.has(candidate)
    ) {
      continue;
    }
    seen.add(candidate);
    keys.push(candidate);
    if (keys.length >= MAX_MEETING_PRIVACY_HIDDEN_PROJECTS) {
      break;
    }
  }
  return keys;
}

export function meetingPrivacyProjectKey(
  project: Pick<MeetingPrivacyProjectIdentity, "environmentId" | "cwd">,
): string {
  return derivePhysicalProjectKeyFromPath(project.environmentId, project.cwd);
}

export function isProjectHiddenForMeeting(input: {
  readonly enabled: boolean;
  readonly hiddenProjectKeys: ReadonlySet<string>;
  readonly project: Pick<MeetingPrivacyProjectIdentity, "environmentId" | "cwd">;
}): boolean {
  return input.enabled && input.hiddenProjectKeys.has(meetingPrivacyProjectKey(input.project));
}

export type MeetingPrivacyRouteDisposition = "allow" | "pending" | "redirect";

/**
 * Route-level fail-closed guard. When privacy is active and at least one
 * folder is hidden, a deep link must not render project UI until its project
 * identity is resolved. A known hidden identity is redirected to neutral UI.
 */
export function resolveMeetingPrivacyRouteDisposition(input: {
  readonly enabled: boolean;
  readonly hiddenProjectKeys: ReadonlySet<string>;
  readonly project: Pick<MeetingPrivacyProjectIdentity, "environmentId" | "cwd"> | null;
}): MeetingPrivacyRouteDisposition {
  if (!input.enabled || input.hiddenProjectKeys.size === 0) {
    return "allow";
  }
  if (input.project === null) {
    return "pending";
  }
  return isProjectHiddenForMeeting({
    enabled: true,
    hiddenProjectKeys: input.hiddenProjectKeys,
    project: input.project,
  })
    ? "redirect"
    : "allow";
}

export function filterProjectsForMeetingPrivacy<TProject extends MeetingPrivacyProjectIdentity>(
  projects: readonly TProject[],
  input: {
    readonly enabled: boolean;
    readonly hiddenProjectKeys: readonly string[];
  },
): TProject[] {
  if (!input.enabled || input.hiddenProjectKeys.length === 0) {
    return [...projects];
  }

  const hiddenProjectKeys = new Set(input.hiddenProjectKeys);
  return projects.filter(
    (project) =>
      !isProjectHiddenForMeeting({
        enabled: true,
        hiddenProjectKeys,
        project,
      }),
  );
}

export function filterThreadsForMeetingPrivacy<
  TThread extends MeetingPrivacyThreadIdentity,
  TProject extends MeetingPrivacyProjectIdentity,
>(
  threads: readonly TThread[],
  projects: readonly TProject[],
  input: {
    readonly enabled: boolean;
    readonly hiddenProjectKeys: readonly string[];
  },
): TThread[] {
  if (!input.enabled || input.hiddenProjectKeys.length === 0) {
    return [...threads];
  }

  const visibleProjectRefs = new Set(
    filterProjectsForMeetingPrivacy(projects, input).map(
      (project) => `${project.environmentId}\0${project.id}`,
    ),
  );
  return threads.filter((thread) =>
    visibleProjectRefs.has(`${thread.environmentId}\0${thread.projectId}`),
  );
}
