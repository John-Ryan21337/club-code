# Cafe Code Ambient Experience Project Plan

Status: Proposed delivery plan

Canon: [ambient-experience-canon.md](./ambient-experience-canon.md)

Coordinator: Spark
Review roles: Sol, Terra, Luna

## Outcome

Deliver optional full-window snow/rain/Matrix effects, two ambient chat media panels, public YouTube search/playlists, optional connected-account playlists, configurable glow, custom placement/sizing, a live workflow/sub-agent view, and supported-platform native window opacity without weakening Cafe Code's security or long-session stability.

This plan intentionally delivers reviewable slices. Contract/scaffolding phases may merge only behind inactive feature gates; a user-visible feature may ship only when its renderer/server dependency and exit gate are clean.

## Working agreement

Each implementation slice has an author and a different auditor. Authors must not approve their own slice. The default rotation is:

| Slice                      | Primary | Independent audit |
| -------------------------- | ------- | ----------------- |
| Contracts and settings     | Luna    | Sol               |
| Atmosphere renderer        | Sol     | Terra             |
| Media security and storage | Terra   | Luna              |
| YouTube discovery/account  | Terra   | Sol               |
| Workflow normalization     | Luna    | Terra             |
| Workflow UI                | Spark   | Sol               |
| Chat media interaction     | Spark   | Sol               |
| Electron opacity           | Sol     | Luna              |
| Integration/release        | Spark   | Terra, then Luna  |

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
        +--> production CSP and policies --> YouTube parser/embed
        |                                      ^
        +--> backend Data API key --> public search/playlists
        +--> external-browser OAuth/PKCE --> private playlist picker
        |
        +--> pure media geometry --> preset panels --> custom drag/resize
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
- Register/verify both allowed Google OAuth application modes: local packaged Electron uses a Desktop-app client with a temporary random-port `127.0.0.1` listener; configured browser/remote deployments use a Web-app client with one fixed canonical HTTPS callback. Record the exact `https://www.googleapis.com/auth/youtube.readonly` scope, privacy policy, encrypted token storage, owner-only authorization, and that this does not authenticate Premium playback in the iframe.
- Inventory current release-readiness CSP work and every required source: inline boot code, Google Fonts, data/blob previews, workers/service worker, remote HTTP/WebSocket environments, Vite/HMR, browser production, and packaged Electron.
- Inventory Codex/Claude normalized activity fields, provider fidelity, redaction guarantees, reconnect history, and maximum workflow graph/event sizes.
- Confirm the canon's 12-pixel same-corner stack, aspect-ratio, 640-pixel hide, and 768-pixel custom-control rules against product mockups.
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
- Add atomic `YouTubeSource` (`video | playlist | null`) with strict IDs and default `null`.
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
- a corrupt ambient field/group preserves unrelated valid settings and emits a normalized warning;
- bounds, enum values, `"auto"`/hex colors, asset IDs, and malformed RPC patches are rejected atomically;
- patch-key parity test remains clean;
- flat-key control changes preserve sibling values and do not snap back during server reconciliation;
- controls persist exact normalized values and automatic color follows theme/effect changes;
- reset restores every ambient setting;
- local geometry migration clamps or resets corrupt data;
- `null` -> video/playlist -> replacement/reset source transitions are atomic;
- the complete canonical default/bounds vector round-trips, including `enabled: true` plus null source/asset as an effective empty state with no work;
- first/remote entry into custom mode seeds missing local geometry from the resolved preset; narrow/coarse fallback never mutates shared mode or erases geometry.

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

- Define runtime-schema-backed workflow node/lifecycle/snapshot contracts with stable IDs, parent/path correlation, canonical statuses, timestamps, safe summaries, and `live | lifecycle-only | not-reported` fidelity.
- Scope every snapshot/event by environment, configured provider instance, provider-process epoch, thread, and turn. Rotate the epoch on runtime restart even when the configured instance ID stays constant. Snapshots separately add revision/watermark, pagination cursors bind to that immutable revision, and live events carry the post-watermark monotonic sequence/cursor. Node IDs are stable only inside the scope key.
- Normalize Codex `subAgentActivity`/`collab_agent_tool_call` and Claude task/sub-agent progress without inventing fields.
- Preserve arbitrary-depth agent paths and correlation to turn/tool activity where providers expose it.
- Project persisted current-turn activities into an immutable reconnect snapshot with a captured watermark, paginated from that snapshot while live events are buffered/subscribed from the watermark.
- Build a pure bounded reducer that atomically swaps scope, rejects late out-of-scope revisions, is idempotent under duplicate events, and applies documented monotonic lifecycle precedence. Terminal state beats stale start/progress within an epoch; a new provider-instance epoch may reuse IDs.
- Keep raw provider payloads, hidden reasoning, secrets, and unredacted prompts outside the contract.
- Version the normalized snapshot/event contract and expose capability/version plus updates through the existing orchestration environment boundary. Keep older server fields readable during the supported mixed-version window.

Likely files:

- `packages/contracts/src/orchestration.ts` and tests
- `packages/contracts/src/providerRuntime.ts` if canonical lifecycle types need extension
- `apps/server/src/provider/Layers/CodexAdapter.ts` and tests
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` and tests
- orchestration event persistence/snapshot services and tests
- new `apps/web/src/workflowProjection.ts` and tests

Tests:

- Codex hierarchy/start/interact/interrupt/terminal mapping;
- Claude lifecycle-only/progress mapping;
- unsupported provider fidelity and honest empty state;
- duplicate, out-of-order, missing-parent, missing-terminal, reconnect, retry, and provider-restart sequences;
- repeated IDs across turns/environments and across two process epochs with the same configured provider instance, thread switches, events during paginated snapshot, stale snapshot after live, terminal-before-start, and snapshot-plus-buffered-live handoff;
- arbitrary-depth paths remain bounded and cycle-free;
- status is never inferred from elapsed silence alone;
- redaction fixtures prove raw reasoning/secrets/prompts do not cross the normalized contract;
- node/event caps and snapshot pagination prevent unbounded state.
- compatible old/new client-server contract pairs negotiate the advertised version; unsupported versions fail to an honest unavailable state rather than partially decoding.

Exit gate:

- contract, adapter, orchestration, and reducer tests pass;
- sanitized snapshots reconstruct the current turn after reconnect;
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
- Add an operator/runtime Workflow UI gate independent of Client Settings. When disabled or contract-incompatible, stop subscriptions, clear the projection, and leave Plan available.

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
- Allow only the privacy-enhanced YouTube frame origin in renderer CSP; keep Data API and thumbnail access behind fixed backend outbound allowlists.
- Define production and development directives for scripts/styles/fonts/images/media/workers/connections/frames and externalize or nonce/hash inline boot content.
- Preserve tested saved remote HTTP/WebSocket environments without broadening `frame-src`.
- Implement a pure strict URL parser that produces the atomic `YouTubeSource` union for canonical video and playlist URLs, with the canon's exact 11-character video and 10–80-character playlist schemas.
- Persist only the normalized source kind and ID; never persist pasted URLs, search terms, or result payloads.
- Build fixed privacy-enhanced video and playlist embed URLs with a safe parameter allowlist.
- Render a lazy, sandboxed iframe with narrow permissions and a viewport that meets YouTube's minimum player dimensions.
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
- exact iframe title, sandbox, referrer policy, lazy loading, feature policy, and minimum dimensions are asserted;
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

- Implement owner-only Google OAuth Authorization Code with S256 PKCE using the external system browser and exactly the canon's two configured deployment modes. Local packaged Electron plus local backend uses a Desktop-app client and temporary random-port `127.0.0.1` listener; remote/backend browser use requires a Web-app client and one fixed pre-registered canonical HTTPS callback. All other topologies disable connection.
- Let the renderer request only a backend-created authorization transaction. Permit external opening/user navigation only to `https://accounts.google.com/o/oauth2/v2/auth`; never accept a renderer-supplied redirect or authorization URL.
- Validate configured HTTPS origin/path and trusted-proxy rules at startup. Bind the loopback listener only to `127.0.0.1`, close it after one response/timeout, and handle port-allocation failure without fallback to a broad interface.
- Use high-entropy, single-use, expiring `state` and PKCE verifier records; bind callbacks to the initiating Cafe Code owner/session and reject replay.
- Request exactly `https://www.googleapis.com/auth/youtube.readonly` and forbid additional scopes in version 1. Complete Google consent-screen, verification, privacy-policy, and data-handling work before production release.
- Exclude the callback from raw-query access logging. Send no-store/no-referrer headers, consume state atomically, exchange the code server-side, and `303` every outcome to a fixed query-free completion page. Expose only opaque transaction status to the initiating authenticated owner session.
- Keep access/refresh tokens and OAuth client secrets in the backend secret store with an authenticated-encryption key outside that store. Never place them in Client Settings, renderer storage, URLs, logs, or workflow events.
- Add an operator/runtime account-connection gate and capability response. Disabling it blocks new authorization, invalidates in-flight state/listeners, and stops refresh/playlist work while retaining encrypted tokens; owner-only disconnect/revoke/delete remains available even while gated off.
- Serialize token refresh, handle revocation/expiry, and provide explicit disconnect plus best-effort Google token revocation and local deletion.
- Fetch the authorized user's playlists with the supported owned-playlist endpoint, then fetch bounded playlist items on demand. Keep private playlist metadata owner-only, permit in-app selection only when the supported embed can play the source, and route private/non-embeddable items to signed-in YouTube. Explain unavailable/special collections rather than fabricating them.
- Label the action `Connect YouTube account`, not `Sign in to YouTube Premium`.
- Treat account connection as playlist discovery only. Add `Open in signed-in YouTube` for playback that must inherit browser-account/Premium behavior.
- Preserve public search and URL entry when no account is connected.

Likely files:

- contract runtime schemas for connection state, playlist summaries, and owner-only RPC/HTTP responses
- server OAuth state/PKCE service, encrypted token store adapter, refresh coordinator, YouTube playlist service, routes, and tests
- server deployment configuration and operator documentation
- web connection status, playlist picker, disconnect action, and browser tests
- existing Electron external-browser helper/allowlist, without an embedded-login window

Tests:

- non-owner and unauthenticated callers cannot start, complete, inspect, or disconnect a connection;
- state mismatch, expired state, redirect replay, wrong initiator, missing PKCE verifier, denied consent, and malformed callback fail closed;
- generated authorization requests use only the fixed Google authorization endpoint, S256, the exact read-only scope, and the one configured redirect; additional scopes and renderer-provided URLs/redirects are rejected;
- local/remote topology detection, wrong Host/forwarded proto, untrusted proxy, redirect mismatch, loopback port collision, listener timeout/cleanup, and remote-client use of local loopback fail safely;
- callback query/code/state never enter access/trace logs, diagnostics, error pages, redirect `Location`, referrers, renderer state, Client Settings, or workflow activity, including malformed and upstream-exchange failures;
- concurrent requests cause one serialized refresh; expiry, revoked grants, upstream timeout, partial response, and disconnect-during-refresh recover consistently;
- disconnect revokes best-effort, deletes local tokens, clears connection state, and leaves public search/URL entry usable;
- account-gate disable invalidates in-flight transactions/listeners, blocks connect/refresh/list work, retains encrypted tokens, and still permits owner-only disconnect/revoke/delete; re-enable refreshes from a clean transaction;
- owned playlists and items are owner-authorized, bounded/paginated, schema-validated, and sanitized without altering YouTube attribution;
- private/non-embeddable playlists never leak to other Cafe Code sessions or claim in-app playability and instead use the external signed-in action;
- unavailable special/private collections show honest empty/error states;
- absent OAuth configuration produces a disabled control with operator guidance;
- no flow claims to authenticate the iframe or guarantee Premium benefits.

Manual checks:

- external-browser consent returns to the initiating session without opening an embedded Google login;
- connect, refresh/restart, select playlist, disconnect, and reconnect work;
- `Open in signed-in YouTube` uses the user's normal browser session;
- public search remains usable without connecting an account.

Exit gate:

- OAuth, token-store, authorization, playlist, browser, and redaction tests pass;
- threat-model and Google-policy reviews are recorded;
- Terra's slice is audited by Sol.

## Phase 5 — Custom drag, resize, and accessibility

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
- Fall back to the resolved preset safely on narrow/coarse-pointer layouts without mutating shared `layoutMode` or erasing local custom geometry.
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
- 640-pixel hiding and 768-pixel fine-pointer custom fallback preserve geometry and do not auto-resume YouTube.

Exit gate:

- pointer, keyboard, responsive, and cleanup tests pass;
- a screen-reader/keyboard manual pass is recorded;
- Spark's slice is audited by Sol.

## Phase 6 — Native whole-window opacity

Goal: support bounded whole-window opacity on compatible Electron platforms.

Tasks:

- Add a runtime-schema-refined discriminated `WindowOpacityState`, stable `WindowOpacityReasonCode`, and typed get/set/reset plus state-change subscription bridge methods. State carries a monotonic revision and only valid unsupported/ready/recovered/degraded combinations of capability, confirmed/unknown persistence, consistent/mixed-or-unknown live opacity, and reason.
- Add dedicated IPC channels and trusted-web-contents handlers.
- Add bounded `{ enabled, opacity }` to desktop-local `DesktopAppSettings` with backward-compatible defaults and atomic persistence.
- Validate finite range in both renderer contract and main process.
- Compute support from an injectable `DesktopEnvironment.platform` intersected with the release-native-opacity platform manifest; call `BrowserWindow.setOpacity` only for allowlisted `win32`/`darwin`. Return `release-not-validated` when Electron supports the platform but the artifact is not approved.
- Put mutation and main-window registration/reveal under one serialized transaction/revision boundary. A window cannot reveal mid-mutation; closing windows are removed safely; reconcile the final registry before returning success.
- Load and apply opacity before showing each newly created window. Make state subscription atomically register and immediately emit the current snapshot so hydration cannot miss a mutation; keep `getWindowOpacityState()` for diagnostics/retry. Broadcast every committed or degraded transition and ignore stale revisions. Theme sync never writes it.
- On set/reset, capture previous confirmed settings and their effective value (`enabled ? opacity : 1`), apply the proposal to all registered live windows, then persist only after all applies succeed.
- If any window apply fails, best-effort reset every currently registered window to 1.00 and persist safe `{ enabled: false, opacity: 1 }`. If persistence after a successful apply fails, roll every window back to the previous effective value while preserving the remembered preference pair. Rollback/reset/recovery-persistence failure returns mixed-or-unknown/unknown state and a stable degraded reason rather than claiming agreement.
- Keep the browser UI fully opaque and capability-gated.
- Add the Appearance control now that a real capability query exists, plus reset/recovery and a legibility warning.
- Create the one-action Restore Appearance/Disable all coordinator here. It resets backend ambient settings and desktop-local opacity, reports each result independently, and offers retry for any partial failure.

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
- table-driven allowlisted `win32`/`darwin` capability is true and get/set/reset return the authoritative bounded state;
- non-allowlisted Windows/macOS returns `release-not-validated`; injected Linux/browser returns `unsupported-platform`; both remain at 1.00 and never call the setter;
- the release manifest schema rejects Linux/unknown platforms, defaults empty, and links each enabled artifact/platform to recorded smoke evidence;
- old/missing desktop settings default opaque; corrupt opacity fields preserve unrelated desktop settings and recover to 1.00;
- a new window receives persisted opacity before reveal;
- settings UI hydrates persisted state and an `enabled: false` record applies 1.00;
- thrown setter, partial multi-window apply, settings persistence, rollback, safe-reset, and recovery-persistence failures produce the exact confirmed/unknown persistence, consistent/mixed live state, and typed reason required by the contract;
- runtime decoding rejects every invalid capability/status/persistence/live/reason combination and any ready/recovered opacity that differs from the confirmed effective value;
- safe-settings persistence may be confirmed while a partial reset yields degraded mixed live state with `safe-reset-failed`;
- rollback from persisted `{ enabled: false, opacity: 0.70 }` restores effective 1.00 while retaining the remembered 0.70 slider;
- deterministic create/close-during-apply, persist, rollback, and reset tests prove no window reveals or remains on a stale revision;
- two open settings panels receive success, reset, rollback, and degraded broadcasts and ignore stale revisions;
- mutation during initial subscription/hydration cannot be missed because registration emits an atomic current snapshot;
- serialized concurrent mutations cannot overwrite a later successful state;
- restart after every success/failure path rehydrates the expected state;
- theme changes do not overwrite opacity;
- coordinated reset reports/retries a partial backend/local failure;
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
- Verify native opacity composes predictably with effects and media.
- Run all combinations at boundaries, including both media slots and the plan/workflow panel.
- Run long-session and repeated-toggle resource tests.
- Verify shared settings update connected renderers without synchronizing playback, geometry, or native opacity.
- Review user copy, privacy disclosure, unsupported-platform text, and recovery documentation.
- Review logs/tests to ensure URLs, search terms, normalized video/playlist IDs, API keys, OAuth secrets/tokens/codes, playback events, upload filenames, image bytes, workflow payloads, prompts, and local paths are redacted.
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

| Dimension       | Cases                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Surface         | Electron, authenticated browser                                                                  |
| Platform        | Windows, macOS, Linux X11/Wayland                                                                |
| Theme           | Light, dark, system, custom accent                                                               |
| Motion          | Normal, reduced motion, hidden, unfocused, background override                                   |
| Layout          | Sidebar states, plan/workflow panel, diff panel, zoom, narrow/wide, multi-monitor                |
| Atmosphere      | Off, snow, rain, Matrix; automatic/custom color; opacity/speed bounds                            |
| Ambient media   | None, GIF only, YouTube only, both, invalid/offline                                              |
| YouTube source  | URL video, URL playlist, public search, public playlist, owned playlist                          |
| YouTube account | Unconfigured, disconnected, connecting, connected, expired/revoked, disconnecting                |
| OAuth topology  | Local desktop/local backend, configured canonical HTTPS remote, unsupported topology             |
| Position        | Both presets, collision case, custom edges/corners                                               |
| Size            | Small, medium, large, custom min/max                                                             |
| Workflow        | No agents, parallel/nested agents, reconnect, reduced fidelity, duplicate/out-of-order lifecycle |
| Opacity         | Off/1.00, minimum, intermediate, unsupported, partial failure/recovery                           |
| Lifecycle       | Startup, route/thread change, disable, replace, minimize/restore, restart                        |

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
3. unmount/stop the canvas, iframe, and image immediately; stop new search work, bound/discard transient caches, and let already-counted upstream quota remain accounted rather than retrying;
4. invalidate in-flight PKCE state and close loopback listeners when account connection is gated off. Stop connect/refresh/playlist work but leave owner-only disconnect/revoke/delete available. Retain existing encrypted tokens for a reversible temporary rollback; only an explicit disconnect or security-incident runbook revokes/deletes them;
5. retain a backward-compatible workflow snapshot/event contract while older clients exist. Gate the Workflow UI when it cannot understand the advertised contract version; reject late events from the disabled projection;
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
7. external-browser OAuth/token storage and owned-playlist picker;
8. custom drag/resize and accessibility;
9. Electron opacity capability, lifecycle sync, and Disable all coordination;
10. integration polish, soak evidence, and release notes.

Do not combine broad Electron, HTTP security, asset storage, and drag/resize changes into one difficult-to-audit patch.

## Completion ledger

Update this table during implementation.

| Phase                 | Author | Auditor      | Tests clean | Findings closed | Status  |
| --------------------- | ------ | ------------ | ----------- | --------------- | ------- |
| 0 Baseline            | Spark  | Sol          | —           | —               | Planned |
| 1 Contracts/UI        | Luna   | Sol          | No          | No              | Planned |
| 2 Atmosphere          | Sol    | Terra        | No          | No              | Planned |
| 2A Workflow contract  | Luna   | Terra        | No          | No              | Planned |
| 2B Workflow UI        | Spark  | Sol          | No          | No              | Planned |
| 3 Ambient image       | Terra  | Luna         | No          | No              | Planned |
| 4A YouTube/CSP/search | Terra  | Luna         | No          | No              | Planned |
| 4B YouTube account    | Terra  | Sol          | No          | No              | Planned |
| 5 Custom layout       | Spark  | Sol          | No          | No              | Planned |
| 6 Native opacity      | Sol    | Luna         | No          | No              | Planned |
| 7 Integration         | Spark  | Terra + Luna | No          | No              | Planned |
