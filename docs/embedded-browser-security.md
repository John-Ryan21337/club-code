# Embedded browser security and MVP boundary

The desktop app includes one isolated, temporary browser tab that is rendered inside the main
window. It is intended for user-supervised portal work. The browser is private by default: page
content cannot be snapshotted and app-assisted controls cannot run until the user explicitly shares
the current origin.

## Approval model

- Opening an empty tab, closing it, stopping a load, moving its view, and revoking sharing are safe
  local controls and do not prompt.
- URL navigation, reload, back, and forward each use a native desktop approval dialog.
- Sharing uses a native dialog and is scoped to the exact current origin. Cross-origin navigation,
  renderer loss, or tab close revokes it.
- A share grant does not expose page content by itself. Every DOM/accessibility snapshot requires a
  separate native approval.
- Every app-assisted click and typing operation requires a fresh approved snapshot plus its own
  native approval. Snapshot grants are invalidated when an action is requested or when navigation,
  loading, or title state changes.
- Credential and 2FA entry is visibly marked as sensitive, uses a warning approval, never displays
  the value in that dialog, and is rejected on cleartext remote HTTP pages. Loopback HTTP is allowed
  for local development.
- Direct interaction with the embedded page is an action by the user, not an agent action, so it
  does not add another prompt. The approval rules above apply to the app-assisted controls below the
  page.

The service records the page URL before an approval dialog and verifies that the exact page and
share grant are still current afterward. This prevents a page from navigating underneath an open
approval dialog and receiving an action intended for the previous page. Click and typing targets
are also rebound to their snapshot-time role, accessible name, and text immediately before the
native input is sent; an occluding element or replaced target fails closed.

## Agent handoff and bounded provider tools

After approving a snapshot, the user can choose **Add to one-time chat context**. A second native
confirmation adds a bounded, redacted summary to an editable context field beside the currently
visible chat composer. It is never sent automatically. The field is held only in component memory,
is excluded from the persisted composer draft, and is removed after a successful send or explicit
removal. Failed sends restore it in memory for review rather than copying it into persisted draft
storage. Target IDs are included so the agent can ask the user to approve a specific click or
typing operation in the browser panel.

Codex and Claude sessions receive a process-local MCP tool surface for redacted snapshots, bounded
offline OCR, navigation, snapshot-target clicks, non-sensitive typing, and history controls. OpenCode is
explicitly unavailable for this bridge until its current runtime can receive an equivalent
per-session, non-persistent authenticated MCP configuration.

The tools remain unusable until the operator grants the exact active thread and provider instance
access to the exact shared tab and origin. A grant lasts five minutes by default, never exceeds ten
minutes, permits at most 40 requests, and has a bounded queue and per-request timeout. Only one grant
exists in the provider process. Closing the tab, changing the origin, changing the active thread or
provider, reaching a limit, timing out, or clicking **Revoke now** revokes it and rejects queued
work.

The MCP listener binds to an ephemeral `127.0.0.1` port and requires a process-generated,
256-bit bearer credential bound to one exact thread/provider identity plus matching identity
headers. The endpoint and credential are injected directly into the Codex/Claude runtime configuration; they are not placed
in provider-session start contracts, the daemon command ledger, settings, browser storage, or
diagnostic payloads. Broker grants, queued type values, and results are memory-only.

A model request is only a request. The renderer polls the broker and invokes the existing desktop
bridge, so every DOM snapshot, visible-viewport OCR, navigation, click, type, and history action
still displays the existing native approval. Results are the same compact redacted contracts used
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

Choosing **Visible image text** requires the origin share plus a separate native approval. It
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
