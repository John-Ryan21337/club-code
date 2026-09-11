# Embedded browser security and MVP boundary

The desktop app includes up to eight isolated, temporary browser tabs rendered inside the main
window. It is intended for user-supervised portal work. The browser is private by default: page
content cannot be snapshotted and app-assisted controls cannot run until the user explicitly shares
the current origin.

## Approval model

- Opening an empty tab, closing it, stopping a load, moving its view, and revoking sharing are safe
  local controls and do not prompt.
- Sharing uses one native dialog that authorizes page text reads, local visible-viewport OCR,
  clicks, non-sensitive typing, and routine navigation for the current origin. Routine actions
  then run without a new dialog. The operator can revoke this authorization at any time.
- Explicit address navigation to a different origin requires approval. Clicked links and back/forward may leave the shared origin,
  but access to the destination ends until that origin is shared. Cross-origin navigation,
  renderer loss, or ending the tab session revokes sharing.
- Clicks and typing still require a fresh snapshot target. Snapshot targets are invalidated when
  an action is requested or when navigation, loading, or title state changes.
- Credential and 2FA entry is visibly marked as sensitive, uses a warning approval, never displays
  the value in that dialog, and is rejected on cleartext remote HTTP pages. Loopback HTTP is allowed
  for local development.
- Direct interaction with the embedded page is an action by the user, not an agent action, so it
  does not add another prompt. The approval rules above apply to the app-assisted controls below the
  page.

The service verifies the exact page URL, share grant, and per-tab control revision across asynchronous
operations and any remaining approval dialog. Revocation, re-sharing, and navigation advance the
revision, so returning to the same URL cannot restore a pending action. This prevents a page from navigating underneath an open
approval dialog and receiving an action intended for the previous page. Click and typing targets
are also rebound to their snapshot-time role, accessible name, and text immediately before the
native input is sent; an occluding element or replaced target fails closed.

## Agent handoff and bounded provider tools

After taking a snapshot under the current origin's sharing authorization, the user can choose
**Add to one-time chat context**. A separate native confirmation adds a bounded, redacted summary to an editable context field beside the currently
visible chat composer. It is never sent automatically. The field is held only in component memory,
is excluded from the persisted composer draft, and is removed after a successful send or explicit
removal. Failed sends restore it in memory for review rather than copying it into persisted draft
storage. Target IDs describe the captured page. This handoff does not grant control: agents must use
the live browser tool's current origin authorization and fresh snapshot targets for actions.

Codex and Claude sessions receive a process-local MCP tool surface for redacted snapshots, bounded
offline OCR, navigation, snapshot-target clicks, non-sensitive typing, and history controls. OpenCode is
explicitly unavailable for this bridge until its current runtime can receive an equivalent
per-session, non-persistent authenticated MCP configuration.

Codex and Claude threads have access by default once the desktop opens and shares a page.
The operator can select **Disable for this thread** or **Enable for this thread** in Agent Browser.
Opt-outs persist in backend-authoritative settings and are excluded from presentation profiles.
Switching the visible chat does not revoke access for other enabled threads.

The desktop polls the broker while the shared tab remains open, including while minimized.
Each request retains its exact thread, provider, tab, and origin. Requests enter one bounded queue
with a per-request timeout. A disconnected desktop cannot authorize new requests. Disabling a
thread rejects its queued work; provider retirement invalidates that provider's credentials.
Snapshot controls belong to the requesting identity and cannot be reused by another thread.
Closing the tab or revoking page sharing ends access. Origin changes require sharing the new page.
The legacy timed-grant RPC remains for protocol compatibility; the current UI does not use it.

**Minimize Agent Browser** hides the native view and keeps the same tab, cookies, and login session.
**Resume Agent Browser** restores that tab without opening a new partition. An agent request restores
the browser before running the requested action. The panel **Hide** button also preserves tabs. **End tab session** clears only the selected tab and its temporary storage. App restart ends all tab sessions.

The bottom tab strip restores retained pages without opening new partitions. Each tab has its own isolated session. Only the selected shared tab is polled for agent work; switching tabs revokes the previous broker context and snapshot authority. Background navigation updates its own tab label and cannot select that tab. Native actions and tab changes are serialized.

Browser panels and the split divider reserve the native window-control area using the reported title-bar geometry. Geometry changes update the inset; floating panels cannot move above it. Browser controls use non-draggable regions so native window dragging cannot intercept them.

The floating panel can be moved and resized. Split view starts at 50/50 and resizes the actual chat area, with an adjustable divider and a stacked layout on narrow windows. The native view is hidden during pointer resizing so it cannot capture the drag; its current bounds are restored when the drag ends.

The main trust boundaries remain the authenticated provider identity, the trusted desktop renderer,
and isolated remote web content. The changed policy grants enabled local threads access to an
operator-shared page; it does not expose raw cookies or allow sensitive-field automation. Regression
tests cover cross-thread targets, explicit opt-outs, provider retirement, disconnected polling,
minimize/resume without session cleanup, independent tab storage, selected-tab visibility, and cleanup when a tab session ends.

The MCP listener binds to an ephemeral `127.0.0.1` port and requires a process-generated,
256-bit bearer credential bound to one exact thread/provider identity plus matching identity
headers. The endpoint and credential are injected directly into the Codex/Claude runtime configuration; they are not placed
in provider-session start contracts, the daemon command ledger, settings, browser storage, or
diagnostic payloads. Broker grants, queued type values, and results are memory-only.

A model request is only a request. The renderer polls the broker and invokes the existing desktop
bridge. The native service checks the current origin authorization for each action, without
repeating the consent dialog for routine actions on the shared origin. Results are the same compact redacted contracts used
by the manual UI. The tool cannot receive screenshot bytes, read cookies/storage/form values, or
access credentials.
Agent-requested typing always sets `sensitive: false`; the broker independently rejects targets
marked sensitive by the latest snapshot, stale targets, likely secrets, and one-time numeric codes.
Passwords, credentials, and 2FA remain operator-only and never enter a model tool result.

## Remote-content isolation

Each open tab receives a random, non-`persist:` Electron partition. Remote content runs with:

- Node.js integration disabled;
- context isolation and Chromium sandboxing enabled;
- web security enabled and insecure subresources disallowed;
- permissions denied;
- popups and downloads denied; and
- navigation limited to `http:`, `https:`, and the internal blank page.

Only the trusted, top-level main renderer can invoke the strict IPC methods. Its trust is pinned to
the exact initial file document or loopback origin, and main-window navigation or redirects outside
that scope are blocked. Tabs are owned by that renderer and tab IDs cannot be used by another
renderer. On close, the view is detached, its webContents is closed, and its isolated storage, HTTP
authentication cache, and content cache are cleared.

This boundary does not make a remote site trustworthy. A site still sees the user's network
address, can retain data on its own servers, and can render misleading controls. The temporary
partition limits local persistence; it is not an anonymity system.

## Snapshot and secret handling

The snapshot is generated locally from the rendered top-level DOM. It returns bounded body text,
interactive roles and accessibility labels, and image alt/title labels. Rendered text below the
current viewport can be included. Form values are not directly queried, but authors can mirror
field or contenteditable text elsewhere in the rendered DOM, so the confirmation must still be
treated as page-wide. URL credentials are rejected, and URL query and fragment data are removed
before a URL crosses back to the app UI. The one-time chat handoff reduces the page address to its
origin so secret-bearing path segments do not enter the provider transcript.

Before IPC output, likely one-time numeric codes and common token forms are replaced with redaction
markers. Page titles, target labels, body text, and image labels use the same redaction. Sensitive
typing values are held only long enough to invoke Electron's native `insertText`; they are cleared
from renderer state before the asynchronous action and are not included in action results, approval
text, application logs, or the snapshot.

Redaction is heuristic, not a proof that arbitrary page text contains no secret. Native snapshot
and chat-draft confirmations warn the user not to approve inboxes or secret-bearing pages, and the
draft must be reviewed before sending.

## OCR and accessibility limitations

Choosing **Visible image text** uses the current origin authorization without another dialog. It
captures only the current isolated `WebContentsView` viewport, never another window or the
background screen. The capture is rejected above 4,096 pixels on either edge or 16,777,216 source
pixels, downscaled to at most 2,048 pixels on either edge and 2,097,152 OCR input pixels, and
rejected above 8 MiB of encoded PNG. One isolated OCR child process may run at a time and has a
30-second total startup-and-recognition deadline. The child starts with a 384 MiB V8 heap limit, a
minimal allowlist of platform, temporary-directory, locale, and timezone environment variables,
and no provider credentials, proxy variables, `PATH`, `NODE_OPTIONS`, or user-profile variables.
Its response pipe is limited to 64 KiB. Only text output is requested, it is clipped to the
snapshot contract, probable secrets and one-time codes are redacted, and parent and child PNG
buffers are zeroed. The child is killed on success, failure, shutdown, or timeout. Cleanup waits at
most one second in the request path; if process exit cannot be confirmed, OCR fails closed for the
rest of that desktop process instead of starting a second child. Navigation/origin drift discards
the result. No screenshot bytes or partial OCR text cross IPC or enter a provider result.

The V8 heap flag is not an operating-system RSS quota: WebAssembly and native runtime allocations
can exist outside that heap. Memory is additionally constrained by the single-child rule, bounded
input/output, downscaled pixel count, short deadline, and process termination, but the MVP does not
claim a strict cross-platform total-RSS ceiling.

OCR is powered by the pinned open-source `tesseract.js` 7.0.0 package (Apache-2.0) and its
`tesseract.js-core` WebAssembly dependency. The packaged `@tesseract.js-data/eng` 1.0.0 and
`@tesseract.js-data/jpn` 1.0.0 trained-data packages are MIT licensed. They are desktop runtime
dependencies and are shipped inside the application. The worker receives only those absolute
package-local language paths with cache writes disabled; the feature does not use a CDN, download
language data at runtime, call cloud OCR, or advertise languages other than English and Japanese.
The language selector runs one model per approved action; it does not claim automatic bilingual
language detection.

The DOM capture does not include cross-origin iframe contents, closed shadow roots, canvas pixels,
or text that exists only in an image. It is a compact accessibility-oriented projection rather than
a complete browser accessibility tree.

## Email codes and 2FA

The browser can display a provider's normal sign-in and 2FA page. The user can manually retrieve a
code and enter it directly, or paste it into the transient sensitive-entry field and approve a
single insertion. The app does not read an email inbox, integrate with an email provider, intercept
messages, bypass 2FA, retain recovery codes, or persist credentials.
