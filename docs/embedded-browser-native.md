# Embedded browser native runtime

This layer adds isolated browser tabs and desktop IPC. It requires the embedded-browser contracts, URL/text policy helpers, and sender-bound IPC changes. The renderer workspace and provider broker are separate stack entries.

Each tab has an in-memory Electron session and belongs to its exact renderer. Remote pages have no preload, Node integration, or desktop bridge. The runtime denies permission requests, downloads, and new windows. It accepts only HTTP, HTTPS, and the blank start page.

Hiding a tab preserves its page and session. Closing a tab clears its storage, cache, and HTTP authentication cache. Renderer destruction and desktop shutdown close all owned tabs. Nothing in this layer restores tabs after an app restart.

Sharing requires a native confirmation for the current origin. The grant permits routine snapshots and controls without another dialog for each action. Cross-origin navigation or revocation removes the grant. Each action checks the current document and control revision. Snapshot target identifiers are bounded, opaque, and single-use for actions. Sensitive text entry still needs explicit consent and a secure or loopback transport.

Native input requires a focused owner window and a visible document. A hidden or unfocused page cannot report input as completed. Text entry waits for Electron to accept the insertion and reports a failure if Electron rejects it.

DOM snapshots contain bounded rendered text, labels, and target summaries. Form values are not read. URL query data and heuristic secret patterns are redacted. Redaction cannot guarantee that arbitrary page text contains no secrets; share only the page that the task needs.

The runtime accepts an optional local OCR engine. Without the separate bundled OCR implementation, an OCR request reports `unavailable` and does not capture pixels. DOM reading and manual browsing remain available.

Validation includes owner isolation, permission denial, origin and document races, target replacement, tab retention, and cleanup. Synthetic native checks must use local fixture pages and a temporary app profile. Do not use logged-in pages or personal browser data for review media.

The Windows Electron probe passed twelve checks, including actual trusted mouse events with a DOM change, text insertion, and session cleanup. The offscreen test fixture disables `CalculateNativeWinOcclusion` for that test process so Windows does not suppress rendering. Production launch flags are unchanged.
