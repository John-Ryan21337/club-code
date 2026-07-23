# Cafe Code Ambient Experience Project Plan

Status: Shipped v1 scope implemented and automated gates clean; manual, soak, platform-artifact, and conditional native-feasibility gates remain open.

Implementation note: “Scoped checks run” below records only the focused checks currently evidenced for that slice. It does not mean the Phase 7 full command set, manual matrix, soak, CSP/package checks, or native-release evidence have passed.

Audit note: names are recorded only where the current implementation record establishes the scope. An absent or partial independent audit remains a release blocker.

Canon: [ambient-experience-canon.md](./ambient-experience-canon.md)

Coordinator: Spark
Review roles: Sol, Terra, Luna

## Outcome

Deliver optional full-window snow/rain/Matrix effects, streaming and image chat media, session-only browser Local Media, public YouTube search/playlists, desktop-local owned-playlist discovery, floating/cinema/background presentations, configurable glow, custom placement/sizing, a live workflow/sub-agent view, and supported-platform native window opacity without weakening Cafe Code's security or long-session stability. Keep native libVLC/projectM as a separate conditional feasibility track: the shipped HTML Local Media player and its bounded blob-only visualizer are not a native-media commitment.

This plan intentionally delivers reviewable slices. Contract/scaffolding phases may merge only behind inactive feature gates; a user-visible feature may ship only when its renderer/server dependency and exit gate are clean.

## Working agreement

Each implementation slice has an author and a different auditor. Authors must not approve their own slice. The default rotation is:

| Slice                         | Primary | Independent audit |
| ----------------------------- | ------- | ----------------- |
| Contracts and settings        | Luna    | Sol               |
| Atmosphere renderer           | Sol     | Terra             |
| Media security and storage    | Terra   | Luna              |
| YouTube discovery/account     | Terra   | Sol               |
| Workflow normalization        | Luna    | Terra             |
| Workflow UI                   | Spark   | Sol               |
| Chat media/cinema interaction | Spark   | Sol               |
| Local media feasibility       | Terra   | Luna              |
| Electron opacity              | Sol     | Luna              |
| Integration/release           | Spark   | Terra, then Luna  |

If an assigned model/agent is unavailable, preserve the role separation with another reviewer and record the substitution in the pull request.

An audit finding is either fixed and retested or recorded as an explicit accepted risk by the project owner. "Tests pass" does not erase security, accessibility, platform, or performance findings.

## Dependency map

```text
Canon and threat model
        |
        +--> settings contracts and defaults
        |        |
        |        +--> Appearance controls
        |        +--> atmosphere renderer
        |        `--> media configuration
        |
        +--> authenticated ambient asset store --> ambient image panel
        |
        +--> production CSP and policies --> YouTube/Spotify strict parser and official embeds
        |                                      ^
        +--> backend Data API key --> public search/playlists
        +--> external-browser OAuth/PKCE --> private playlist picker
        |
        +--> pure media geometry --> preset panels --> custom drag/resize
        |                                  `--> stable player session --> cinema workspace
        |
        +--> Local Media native feasibility spike --> conditional native theater
        |                                      `--> bounded PCM tap --> conditional projectM visualizer
        |
        +--> normalized orchestration activities
        |        `--> workflow reducer/snapshot --> plan/workflow panel
        |
        `--> desktop-local DesktopAppSettings
                   `--> typed capability/IPC --> DesktopWindow native opacity

All vertical slices --> cross-surface integration --> soak/security/release audit
```

## Phase 0 — Baseline, decisions, and test fixtures

Goal: lock the architecture before application code changes.

Tasks:

- Adopt the canon and keep it updated when implementation facts change.
- Capture baseline memory, renderer CPU, typing latency, timeline scrolling, and token-to-screen timing with all ambient features off. Record hardware, production/development build, scenario, sampling duration, and allowed deltas used by every later gate.
- Define final numeric limits for particle density, GIF bytes/animation work, panel sizes, glow, and opacity.
- Select and audit an implementable GIF parser/metadata mechanism for frame, duration, disposal/subframe, and cumulative-work validation. Avoid a native dependency unless packaged desktop validation justifies it.
- Add reusable test fixtures for valid/invalid YouTube URLs, static raster uploads, bounded GIFs, malformed/truncated GIFs, animation bombs, APNG, and animated WebP.
- Decide the YouTube Data API key/configuration path, quota budgets, cache/rate limits, exact result fields/branding, safe-search/region defaults, dedicated-client trace redaction, and static `i.ytimg.com` thumbnail-proxy rules.
- Register/verify the shipped Google OAuth topology: local packaged Electron uses a Desktop-app client and Google's bare loopback redirect form, `http://127.0.0.1:<backend-port>`, with the local backend's actual port and no added path. Record the exact `https://www.googleapis.com/auth/youtube.readonly` scope, owner-only authorization, bounded in-memory per-session tokens (no at-rest refresh token), and that this does not authenticate Premium playback in the iframe. Remote-web OAuth remains out of scope.
- Inventory current release-readiness CSP work and every required source: inline boot code, Google Fonts, data/blob previews, workers/service worker, remote HTTP/WebSocket environments, Vite/HMR, browser production, and packaged Electron.
- Inventory Codex/Claude normalized activity fields, provider fidelity, redaction guarantees, reconnect history, and maximum workflow graph/event sizes.
- Confirm the implemented 12-pixel same-corner image stack, aspect-ratio handling, streaming-only 640-pixel floating hide rule, and bounded pointer/keyboard custom controls against product mockups. No 768-pixel/coarse-pointer fallback is currently implemented.
- Confirm every media default/bound in the canon table, including opposite default corners, medium preset sizes, glow values, null sources/assets, and effective-empty behavior.
- Record manual-test platforms available: Windows, macOS, Linux/X11/Wayland, and browser.
- Define the release-native-opacity platform manifest and evidence record. It defaults empty; a release enables `win32` or `darwin` only after that exact artifact/version receives its native smoke result.

Likely files:

- `docs/ambient-experience-canon.md`
- `docs/ambient-experience-project-plan.md`
- existing release-readiness security docs as cross-references only

Exit gate:

- product choices have no unresolved ambiguity;
- threat model covers iframe, Data API key/quota, OAuth/tokens, uploaded animation, workflow payloads, preload IPC, and invisible-window recovery;
- the GIF validation mechanism and CSP source inventory are recorded; and
- baseline measurements and numeric pass/fail budgets are recorded.

## Phase 1 — Contracts, defaults, and settings UI

Goal: introduce safe, backward-compatible configuration with no renderer behavior yet.

Tasks:

- Add flat bounded schemas and defaults for atmosphere, media layout, ambient image metadata, and glow.
- Add shared `ambientVideoPresentationMode: floating | cinema` with canonical/backward-compatible default `floating`; include it in `ClientSettingsSchema`, `ClientSettingsPatch`, ambient key/reset vectors, and changed-settings summaries.
- Add atomic `AmbientVideoSource` (`YouTube video | YouTube playlist | Spotify entity | null`) with strict IDs and default `null`.
- Use one shared `preset | custom` layout mode per media slot plus separate preset placement/size fields.
- Add every key to `ClientSettingsPatch`.
- Define `AmbientImageAsset` metadata and strict ID/URL/MIME/dimension schemas.
- Update default/reset and changed-settings summaries.
- Build Appearance sections for atmosphere and media behind per-slice inactive feature gates. Expose each section only when its renderer/server slice lands. Native opacity UI is delivered with its real capability bridge in Phase 6.
- Preserve the last mode/options when a parent switch is off.
- Keep custom geometry in a versioned device-local store with a migration/reset function.
- Add field/group-scoped persisted-document recovery: absent fields default, corrupt ambient fields reset without erasing unrelated preferences, and malformed RPC patches reject atomically.
- Document in UI/help text that shared appearance/media configuration updates connected authenticated renderers while playback and geometry remain local.

Likely files:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/settings.test.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/SettingsPanels.browser.tsx`
- `apps/web/src/clientPersistenceStorage.ts`
- `apps/server/src/serverClientSettings.ts` and tests
- a new `apps/web/src/ambientMediaGeometryStorage.ts`

Tests:

- old direct, legacy-wrapped, empty, and partial settings decode to all-off safe defaults;
- missing/legacy `ambientVideoPresentationMode` decodes to `floating`; `floating` and `cinema` patches round-trip, other values reject atomically, and ambient reset/change-key parity includes the field;
- a corrupt ambient field/group preserves unrelated valid settings and emits a normalized warning;
- bounds, enum values, `"auto"`/hex colors, asset IDs, and malformed RPC patches are rejected atomically;
- patch-key parity test remains clean;
- flat-key control changes preserve sibling values and do not snap back during server reconciliation;
- controls persist exact normalized values and automatic color follows theme/effect changes;
- reset restores every ambient setting;
- local geometry migration clamps or resets corrupt data;
- `null` -> video/playlist -> replacement/reset source transitions are atomic;
- the complete canonical default/bounds vector round-trips, including `enabled: true` plus null source/asset as an effective empty state with no work;
- first/remote entry into custom mode seeds missing local geometry from the resolved preset; pane changes re-clamp without mutating shared mode or erasing geometry.

Exit gate:

- contract, web unit, and settings browser tests pass;
- no unfinished control is user-visible; all shells remain behind inactive per-slice gates;
- Luna's slice is audited by Sol.

## Phase 2 — Full-window atmosphere

Goal: ship snow, rain, and Matrix rendering behind the settings switch.

Tasks:

- Create pure seeded simulation/configuration functions.
- Create a single-canvas `WindowAtmosphere` component.
- Mount it once at the authenticated root.
- Integrate existing document visibility/window focus/background-animation policy.
- Add strict reduced-motion override.
- Cap DPR, density, arrays, frame delta, and resize work.
- Add named layer styling with `pointer-events: none` and `aria-hidden`.
- Ensure Electron title drag regions and every app control remain interactive.
- Place the canvas above app/media/glow but below chat affordances, dialogs, onboarding, toasts, and shutdown.

Likely files:

- new `apps/web/src/windowAtmosphere.ts`
- new `apps/web/src/windowAtmosphere.test.ts`
- new `apps/web/src/components/WindowAtmosphere.tsx`
- new browser/component tests for the atmosphere
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/documentVisibility.ts`
- `apps/web/src/documentVisibility.test.ts`
- `apps/web/src/index.css`

Tests:

- each mode selects the correct deterministic generator/draw path;
- disabled and reduced-motion modes schedule no frame;
- hide, blur, focus, and background-animation overrides behave correctly;
- resize keeps counts bounded and releases obsolete resources;
- canvas spans viewport and never intercepts input;
- particles visibly cross generic replaced/embedded-content fixtures without blocking interaction;
- high-DPI rendering respects the DPR cap;
- repeated enable/disable does not leak frames or listeners.

Manual checks:

- light/dark themes and custom accent colors;
- sidebar expanded/collapsed;
- Electron title bar drag and window controls;
- typing and timeline scrolling while each effect runs;
- minimize/restore and multi-monitor resize.

Exit gate:

- all automated tests pass;
- a 60-minute renderer soak is stable;
- Sol's slice is audited by Terra.

## Phase 2A — Workflow lifecycle normalization

Goal: create a provider-neutral, sanitized source for live workflow and sub-agent state.

Tasks:

- Define a runtime-schema-backed version 1 workflow snapshot with bounded display-safe nodes, recent activity, omission counts, and `live | lifecycle-only | not-reported` fidelity.
- Derive that snapshot in the renderer from the current thread's existing persisted orchestration activities, optionally scoped to the current turn. Reconnect uses the normal thread-detail resnapshot/subscription path; this slice adds no separate workflow event protocol, epoch, revision, watermark, or pagination cursor.
- Project Codex collaboration/sub-agent activity and Claude task progress without inventing unavailable hierarchy, duration, or status.
- Preserve provider-reported agent paths and parent correlation where available, with bounded depth and stable IDs within the derived projection.
- Build a pure bounded projection that is deterministic under replay/order changes, de-duplicates activity IDs, and preserves terminal lifecycle precedence.
- Keep raw provider payloads, hidden reasoning, secrets, and unredacted prompts outside the contract.
- Version the renderer-ready snapshot contract and keep older orchestration activity fields readable.

Likely files:

- `packages/contracts/src/orchestration.ts` and tests
- `packages/contracts/src/providerRuntime.ts` if canonical lifecycle types need extension
- new `apps/web/src/workflowProjection.ts` and tests

Tests:

- Codex hierarchy/start/interact/interrupt/terminal mapping;
- Claude lifecycle-only/progress mapping;
- unsupported provider fidelity and honest empty state;
- duplicate, replayed/out-of-order, missing-parent, missing-terminal, and terminal-before-start histories;
- current-turn filtering, normalized path separators, conflicting terminal results, and root-target de-duplication;
- arbitrary-depth paths remain bounded and cycle-free;
- status is never inferred from elapsed silence alone;
- redaction fixtures prove raw reasoning/secrets/prompts do not cross the normalized contract;
- node and recent-activity caps plus omission counts prevent unbounded state.

Exit gate:

- contract, adapter, orchestration, and reducer tests pass;
- sanitized projections reconstruct the current turn after the normal thread-detail reconnect;
- Luna's slice is audited by Terra.

## Phase 2B — Workflow Observatory UI

Goal: let users see the active workflow and launched sub-agents without exposing hidden reasoning.

Tasks:

- Evolve the existing Plan right panel into a `Plan | Workflow` shell using current inline/sheet responsive behavior.
- Add the root/sub-agent semantic tree, plan status, agent cards, provider-reported elapsed time when available, fidelity badge, and bounded recent safe activity.
- Use explicit text/icon status and a screen-reader/keyboard list/tree alternative to graphical connectors.
- Keep the view read-only and show `No recent activity` rather than guessing waiting/stuck state.
- Persist open/tab/expansion state in per-device `uiStateStore`, not Client Settings.
- Virtualize/bound large activity lists and update only affected nodes.
- Honor reduced motion with static indicators.
- Add an operator/runtime Workflow UI gate independent of Client Settings. When disabled or contract-incompatible, hide/clear the derived Workflow projection and leave Plan plus the normal thread-detail lifecycle available.

Likely files:

- `apps/web/src/components/PlanSidebar.tsx` or a renamed plan/workflow shell
- new workflow tree/card/activity components and browser tests
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/uiStateStore.ts` and tests
- `apps/web/src/rightPanelLayout.ts`
- `apps/web/src/session-logic.ts` only for shared safe display helpers

Tests:

- root plus parallel/nested agents update without remounting unrelated nodes;
- all seven canonical statuses (`queued`, `running`, `waiting`, `completed`, `failed`, `interrupted`, `unknown`) and provider-fidelity states;
- lifecycle-only nodes with missing path/parent/start time show honest placeholders and never derive elapsed duration from receipt time;
- reconnect snapshot followed by live event has no duplicate nodes;
- wide sidebar and narrow sheet, plan/workflow tab switching, keyboard traversal, screen-reader labels, zoom, and reduced motion;
- malicious labels render as text;
- token streaming/timeline scrolling stay inside Phase 0 budgets;
- no controls imply unsupported interrupt/steer/spawn authority.
- toggling the operational gate and mixed-version incompatibility unsubscribe/clear safely and re-enable from a fresh scoped snapshot.

Exit gate:

- browser, accessibility, reconnect, and performance tests pass;
- manual Codex and Claude multi-agent runs match provider-reported lifecycle;
- Spark's slice is audited by Sol.

## Phase 3 — Ambient image asset pipeline and preset panel

Goal: safely upload and show one ambient GIF/image in preset locations and sizes.

Tasks:

- Extract or adapt reusable raster-header validation without weakening branding-image behavior.
- Add a separate authenticated ambient-media store and upload/serve routes.
- Use content-hashed IDs and atomic writes.
- Enforce the upload byte cap while streaming, independent of missing, invalid, or underreported `Content-Length`.
- Add the audited GIF frame/duration/disposal/cumulative-work validation selected in Phase 0.
- Reject APNG and animated WebP; accept static PNG/JPEG/WebP plus bounded GIF.
- Add a backend-state-directory/profile quota and reference-checked delete eligibility on replace/remove. Run a bounded post-readiness background orphan sweep with a grace age, limited batches, and a current-reference recheck immediately before deletion. Mutation authorization mirrors Client Settings updates; authenticated readers of shared settings can fetch the referenced asset.
- Persist metadata only; never base64 bytes.
- Add upload, replace, remove, enable, placement, size, and glow settings.
- Create the chat media overlay shell in the relative messages wrapper.
- Implement bottom-left/right and small/medium/large behavior.
- Implement CSS glow using the configured color, not pixel sampling.
- Implement the canonical video-below/image-above 12-pixel stack and step-down fallback.
- Unmount animated GIFs for reduced motion and, unless background animations are allowed, while hidden/unfocused; show a non-animated placeholder.

Likely files:

- `packages/contracts/src/settings.ts`
- a new server ambient asset store and tests
- `apps/server/src/server.ts`
- server HTTP/router, streaming reader, and authorization tests
- `apps/server/src/serverClientSettings.ts` review/update if persisted normalization is required
- a new web upload helper
- new `apps/web/src/components/chat/ChatMediaOverlay.tsx`
- new `apps/web/src/components/chat/AmbientImagePanel.tsx`
- new `apps/web/src/chatMediaLayout.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/index.css`

Tests:

- unauthenticated upload/read is denied;
- forged extension/MIME/header combinations are rejected;
- absent, invalid, and underreported `Content-Length` cannot bypass the streaming byte cap;
- zero-byte, excess streamed bytes, over-dimension, over-pixel, truncated/corrupt GIF, huge-frame-count, cumulative-pixel, and small-canvas animation-bomb inputs are rejected;
- APNG and animated WebP are rejected; bounded GIF and static PNG/JPEG/WebP metadata and bytes round-trip;
- two authenticated sessions intentionally share the profile quota and referenced asset, while any session not authorized to update Client Settings cannot mutate it;
- replacement, duplicate hashes, profile quota boundaries, cross-session reads, concurrent replace/reference, young-file grace, bounded batches, restart, and pre-delete reference recheck behave correctly;
- disabled media does no animation/network work;
- reduced motion and hidden/unfocused policy stop GIF decode by unmounting rather than CSS hiding;
- panels stay inside the messages pane and do not cover composer/header;
- same-corner order/gap, limited-height step-down, plan panel, sidebar resize, zoom, and narrow layout follow the canon;
- object URLs and event listeners are released.

Exit gate:

- server, contract, web unit, and browser tests pass;
- upload abuse cases pass;
- Terra's storage/security slice is audited by Luna.

## Phase 4A — CSP, public YouTube discovery, and preset player

Goal: add narrowly permitted public video/playlist discovery and playback without broadening the app's web trust boundary.

Tasks:

- Add production Content Security Policy and supporting security headers.
- Allow only the privacy-enhanced YouTube and official Spotify Embed frame origins in renderer CSP; keep YouTube Data API access behind fixed backend outbound policy.
- Define production and development directives for scripts/styles/fonts/images/media/workers/connections/frames and externalize or nonce/hash inline boot content.
- Preserve tested saved remote HTTP/WebSocket environments without broadening `frame-src`.
- Implement a pure strict URL parser that produces the atomic `YouTubeSource` union for canonical video and playlist URLs, with the canon's exact 11-character video and 10–80-character playlist schemas.
- Persist only the normalized source kind and ID; never persist pasted URLs, search terms, or result payloads.
- Build fixed privacy-enhanced video and playlist embed URLs with a safe parameter allowlist.
- Render a conditionally mounted sandboxed iframe with the exact reviewed YouTube/Spotify feature policies and a viewport that meets YouTube's minimum player dimensions.
- Keep autoplay off until user interaction and unmount the iframe on disable/source replacement.
- Add an authenticated Cafe Code backend search endpoint and dedicated Data API client. Keep the key in a scoped server secret accessor; redact its query parameter and full upstream URL/body before HTTP tracing/diagnostics. Validate and bound queries, debounce callers, enforce per-user/global rate and quota budgets, cache briefly, cap results/page tokens, and apply the Phase 0 safe-search/region policy.
- Add an operator/runtime public-discovery gate and authenticated capability response. Disabling it rejects/cancels new search work and clears bounded transient caches without disabling strict URL entry or an already-selected public source.
- Proxy thumbnails through an authenticated server route restricted to HTTPS `i.ytimg.com` and the canonical bounded thumbnail path. Disable redirects and private/non-allowlisted destinations; cap time, bytes, dimensions, and MIME; return safe content headers and a placeholder on failure.
- Return only the fields needed for an attributed picker. Preserve YouTube titles/thumbnails and required branding without misleading modification.
- Provide strict URL entry, public search, and public-playlist selection without requiring a connected Google account. If the server key/quota is unavailable, keep URL entry working and offer an external YouTube search link with a clear status.
- Add the privacy disclosure and clear invalid-input, quota, offline, and embedding-disabled errors.
- Consider a separately reviewed `will-navigate` main-frame guard as defense in depth.

Likely files:

- server config/environment schema and static/HTML response header code
- a new server YouTube Data API client/search service, authenticated route, and tests
- new `apps/web/src/youtubeSource.ts`
- new `apps/web/src/youtubeSource.test.ts`
- new YouTube search/picker components and browser tests
- new `apps/web/src/components/chat/AmbientVideoPanel.tsx`
- `apps/web/src/components/chat/ChatMediaOverlay.tsx`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- Electron navigation tests if the defense-in-depth guard is included

Tests:

- accept exact `youtube.com`, `www.youtube.com`, and `youtu.be` hosts with canonical video paths and `youtube.com`/`www.youtube.com` canonical `/playlist?list=` paths;
- reject lookalike domains, credentials, non-HTTPS, HTML, unknown paths, malformed IDs, and watch URLs containing both `v` and `list` as ambiguous with a corrective message; ignore rather than forward unrelated query/fragment values;
- generated iframe sources never contain raw input;
- parser, renderer, API client, and error logs never include pasted URLs, search terms, normalized video/playlist IDs, API keys, or response payloads;
- API keys are absent from renderer bundles/responses and unavailable to an unauthenticated client; a fake HTTP trace/diagnostic sink proves outbound URL/query/body logging cannot disclose the key;
- query length/character validation, result/page caps, debounce, cache, per-user/global rate limits, quota exhaustion, cancellation, timeout, and upstream malformed/spoofed data fail safely;
- discovery-gate disable cancels/rejects new work, clears cache, preserves already-counted quota accounting, and re-enable starts clean without affecting URL entry;
- search result text renders as text and YouTube attribution/thumbnail provenance remains intact;
- thumbnail proxy rejects alternate hosts, credentials, redirects, DNS/private-address rebinding, unexpected paths/MIME, oversize/slow bodies, and malformed images; renderer CSP needs no YouTube thumbnail origin and invalid thumbnails use a placeholder;
- exact iframe title, sandbox (including the fixed-origin `allow-popups` concession), referrer policy, provider-specific feature policy, conditional mounting, and minimum dimensions are asserted;
- iframe is absent while disabled and removed on disable;
- the real Phase 3 image and YouTube iframe remain interactive while the atmosphere renders visually above them;
- popup/top navigation attempts do not escape;
- CSP blocks unlisted frames/connections/images and permits only the intended renderer production origins; backend allowlists independently constrain Google API and thumbnail egress;
- CSP permits the inline-code replacement/nonce/hash, fonts, authenticated uploads/previews, workers/service worker, saved remote HTTP/WebSocket environments, and packaged Electron startup;
- development CSP supports Vite/HMR without leaking development exceptions into production;
- no desktop sandbox or context-isolation setting changes.

Manual checks:

- first play requires interaction;
- video and playlist playback stop on disable;
- fullscreen/picture-in-picture behavior matches the allowlist;
- public search, URL entry, picker selection, and external fallback are understandable;
- browser and Electron both render or fail with a useful message;
- offline and YouTube-blocked networks do not affect chat.

Exit gate:

- CSP/security, backend, contract, and browser tests pass;
- security audit finds no key exposure, arbitrary navigation/embed path, or quota-amplification path;
- Terra's slice is audited by Luna.

## Phase 4B — Connected YouTube account and owned playlists

Goal: let the Cafe Code owner discover playlists from their own YouTube account without embedding Google login or misrepresenting Premium playback.

Tasks:

- Implement owner-only Google OAuth Authorization Code with S256 PKCE using the external system browser and the canon's one shipped deployment mode: local packaged Electron plus its local backend, a Desktop-app client, and Google's bare `http://127.0.0.1:<backend-port>` loopback redirect. Browser/remote-web OAuth is unavailable.
- Let the renderer request only a backend-created authorization transaction. Permit external opening/user navigation only to `https://accounts.google.com/o/oauth2/v2/auth`; never accept a renderer-supplied redirect or authorization URL.
- Derive the bare loopback redirect from the local backend's actual port, accept it only from a loopback peer, and never append an application path or fall back to a non-loopback/remote callback.
- Use high-entropy, single-use, expiring `state` and PKCE verifier records; bind callbacks to the initiating Cafe Code owner/session and reject replay.
- Request exactly `https://www.googleapis.com/auth/youtube.readonly` and forbid additional scopes in version 1. Complete Google consent-screen, verification, privacy-policy, and data-handling work before production release.
- Exclude the callback from raw-query access logging. Send no-store/no-referrer headers, consume state atomically, exchange the code server-side, and return a fixed completion/error response. Expose only opaque transaction status to the initiating authenticated owner session.
- Keep access/refresh tokens in a bounded in-memory grant for the initiating owner session. Never place them at rest, in Client Settings, renderer storage, URLs, logs, or workflow events.
- Add an operator/runtime account-connection gate and capability response. Disabling it blocks new authorization, invalidates in-flight state, and stops refresh/playlist work; owner-only disconnect/revoke remains available while gated off.
- Serialize token refresh, handle revocation/expiry, and provide explicit disconnect plus best-effort Google token revocation and local deletion.
- Fetch the authorized user's playlists with the supported owned-playlist endpoint, then fetch bounded playlist items on demand. Keep private playlist metadata owner-only, permit in-app selection only when the supported embed can play the source, and route private/non-embeddable items to signed-in YouTube. Explain unavailable/special collections rather than fabricating them.
- Label the action `Connect YouTube account`, not `Sign in to YouTube Premium`.
- Treat account connection as playlist discovery only. Add `Open in signed-in YouTube` for playback that must inherit browser-account/Premium behavior.
- Preserve public search and URL entry when no account is connected.

Likely files:

- contract runtime schemas for connection state, playlist summaries, and owner-only RPC/HTTP responses
- server OAuth state/PKCE service, bounded in-memory owner-session grant/refresh coordinator, YouTube playlist service, routes, and tests
- server deployment configuration and operator documentation
- web connection status, playlist picker, disconnect action, and browser tests
- existing Electron external-browser helper/allowlist, without an embedded-login window

Tests:

- non-owner and unauthenticated callers cannot start, complete, inspect, or disconnect a connection;
- state mismatch, expired state, redirect replay, wrong initiator, missing PKCE verifier, denied consent, and malformed callback fail closed;
- generated authorization requests use only the fixed Google authorization endpoint, S256, the exact read-only scope, and the one configured redirect; additional scopes and renderer-provided URLs/redirects are rejected;
- browser/remote-web use, callback mismatch, loopback port collision, session expiry, and local callback failure fail safely;
- callback query/code/state never enter access/trace logs, diagnostics, error pages, redirect `Location`, referrers, renderer state, Client Settings, or workflow activity, including malformed and upstream-exchange failures;
- concurrent requests cause one serialized refresh; expiry, revoked grants, upstream timeout, partial response, and disconnect-during-refresh recover consistently;
- disconnect revokes best-effort, deletes local tokens, clears connection state, and leaves public search/URL entry usable;
- account-gate disable invalidates in-flight transactions, blocks connect/refresh/list work, clears the memory-only grant, and still permits owner-only disconnect/revoke; re-enable starts a clean transaction;
- owned playlists and items are owner-authorized, bounded/paginated, schema-validated, and sanitized without altering YouTube attribution;
- private/non-embeddable playlists never leak to other Cafe Code sessions or claim in-app playability and instead use the external signed-in action;
- unavailable special/private collections show honest empty/error states;
- absent OAuth configuration produces a disabled control with operator guidance;
- no flow claims to authenticate the iframe or guarantee Premium benefits.

Manual checks:

- external-browser consent returns to the initiating session without opening an embedded Google login;
- connect, refresh within the active session, select playlist, disconnect, and reconnect work; restart intentionally requires a new connection;
- `Open in signed-in YouTube` uses the user's normal browser session;
- public search remains usable without connecting an account.

Exit gate:

- OAuth, token-store, authorization, playlist, browser, and redaction tests pass;
- threat-model and Google-policy reviews are recorded;
- Terra's slice is audited by Sol.

## Phase 4C — YouTube Cinema workspace

Goal: add an in-app, playback-preserving cinema layout without changing the default floating experience or conflating it with native YouTube fullscreen.

Tasks:

- Use the shared `ambientVideoPresentationMode: floating | cinema` Client Settings field, with `floating` as the backward-compatible default. Keep `ambientVideoLayoutMode: preset | custom` as floating geometry state; entering or exiting cinema patches only presentation mode and does not overwrite floating geometry.
- Derive effective cinema locally from shared `cinema` intent plus `ambientVideoEnabled`, a non-null valid source, a ready local player renderer, and a fitting protected-player layout. Failed readiness, no source, disabled video, hydration, or insufficient space keeps normal chat visible and does not patch shared intent.
- Keep native YouTube fullscreen player-owned and transient. Fullscreen temporarily supersedes the current in-app presentation and returns to that presentation on exit; Cafe Code does not fake fullscreen by stretching the iframe.
- Build the canonical three-region layout: the existing project sidebar on the left, one unobstructed 16:9 YouTube player in the center, and the active chat rail on the right.
- Treat the center iframe rectangle as protected. No Cafe-owned atmosphere, glow, image, chat control, popover, toast, dialog, onboarding, or shutdown visual may paint over or intersect it. Put required Cafe controls in the side regions or leave cinema before showing a surface that cannot fit.
- Let the project sidebar and chat rail collapse and expand independently, with transient per-device state and accessible toggles. Give reclaimed space to the center player without changing the other rail.
- Hoist one stable player/session owner and iframe host into an authenticated workspace shell above route-, project-, and thread-specific chat content. Key it by normalized YouTube source rather than navigation identity. `ChatView` only registers a measured floating anchor/portal target; neither route switches nor presentation changes reparent the iframe.
- Preserve playback and source across project/thread switches and floating/cinema transitions. Disable and source replacement retain their existing stop/unmount behavior.
- Preserve the last floating preset/custom mode and custom geometry. Exiting cinema restores the resolved floating presentation without a geometry write or jump.
- Make ambient-image suppression render-only while cinema is locally effective. Never capture, restore, or patch shared image enable/source state. When cinema stops being effective, read the current authoritative image settings and local geometry so concurrent shared changes are not overwritten.
- Base Plan/Workflow inline-versus-sheet behavior on measured chat-rail width. Force Diff into an existing sheet that avoids the player or locally suspend cinema while the stable playback session survives. Never create a fourth pane or patch shared presentation for these local layout decisions.
- Add a pure responsive layout calculation that collapses rails before shrinking the player. Keep the protected 16:9 viewport at least 356 by 200 CSS pixels after rounding; when that cannot fit with reachable controls and safe-area insets, locally show the normal/floating-safe layout and a clear status without patching the shared `cinema` preference.
- Add mode and rail keyboard controls, visible focus, semantic expanded/selected state, predictable focus entry/return, descriptive iframe title, and non-trapping focus order.
- Define `Escape` so Cafe Code exits cinema only when native fullscreen is inactive and the iframe has not consumed the key. Preserve player/platform ownership of native fullscreen exit.

Likely files:

- shared presentation settings integration plus a renderer-local playback/session state module
- an authenticated workspace-level `VideoSessionHost` (name illustrative) that owns the stable iframe
- `apps/web/src/components/chat/ChatMediaOverlay.tsx`
- `apps/web/src/components/chat/AmbientVideoPanel.tsx`
- `apps/web/src/components/chat/ChatView.tsx` only for measured floating-anchor/portal-target registration
- new cinema workspace layout and responsive geometry modules
- authenticated root/workspace route shells above chat routes
- browser tests for layout, focus, navigation identity, and fullscreen transitions

Tests:

- missing/legacy settings decode to floating, and entering/exiting cinema patches only `ambientVideoPresentationMode` without mutating floating layout mode or geometry;
- shared presentation changes reach connected renderers while active playback, native fullscreen, and rail collapse state remain device-local;
- effective cinema requires shared intent, enabled video, a source, local player readiness, and layout fit; every failed term leaves normal chat usable, shows no blank center, and preserves shared `cinema` intent;
- floating, cinema workspace, and native fullscreen are distinct states with deterministic return transitions;
- geometry/layer assertions prove that no Cafe-owned element intersects the iframe rectangle in cinema, including atmosphere, image/glow, scroll affordances, dialogs, toasts, onboarding, and shutdown;
- left and right rails collapse independently by pointer and keyboard, expose correct semantic state, and transfer only their own space to the center;
- project and thread switches preserve iframe DOM identity and parent, normalized source, player adapter identity, and playback intent while updating the surrounding rails;
- entering/exiting cinema changes host layout without reparenting the iframe, and `ChatView` unmount/remount only changes the measured floating anchor registration;
- source replacement and disable stop and unmount the old player exactly once;
- repeated floating/cinema round trips restore preset/custom mode and normalized custom geometry without extra persistence writes;
- ambient-image suppression writes no image settings; remote enable/disable/source changes made during cinema are read authoritatively when cinema locally suspends/exits;
- Plan/Workflow uses measured chat-rail breakpoints for its sheet, and Diff uses a noncompeting sheet or local cinema suspension without iframe replacement or shared-setting writes;
- responsive tests cover both rails open, either rail closed, both closed, browser zoom, safe areas, and the exact protected-player fit boundary without rendering below 356 by 200 CSS pixels or patching shared presentation;
- focus enters and returns predictably, rail/mode controls are keyboard operable, cinema is not a focus trap, and the iframe title remains descriptive;
- native fullscreen enter/exit returns to the prior floating or cinema state, while `Escape` ownership does not double-exit;
- navigation, toggling, and error recovery do not duplicate iframes, listeners, player adapters, or playback telemetry.

Manual checks:

- floating remains the startup/default presentation and retains existing preset/custom behavior;
- cinema shows the existing project sidebar, unobstructed center video, and usable right-side conversation;
- project and thread switches do not interrupt audible/visible playback;
- each rail can be collapsed and reopened without moving controls over the player;
- native player fullscreen enters and returns to the prior in-app presentation on browser and Electron surfaces;
- narrow windows and high zoom fail back clearly before the player or controls become unusable.

Exit gate:

- unit and browser tests for state, stable player lifecycle, responsive layout, layering, keyboard/focus, and fullscreen transitions pass;
- no-source, disabled, player-not-ready/error, plan/workflow, diff, and fit-failure gates preserve normal chat, stable playback where available, and shared cinema intent;
- a screen-reader and browser/Electron manual pass is recorded;
- no Cafe-owned visual overlaps the cinema iframe in the recorded layout matrix;
- Spark's slice is audited by Sol.

## Phase 5A — Custom drag, resize, and accessibility

Goal: add precise custom media positioning without disrupting chat interaction.

Tasks:

- Implement pure normalized geometry, clamping, collision, and preset conversion.
- Store normalized x/y/width, derive video height at 16:9, and derive image height from validated intrinsic ratio.
- Entering custom mode seeds geometry from the currently resolved preset exactly once when usable local geometry is absent; remote custom mode with no local geometry follows the same rule.
- Add explicit drag and resize handles with Pointer Events and pointer capture.
- Batch visual movement with `requestAnimationFrame`.
- Persist once at interaction completion.
- Add keyboard move/resize increments, reset, close, and focus order.
- Clean up capture, cursor, selection, frames, and listeners on every termination path.
- Clamp custom geometry to the current measured pane while preserving normalized geometry across layout changes; keep pointer and keyboard controls available.
- Re-clamp after sidebar, plan panel, viewport, display, and zoom changes.

Likely files:

- `apps/web/src/chatMediaLayout.ts`
- `apps/web/src/chatMediaLayout.test.ts`
- `apps/web/src/ambientMediaGeometryStorage.ts`
- `apps/web/src/components/chat/ChatMediaOverlay.tsx`
- browser tests for pointer and keyboard interaction

Tests:

- every edge/corner clamp and minimum/maximum size;
- pointer-up, pointer-cancel, lost capture, and window blur commit the latest clamped frame; component unmount performs cleanup without a write;
- no per-move persistence writes;
- keyboard movement/resizing and focus visibility;
- iframe interaction does not accidentally drag;
- text selection and timeline scrolling outside the panel still work;
- corrupt or off-screen saved geometry recovers;
- two panels remain independently operable;
- first custom entry and remote custom-without-geometry seed from the current preset, while later preset/custom round trips retain local custom geometry;
- streaming-only 640-pixel floating hiding preserves source/settings, while ambient image and Local Media remain bounded; custom geometry survives pane changes.

Exit gate:

- pointer, keyboard, responsive, and cleanup tests pass;
- a screen-reader/keyboard manual pass is recorded;
- Spark's slice is audited by Sol.

## Phase 5B — Native Local Media Theater feasibility and conditional implementation

Goal: determine whether a secure, supportable native libVLC theater can ship, then implement it only if the feasibility gate passes.

This phase is conditional. Its spike and decision record are required work; user-facing native implementation is not authorized merely because the spike exists. It is deliberately separate from the shipped Local Media v1 slice: v1 is a current-session browser HTML media player with a picker-created object URL, floating/custom/Cinema/video-background presentation, and a bounded blob-element Web Audio visualizer. It has no file-path bridge, VLC, projectM, direct stream, Spotify/YouTube PCM, DRM, or universal-codec claim.

Feasibility tasks:

- Prototype a desktop-only libVLC process/native boundary without using or depending on a browser plugin. Compare: (a) native drawable/child-window output, (b) CPU video callbacks copied into renderer-owned canvas/WebGL textures, and (c) LibVLC 4 GPU/texture callbacks.
- For native drawable, record OS compositor ownership, clipping/z-order/opacity/focus limitations, and accept that this route cannot promise DOM interleaving or a true project/chat overlay.
- For CPU callbacks, benchmark decode-to-CPU copies, renderer upload, memory bandwidth, latency, color conversion, resolution/frame-rate ceilings, background throttling, and 16-hour resource stability.
- For LibVLC 4 GPU/texture callbacks, prove API maturity and bindings plus D3D/Metal/Vulkan/OpenGL interop as applicable, synchronization, device-loss recovery, sandbox/process transfer, packaging, and cross-platform maintainability.
- Record supported platforms/architectures, binary provenance, package size, startup cost, renderer/GPU composition behavior, crash isolation, update compatibility, installer/code-signing/notarization effects, and uninstall cleanup.
- Complete legal/branding review. Record LGPL notices, license text, corresponding-source/relinking obligations, distribution of modified components, and whether product copy may use VLC marks; default to `Local Media` or `Local Media (libVLC)`.
- Produce an explicit tested codec, container, playlist, subtitle, audio, and direct-stream protocol matrix. State clearly that the feature does not guarantee every codec/service, DRM, YouTube search/account parity, website URL extraction, or circumvention of third-party playback controls.
- Threat-model local file capabilities, playlist parsing, network destinations, redirects, DNS rebinding, credentials, metadata/logging, native crashes, malformed-media decoder attacks, process ownership, and update cadence.
- Define performance budgets for CPU/GPU, memory, decoder processes, textures, file handles, buffering, and teardown during the 16-hour target session.
- Prototype a bounded libVLC decoded-PCM tap feeding `libprojectM`. Measure audio-thread blocking, ring-buffer overrun/underrun, FFT/render latency, preset-switch cost, renderer upload, CPU/GPU use, hidden/unfocused behavior, and 16-hour cleanup/stability.
- Require the libVLC audio callback to be allocation-free, lock-free/nonblocking, and limited to bounded ring-buffer admission. Normalize sample rate, channel layout, and format off callback; drop oldest visualization input on overflow; cap audio-to-visual latency, render FPS/resolution/device-pixel-ratio, and guarantee that visualizer backpressure never reaches playback.
- Prototype projectM analysis/rendering inside a crash-isolated, least-privileged native media worker. Do not load it in the sandboxed renderer/backend, callback into JavaScript, or send raw PCM/FFT/history through renderer/server IPC. Prove a typed minimal control/status bridge and bounded texture/fence-handle transfer for each proposed platform; treat any CPU-copy route as a separately measured architecture.
- Inventory projectM core, bundled preset, texture-pack, and shader/input licenses. Version 1 is reviewed-bundled-presets-only. A future import gate must specify private content-addressed extraction; archive count/ratio/byte limits; traversal/absolute/symlink/reparse/include/external-reference rejection; texture count/dimension/decoded-pixel and transition caps; TOCTOU resistance; killable helper watchdog/device-reset recovery; and a malicious-input corpus.
- Establish a photosensitivity-safe bundled-preset allowlist and a tested post-render temporal flash limiter for luminance and saturated-red flashes. Reduced motion must stop the PCM tap, FFT, projectM, and visualizer GPU work without stopping user-requested audio.
- Classify PCM, FFT/spectrum, and analysis history as ephemeral sensitive media data that never leaves the native worker or enters IPC, persistence, synchronization, logs, telemetry, prompts, workflow, diagnostics, or crash dumps. Rendered visualizer output may cross only through the approved local texture/fence-handle path into the sandboxed renderer; it is never CPU-read back, persisted, logged, or sent through server/remote IPC, telemetry, prompts, workflow, diagnostics, or crash dumps.
- Record that YouTube is not a PCM source: the IFrame API exposes no audio-sample interface, and the implementation must not extract, intercept, decode, proxy, or otherwise analyze YouTube audiovisual content. Keep any generic system-output capture idea in a separate feasibility record requiring capture consent/privacy, WASAPI/Core Audio/PipeWire support, device/feedback recovery, and written third-party policy review; it is unavailable while Cafe Code's YouTube player is active.

Conditional implementation tasks, only after a recorded go decision:

- Add an explicit desktop capability response and default-off feature gate. Browser deployments render an honest unsupported state and never fall back to an unreviewed HTML player.
- Accept local files only through a native picker and a narrow desktop-local capability. Do not synchronize or log paths, and revalidate playlist entries at open time.
- Support only approved local playlist formats and direct network schemes from the recorded matrix.
- Put direct streams behind a narrow destination policy: reject URL credentials and unsupported schemes; validate every redirect and resolved address; block loopback, link-local, private, metadata, and rebinding destinations unless a separately reviewed local-network policy explicitly permits them; bound redirects, timeouts, buffering, response size, and retries.
- Keep native media processes and file/network capabilities out of the sandboxed renderer. Use a typed, authenticated desktop bridge with structured reason codes and no arbitrary path, URL, argv, or native-command execution.
- Add optional project/chat background or overlay presentation, distinct from YouTube Cinema, only if a renderer-owned CPU- or GPU-texture route passes the recorded performance and composition gate. A native-drawable implementation is limited to a dedicated theater region and MUST NOT advertise DOM overlay. Provide bounded opacity and readability treatments without obscuring focus, selection, composer state, or critical status.
- Add explicit `Pass through` and `Interact` click modes. Pass-through sends pointer input to Cafe Code and retains a dedicated non-overlapping or keyboard media-control path; interact mode exposes the media surface, a visible mode indicator, and an immediate keyboard escape. No invisible layer captures input.
- Define preset placement and bounded size before custom geometry. Preserve project/thread playback only when locally configured; disable, replace, shutdown, permission loss, and crash recovery release every native process, decoder, file handle, request, texture, and audio resource.
- Add a one-action stop/disable path and clear recovery for decoder crash, unavailable codec, missing file, revoked file access, unsafe URL, offline stream, and unsupported platform.
- Package required notices and corresponding-source/relinking material in every artifact whose feasibility record requires them.
- If and only if the audio-visualizer feasibility record passes, add a default-off `Local Media visualizer` sourced exclusively from the approved Local Media PCM tap, with reviewed bundled presets, bounded preset switching, a runtime-schema-bounded desktop-local `{ enabled, bundledPresetId }` record, field-scoped recovery, reduced-motion behavior, and deterministic worker/audio/GPU teardown. Do not persist source, playback position, PCM, analysis state, or imported paths.

Tests:

- capability and feature gates prevent any browser/native work while unavailable or off;
- architecture prototypes record comparable CPU/GPU, memory, copy count, latency, frame pacing, device-loss, resize, clipping, z-order, and 16-hour stability results on every proposed platform;
- native-drawable builds expose only the dedicated theater presentation and cannot select or advertise DOM background/overlay;
- CPU/GPU callback builds expose overlay only after automated composition tests and recorded performance budgets pass; fallback after device/texture failure removes the overlay claim rather than silently switching to an uncomposable native drawable;
- renderer requests cannot open arbitrary paths, network destinations, processes, or libVLC options;
- file selection capabilities are owner-local, narrow, revocable, not synchronized, and absent from logs/diagnostics;
- malformed playlists, traversal, symlinks/reparse points, special files, changing files, and stale capabilities fail closed;
- direct streams reject credentials, disallowed schemes/ports, redirects outside policy, private/link-local/loopback/metadata targets, mixed DNS answers, and DNS rebinding;
- playlist and redirect entries are revalidated at point of use, with bounded timeout, buffering, retry, and cancellation;
- fuzz/malformed-media fixtures cannot crash Cafe Code or leave orphaned native processes/resources;
- pass-through mode preserves chat/project pointer, selection, drag, scroll, and keyboard behavior; interact mode is announced, keyboard escapable, and never invisibly captures input;
- overlay opacity/readability remains bounded across themes, zoom, focus, critical dialogs, and narrow layouts;
- project/thread preservation follows local policy, while disable, replace, shutdown, crash, and permission loss deterministically release native resources;
- packaged-artifact tests verify native libraries, architecture, signing/notarization expectations, notices, license text, and required corresponding-source/relinking material;
- the tested support matrix matches user-facing capability copy.
- audio-file and approved Local Media playback feed bounded PCM to projectM without blocking decode/audio threads or chat rendering; pause/stop/disable/replace/crash/shutdown release every PCM, analysis, preset, graphics, and texture resource;
- direct YouTube audio cannot be selected as a visualizer source, no iframe/media interception path exists, and any future generic system-audio experiment remains gated off while the Cafe YouTube player is active;
- the audio callback remains allocation-free and nonblocking under ring overrun, format changes, device loss, and slow/hung visualization; overflow drops bounded visualization input without affecting playback; PCM/FFT/history remain inside the native worker; and rendered output crosses only by the approved local texture/fence handle and is never CPU-read back or admitted to server/remote IPC, logs, diagnostics, telemetry, prompts, workflow events, persistence, or crash dumps;
- bundled preset tests enforce license inventory, the safe allowlist, temporal luminance/saturated-red flash thresholds, bounded switching, reduced-motion no-work behavior, hidden/unfocused policy, and malicious-preset failure isolation;
- a future import test suite is mandatory before exposing import and covers archive bombs, texture bombs, traversal, absolute paths, symlinks/reparse points, shader includes, external file/network references, TOCTOU, malicious shaders, GPU timeout/reset, helper crash/restart, and complete cleanup;
- helper crash, GPU hang/device loss, malformed status/handle messages, restart, and shutdown release every buffer/context/texture/fence handle while chat remains usable;
- desktop-local visualizer settings default off, reject unknown preset IDs, recover their own corrupt fields without damaging unrelated settings, and Disable All does not report success until the PCM tap/worker is stopped or a retryable partial failure is reported.

Exit gates:

1. **Feasibility gate:** security, legal/licensing, branding, packaging, performance, and platform owners record a go/no-go decision plus the selected native-drawable, CPU-callback, or LibVLC 4 GPU/texture architecture and its platform matrix. A no-go ends the phase with no user-visible player.
2. **Overlay gate:** a true project/chat DOM overlay is separately approved only after a renderer-owned texture route proves composition, device-loss recovery, and performance budgets. Native drawable alone cannot pass this gate.
3. **Audio-visualizer gate:** Local Media visualization ships only after the bounded PCM tap, projectM packaging/licensing, preset security, reduced-motion behavior, renderer isolation, and long-session resource budgets pass. YouTube remains excluded as a direct audio source.
4. **Conditional ship gate:** only after go, focused unit/integration/native-artifact tests and the release matrix pass, a long-session resource soak is recorded, user-facing capability copy matches the selected architecture, and Terra's implementation is audited by Luna.

## Phase 6 — Native whole-window opacity

Goal: support bounded whole-window opacity on compatible Electron platforms.

Tasks:

- Add runtime-schema-backed `DesktopWindowOpacityPreference` and `DesktopWindowOpacityState` contracts with bounded opacity and stable nullable reasons: `unsupported-platform`, `release-not-validated`, `apply-failed`, `persistence-failed`, and `safe-reset-failed`.
- Add dedicated IPC channels and trusted-web-contents handlers.
- Add bounded `{ enabled, opacity }` to desktop-local `DesktopAppSettings` with backward-compatible defaults and atomic persistence.
- Validate finite range in both renderer contract and main process.
- Compute support from an injectable `DesktopEnvironment.platform` intersected with the release-native-opacity platform manifest; call `BrowserWindow.setOpacity` only for allowlisted `win32`/`darwin`. Return `release-not-validated` when Electron supports the platform but the artifact is not approved.
- Serialize get, set, and pre-reveal application with one mutex, and apply persisted opacity before showing each newly created window. Theme sync never writes it.
- On set, capture previous settings and their effective value (`enabled ? opacity : 1`), apply the proposal to all registered live windows, then persist only after all applies succeed.
- If any window apply fails, best-effort reset every live window to 1.00 and persist safe `{ enabled: false, opacity: 1 }`. If persistence after a successful apply fails, roll every window back to the previous effective value while preserving the remembered preference pair. A failed rollback/reset returns `effectiveOpacity: null` with `safe-reset-failed` rather than claiming agreement.
- Keep the browser UI fully opaque and capability-gated.
- Add the Appearance control now that a real capability query exists, plus reset/recovery and a legibility warning.
- Create the one-action Restore Appearance/Disable all coordinator. It disables backend ambient settings, clears current-document Local Media so playback/visualizer work stops, and disables desktop-local opacity while preserving saved ambient sources and choices. It reports backend and opacity results independently. If native media ships later, extend the coordinator to its PCM tap/worker with retryable teardown reporting.

Likely files:

- `packages/contracts/src/ipc.ts`
- `apps/desktop/src/settings/DesktopAppSettings.ts`
- `apps/desktop/src/settings/DesktopAppSettings.test.ts`
- desktop release capability manifest/schema and native-smoke evidence
- `apps/desktop/src/ipc/channels.ts`
- `apps/desktop/src/preload.ts`
- desktop IPC window methods/handlers and tests
- `apps/desktop/src/window/DesktopWindow.ts`
- `apps/desktop/src/window/DesktopWindow.test.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- bridge mocks in web browser tests

Tests:

- only trusted web contents can call the methods;
- `NaN`, infinities, strings, and out-of-range numbers are rejected;
- table-driven allowlisted `win32`/`darwin` capability is true and get/set return the authoritative bounded state;
- non-allowlisted Windows/macOS returns `release-not-validated`; injected Linux/browser returns `unsupported-platform`; both remain at 1.00 and never call the setter;
- the release manifest schema rejects Linux/unknown platforms, defaults empty, and links each enabled artifact/platform to recorded smoke evidence;
- old/missing desktop settings default opaque; corrupt opacity fields preserve unrelated desktop settings and recover to 1.00;
- a new window receives persisted opacity before reveal;
- settings UI hydrates persisted state and an `enabled: false` record applies 1.00;
- thrown setter, partial multi-window apply, settings persistence, rollback, and safe-reset failures produce the exact effective opacity and stable reason required by the contract;
- runtime decoding rejects malformed preferences/states and out-of-range opacity;
- a failed rollback/reset returns `effectiveOpacity: null` with `safe-reset-failed`;
- rollback from persisted `{ enabled: false, opacity: 0.70 }` restores effective 1.00 while retaining the remembered 0.70 slider;
- deterministic pre-reveal, multi-window apply, persist, rollback, and safe-reset tests cover the serialized lifecycle;
- each settings panel hydrates through `getWindowOpacityState()` and applies mutations through `setWindowOpacityPreference()`;
- serialized concurrent mutations cannot overwrite a later successful state;
- restart after every success/failure path rehydrates the expected state;
- theme changes do not overwrite opacity;
- coordinated reset disables persisted ambient features, clears Local Media so playback/visualizer work stops, and reports independent backend/opacity outcomes; any future native PCM tap/worker must join that coordinator;
- sandbox, context isolation, and Node integration remain unchanged.

Manual checks:

- Windows: change, restart, minimize/restore, fullscreen, multiple monitors;
- macOS: equivalent native pass is mandatory before `darwin` capability is advertised;
- Linux/X11 and Wayland: clear unsupported state and no visual regression;
- readability over light, dark, and high-contrast desktop backgrounds.

Exit gate:

- contract, desktop IPC, window, and settings tests pass;
- `yarn build:desktop` succeeds;
- a native smoke result exists for every platform whose capability is enabled in the release;
- Sol's slice is audited by Luna.

## Phase 7 — Integration, soak, and release audit

Goal: prove that every feature works together and disappears cleanly when off.

Tasks:

- Verify the one-action Disable all ambient features coordinator delivered in Phase 6.
- Verify layer order among atmosphere, media, scroll pill, dialogs, command palette, onboarding, and shutdown.
- Verify floating, cinema workspace, and native YouTube fullscreen remain distinct, with an unobstructed cinema player and stable playback across project/thread navigation.
- Verify native opacity composes predictably with effects and media.
- Run all combinations at boundaries, including both media slots and the plan/workflow panel.
- If Local Media passed its conditional ship gate, include its native process, file/network policy, overlay click modes, package obligations, crash recovery, and resource teardown in every applicable release audit.
- If the projectM visualizer passed its separate gate, include PCM privacy/redaction, callback/ring backpressure, worker/IPC isolation, photosensitivity limits, reduced-motion no-work behavior, bundled-preset licensing/security, crash/GPU-hang recovery, Disable All, and rollback in every applicable release audit.
- Run long-session and repeated-toggle resource tests.
- Verify shared settings update connected renderers without synchronizing playback, geometry, or native opacity.
- Review user copy, privacy disclosure, unsupported-platform text, and recovery documentation.
- Review logs/tests to ensure URLs, search terms, normalized video/playlist IDs, API keys, OAuth secrets/tokens/codes, playback events, upload filenames, image bytes, workflow payloads, prompts, local paths, PCM, FFT/spectrum values, analysis history, and visualizer frames are redacted.
- Audit every changed file by someone other than its author.
- Resolve and retest all findings.
- Run and record a rollback/re-enable drill for renderer gates, workflow contract compatibility, public discovery, in-flight OAuth, token refresh, media teardown, and native opacity safe recovery.

Required automated commands from repository root:

```bash
yarn fmt
yarn lint
yarn typecheck
yarn test
yarn workspace @cafecode/web test:browser
yarn build:desktop
yarn test:desktop-smoke
```

Run focused tests during development, but the full commands are the release gate. The CSP slice also requires explicit production browser/server and packaged Electron startup checks.

Cross-surface matrix:

| Dimension          | Cases                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Surface            | Electron, authenticated browser                                                                   |
| Platform           | Windows, macOS, Linux X11/Wayland                                                                 |
| Theme              | Light, dark, system, custom accent                                                                |
| Motion             | Normal, reduced motion, hidden, unfocused, background override                                    |
| Layout             | Sidebar states, plan/workflow panel, diff panel, zoom, narrow/wide, multi-monitor                 |
| Presentation       | Floating, cinema workspace, local-video background, native player fullscreen, return transitions  |
| Cinema rails       | Both open, left closed, right closed, both closed, protected-player fit failure                   |
| Atmosphere         | Off, snow, rain, Matrix; automatic/custom color; opacity/speed bounds                             |
| Ambient media      | None, GIF, YouTube, Spotify, Local Media, supported combinations, invalid/offline                 |
| YouTube source     | URL video, URL playlist, public search, public playlist, owned playlist                           |
| YouTube account    | Unconfigured, disconnected, connecting, connected, expired/revoked, disconnecting                 |
| OAuth topology     | Local desktop/local backend; browser/remote capability absent                                     |
| Position           | Both presets, collision case, custom edges/corners                                                |
| Size               | Small, medium, large, custom min/max                                                              |
| Local Media v1     | No selection, browser-supported audio/video, unsupported type/codec, replace, clear, document end |
| Local presentation | Floating presets/custom, Cinema fallback, video background, opacity/readability, teardown         |
| Local visualizer   | Off/on, play/pause, reduced motion, hidden/unfocused, bounded canvas/frame rate, teardown         |
| Native extension   | No-go/absent or approved libVLC/projectM matrix; local/network/preset security cases conditional  |
| Workflow           | No agents, parallel/nested agents, reconnect, reduced fidelity, duplicate/out-of-order lifecycle  |
| Opacity            | Off/1.00, minimum, intermediate, unsupported, partial failure/recovery                            |
| Lifecycle          | Startup, route/project/thread change, mode switch, disable, replace, minimize/restore, restart    |

Soak gate:

- 16-hour target run when release infrastructure permits, with a minimum one-hour pre-merge soak;
- no unbounded growth in memory, canvases, frames, listeners, timers, object URLs, or iframes;
- hidden/unfocused behavior matches settings;
- typing, scrolling, message streaming, token-to-screen timing, CPU, and memory remain within Phase 0 budgets.

Release gate:

- all required commands clean;
- all audit findings closed or explicitly accepted;
- no open critical/high security issue;
- a real native smoke result exists for every platform advertised as opacity-supported; keep a platform capability disabled until that evidence exists;
- rollback/re-enable drill results are recorded;
- canon and user-facing copy agree with actual capability;
- rollback is understood.

## Rollback strategy

Each feature is independently default-off and gated by persisted settings. If a regression escapes:

1. force the affected atmosphere/media/workflow renderer gate or search/OAuth backend gate off independently;
2. keep field/group-scoped settings recovery in the current writer; before a binary downgrade, back up the settings file because an older writer may discard unknown keys;
3. unmount/stop the canvas, iframe, image, and any conditionally shipped native media session immediately; stop its PCM tap/projectM worker before releasing texture/fence handles, discard ephemeral PCM/FFT/history, stop new search/stream work, close native file/network/process capabilities, bound/discard transient caches, and let already-counted upstream quota remain accounted rather than retrying;
4. invalidate in-flight PKCE state when account connection is gated off. Stop connect/refresh/playlist work but leave owner-only disconnect/revoke available. The shipped grant is per-owner-session memory only, so restart, expiry, disconnect, or shutdown removes its tokens; no refresh token is retained at rest;
5. retain a backward-compatible versioned workflow projection contract while older clients exist. Gate the Workflow UI when it cannot understand the snapshot version and clear the disabled derived projection;
6. keep the opacity bridge and recovery control available until every live window is confirmed at 1.00 and safe settings are confirmed persisted. If reset cannot be verified, abort bridge removal and use the safe-start/restart runbook;
7. retain security headers unless a tested replacement is deployed; and
8. revert the smallest vertical slice, not unrelated settings or chat behavior.

Uploaded ambient assets are private user content. Normal replace/remove follows reference-checked deletion and orphan-sweep policy; rollback MUST NOT bulk-delete stored assets without an explicit migration and retention decision.

## Pull request sequence

Prefer these reviewable pull requests:

1. contracts, defaults, settings shells, and geometry primitives;
2. atmosphere engine and root integration;
3. normalized workflow lifecycle contracts, adapters, and reconnect snapshot;
4. read-only Plan/Workflow observatory UI;
5. ambient image store/upload and preset image panel;
6. CSP/security headers, strict YouTube source parser, public search, and preset player;
7. desktop fixed-loopback OAuth with memory-only owner-session grants and owned-playlist picker;
8. YouTube Cinema workspace and stable player-session ownership;
9. custom drag/resize and accessibility;
10. browser-native session Local Media plus bounded blob-element visualizer; native/PCM/projectM feasibility, threat model, licensing, preset-security, and packaging decision record remain separately gated;
11. conditional Local Media and approved-PCM visualization implementation only after recorded go decisions;
12. Electron opacity capability, lifecycle sync, and Disable all coordination;
13. integration polish, soak evidence, and release notes.

Do not combine broad Electron, HTTP security, asset storage, native media, and drag/resize changes into one difficult-to-audit patch. A Local Media no-go omits pull request 11 and leaves the unsupported capability explicit.

## Completion ledger

This ledger records the current checkout rather than planned ownership. “Present” means implementation/tests exist in the checkout; it is not a claim that every phase exit criterion passed.

| Phase                         | Recorded implementation author(s)                          | Independent audit record                                                                         | Focused checks                                | Current status                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Baseline                    | Not yet recorded                                           | Not yet recorded                                                                                 | Not recorded                                  | Planned; baseline, decision, and release-evidence gates remain open.                                                                                                   |
| 1 Contracts/UI                | Multiple contributors; per-slice authors not recorded here | Not yet recorded                                                                                 | Present; run evidence not ledgered            | Implemented in checkout; independent audit and phase exit gate remain open.                                                                                            |
| 2 Atmosphere                  | Multiple contributors; per-slice authors not recorded here | Not yet recorded                                                                                 | Present; run evidence not ledgered            | Implemented in checkout; soak/manual/release gates remain open.                                                                                                        |
| 2A Workflow contract          | Multiple contributors; per-slice authors not recorded here | Not yet recorded                                                                                 | Present; run evidence not ledgered            | Implemented in checkout; independent audit and reconnect/security gates open.                                                                                          |
| 2B Workflow UI                | Multiple contributors; per-slice authors not recorded here | Not yet recorded                                                                                 | Present; run evidence not ledgered            | Implemented in checkout; accessibility/manual/performance gates open.                                                                                                  |
| 3 Ambient image               | Terra (ambient asset slice)                                | Luna remediation recorded; full independent audit not recorded                                   | Scoped server/web checks run                  | Implemented and gated; bounded grace-aged orphan sweep is present; full release evidence remains open.                                                                 |
| 4A YouTube/Spotify/CSP/search | Terra (server search); root (web search UI and CSP)        | Terra audited Spotify/contracts; Sol audited search, CSP, privacy                                | Scoped and full checks passed                 | Public discovery, official Spotify Embed policy, and restrictive production CSP are implemented and gated.                                                             |
| 4B YouTube account            | Luna (desktop account service); Terra (web integration)    | Root audited service concurrency/routes; Terra audited UI races, capability, reset, and privacy  | Service, route, client, browser checks passed | Desktop bare-loopback, owner-session in-memory playlist discovery is implemented and capability-gated; remote-web OAuth and at-rest tokens are unshipped.              |
| 4C YouTube Cinema             | Multiple contributors; per-slice authors not recorded here | Not yet recorded                                                                                 | Present; run evidence not ledgered            | Implemented in checkout; lifecycle/layout/manual gates remain open.                                                                                                    |
| 5A Custom layout              | Multiple contributors; per-slice authors not recorded here | Not yet recorded                                                                                 | Present; run evidence not ledgered            | Implemented in checkout; pointer/accessibility/manual gates remain open.                                                                                               |
| 5B Local media                | Terra (browser-native Local Media v1)                      | Sol cross-audited panel lifecycle/anchor/accessibility; Terra audited Spotify/contracts boundary | Focused store/visualizer checks run           | Session-only HTML Local Media, floating/custom/Cinema/background, and blob-only bounded visualizer are implemented. Native libVLC/projectM feasibility remains unmade. |
| 6 Native opacity              | Multiple contributors; per-slice authors not recorded here | Luna audited reset, rollback, and failure handling                                               | Scoped and full checks passed                 | Windows packaged native-smoke evidence is recorded; macOS/other artifacts remain fail-closed pending their own evidence.                                               |
| 7 Integration                 | Root                                                       | Sol, Terra, and Luna audited separate cross-author slices                                        | Full automated gate passed                    | Automated integration is clean; manual matrix, soak, and native release gates remain.                                                                                  |

### Automated integration evidence

On 2026-07-23, the implementation checkout passed:

- `corepack yarn fmt`
- `corepack yarn fmt:check`
- `corepack yarn lint`
- `corepack yarn typecheck`
- `$env:TZ='UTC'; Remove-Item Env:OPENSSL_CONF -ErrorAction SilentlyContinue; corepack yarn test`
- `corepack yarn workspace @cafecode/web test:browser`
- `corepack yarn build:desktop`
- `corepack yarn test:desktop-smoke`
- `corepack yarn test:native-window-opacity`
- `corepack yarn audit:repository`

The Windows opacity probe also completed 50 consecutive post-remediation stress runs across two independent auditors with no failures (`1.0 → 0.8 → 1.0` each time).

This evidence does not replace the remaining manual, soak, platform-artifact, security, licensing, or native dependency gates.
