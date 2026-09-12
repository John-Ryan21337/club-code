# Meeting privacy

Meeting privacy is a **renderer-local presentation filter**. The operator marks
individual project folders as hidden on one device, then flips a single mode.
While the mode is on, those folders and their threads are removed from the
renderer surfaces listed below. This reduces accidental disclosure during a
screen share or presentation; it does not hide every source of project text.

It is **off by default** and it is **not access control**.

## What it is and is not

| It does                                                                                                                        | It does not                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Remove hidden folders and their threads from lists, palette, new Electron notifications, and deep-linked routes on this device | Change credentials, permissions, or backend authorization                  |
| Persist the mode and the hidden list in this renderer's own UI state                                                           | Send the hidden list to the backend or to other devices                    |
| Preserve saved follow-ups and active provider turns                                                                            | Keep local queue dispatch running without an open chat view                |
| Name hidden folders only inside the manager dialog, on demand                                                                  | Redact message text inside a visible thread that mentions a hidden project |

Anyone using the machine can switch the mode off. Meeting privacy defends a
presentation, not a secret.

## Operator model

- **Hide a folder.** Right-click a project in the sidebar and choose
  "Hide during meetings". Hiding is per physical project folder, not per thread.
- **Turn the mode on or off.** The shield button in the sidebar Projects header
  is the global toggle; its label and tooltip state the current mode, and it
  carries `aria-pressed`.
- **Review the list.** The eye button opens the manager dialog, which lists the
  hidden folders and offers "Show" per row and "Show all". This dialog is the
  explicit control for revealing selected folders' names and paths, and its body is
  mounted only while the dialog is open, so hidden names are not sitting in the
  document during a share.
- **Status.** While the mode is on, the sidebar footer shows
  "Meeting privacy is on" without naming anything.

## Identity model

A hidden entry is a **physical project key**: environment id plus normalized
cwd, via `derivePhysicalProjectKeyFromPath`. Consequences:

- Two environments that share a path stay distinct.
- A folder stays hidden across restarts even when the backend mints a new
  project id.
- Keys for environments that are not connected right now are kept, so the folder
  is still hidden when that environment reconnects. The manager dialog says so
  when the stored list is longer than the list it can display.

Stored keys are sanitized on hydrate, on write, and on every hide action:
empty keys, keys over `MAX_MEETING_PRIVACY_PROJECT_KEY_LENGTH` (8192), keys
containing `NUL`/`CR`/`LF`, and duplicates are rejected, and the list is capped
at `MAX_MEETING_PRIVACY_HIDDEN_PROJECTS` (256).

## Module surface

`apps/web/src/meetingPrivacy.ts` is pure and has no store or React dependency:

| Export                                                                              | Role                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `meetingPrivacyProjectKey(project)`                                                 | Derive the physical project key                             |
| `isProjectHiddenForMeeting({ enabled, hiddenProjectKeys, project })`                | Single-project predicate                                    |
| `filterProjectsForMeetingPrivacy(projects, { enabled, hiddenProjectKeys })`         | Visible project list                                        |
| `filterThreadsForMeetingPrivacy(threads, projects, { enabled, hiddenProjectKeys })` | Visible thread list, derived from the filtered project list |
| `resolveMeetingPrivacyRouteDisposition({ enabled, hiddenProjectKeys, project })`    | `allow` / `pending` / `redirect` for route guards           |
| `sanitizeMeetingPrivacyHiddenProjectKeys(input)`                                    | Bounding and validation for persisted keys                  |

State lives in `apps/web/src/uiStateStore.ts` as `meetingPrivacyEnabled` and
`meetingPrivacyHiddenProjectKeys`, with `setMeetingPrivacyEnabled`,
`setProjectMeetingPrivacyHidden`, and `clearMeetingPrivacyHiddenProjects`.

Two fail-closed rules matter when wiring a new surface:

1. **Threads are filtered through projects.** A thread is shown only when its
   project is present in the filtered project list, so a thread whose project has
   not loaded yet is hidden while the mode is on.
2. **Routes resolve before they render.** `pending` means "identity unknown" and
   must render nothing rather than render optimistically; `redirect` must render
   nothing and navigate away.

## Surfaces filtered

As of 2026-09-11 the filter is applied in:

- `components/Sidebar.tsx` — project list, sidebar thread list, thread move
  destinations, the context-menu hide/show actions, footer status, and an
  empty state that distinguishes "hidden" from "no projects yet".
- `components/CommandPalette.tsx` — projects and threads; browse-to-path checks
  the **unfiltered** list so a hidden folder cannot be silently re-created, and
  warns without naming it.
- `components/DesktopNotificationWatcher.tsx` — suppress new Electron
  notifications for hidden or unresolved projects while the mode is on.
- `components/settings/SettingsPanels.tsx` — archived and recently-deleted
  panels, which derive their own project groups from snapshots.
- `hooks/useHandleNewThread.ts` — a hidden folder cannot become the implicit
  destination for a new thread.
- `routes/_chat.$environmentId.$threadId.tsx` and `routes/_chat.draft.$draftId.tsx`
  — deep-link guards.
- `components/atrium/TaskAtriumOverlay.tsx` — the board is replaced with a
  status line while the mode is on with at least one hidden folder.

New surfaces that enumerate projects or threads must apply the filter before
rendering. Arbitrary message text and user-selected environment labels are outside
this presentation filter.

## UI evidence (synthetic)

Media lives in [`docs/adoption-media/meeting-privacy/`](adoption-media/meeting-privacy):

| File                               | Shows                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `meeting-privacy-before.png`       | Mode off: three synthetic folders and all their threads visible                                                    |
| `meeting-privacy-after.png`        | Mode on: the hidden folder and both of its threads are gone; footer shows "Meeting privacy is on"                  |
| `meeting-privacy-interaction.webm` | 9.6 s, 900x620 VP8. Playwright recording of the toggle, the manager dialog, "Show", and the all-hidden empty state |

**Capture scope, stated exactly.** These were recorded in a headless Chromium
browser test harness that renders the **real** `MeetingPrivacyControls`
component and the **real** `uiStateStore`, and builds its list through the
**real** `filterProjectsForMeetingPrivacy` and `filterThreadsForMeetingPrivacy`,
inside a synthetic sidebar shell that reuses the shipped sidebar's Tailwind
classes. They are **not** screenshots of the full running Cafe desktop or web
application, and no backend, environment, provider, or account was involved.
All folder names, paths, and thread titles are invented
(`marketing-site`, `project-northwind-acquisition`, `docs-portal` under
`/workspace/...`); no real project or user data appears in any frame.

The recording predates the final help-text correction about queue dispatch.
Its manager dialog uses the earlier wording. The current controls and the
limitations below state that active turns and saved queue items are preserved,
but local queue advancement can pause when a hidden chat closes.

## Tests

- `apps/web/src/meetingPrivacy.test.ts` — pure module: identity, filtering,
  route disposition, fail-closed cases, sanitizing and bounds.
- `apps/web/src/uiStateStore.test.ts` — reducers, rejection of malformed and
  overflowing input, persistence round-trip, hydrate defaults (`false`).
- `apps/web/src/components/sidebar/MeetingPrivacyControls.browser.tsx` —
  hidden names absent from the document until the manager is opened, the global
  toggle, and the manager at a 390x844 viewport.
- `apps/web/src/components/DesktopNotificationWatcher.browser.tsx` — the real
  watcher suppresses hidden and unresolved completion titles, preserves its
  input session state, and resumes future notifications when the mode is off.

## Known gaps

1. Presentation only: a local user can turn the mode off.
2. Message text inside a visible thread is not redacted when it mentions a
   hidden project.
3. The web title remains the application name. Desktop window titles remain the
   configured environment display name; meeting privacy does not mask those labels.
4. Per-device only by design: the hidden list does not follow the operator to
   another client or machine.
5. Future surfaces must apply the filter explicitly.
6. Existing system notification history and service-worker Web Push are not
   masked. Turn off web push separately before sharing a browser client.
7. Follow-up queue dispatch currently lives inside `ChatView`. Redirecting a
   hidden active chat to the neutral page can pause local queue advancement
   until a chat view opens again. Saved queue items and active provider turns
   are preserved; this port does not move the dispatcher to a global runtime.
