# Cafe Code Ambient Experience Canon

Status: Proposed implementation canon

Owner: Spark (integration)

Reviewers: Sol (effects and desktop), Terra (media and security), Luna (contracts, delivery, and QA)
Repository baseline: `dev` at `aea47f3a` (2026-07-22)

## Purpose

This document is the product and engineering source of truth for Cafe Code's optional ambient presentation features:

1. full-window snow, rain, or falling Matrix-style characters;
2. an optional YouTube player inside the chat area;
3. an optional uploaded ambient GIF/image inside the chat area;
4. public YouTube search, public playlist selection, and optional YouTube account linking for owned-playlist discovery;
5. optional glow around either media panel; and
6. optional whole-window opacity in the Electron desktop app; and
7. a live Workflow Observatory for plans, tool activity, and launched sub-agents; and
8. a conditional projectM visualizer for approved Local Media audio sources.

Every feature is off by default. These features decorate Cafe Code; they must never weaken chat reliability, security, legibility, accessibility, or long-session performance.

Normative terms `MUST`, `SHOULD`, and `MAY` have their usual requirements meaning.

## Product model

The visual experience is five independent systems:

| System                         | Scope                                                       | Surfaces                          | Default                 |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------- | ----------------------- |
| Window atmosphere              | Entire Cafe Code viewport, including sidebar and title area | Browser and Electron              | Off                     |
| Chat media                     | Floating in the message pane or optional cinema workspace   | Browser and Electron              | Off                     |
| Conditional Local Media/visual | Approved native playback and projectM output                | Approved Electron platforms only  | Unavailable/off         |
| Window opacity                 | Entire native window, including text, media, and controls   | Supported Electron platforms only | 100% opaque             |
| Workflow Observatory           | Current thread/turn workflow and provider-reported agents   | Browser and Electron              | Available, panel closed |

Turning one system on MUST NOT silently enable another. A single "Disable all ambient features" action MUST turn off the atmosphere, both media panels, their glow, any conditionally shipped Local Media playback/visualizer, its PCM tap/native worker, and native opacity without deleting the user's saved sources or choices. This action coordinates a backend Client Settings update with desktop-local native-media and opacity updates; each result is reported independently, successful changes are preserved, native resource teardown is retried after a partial failure, and the action remains available until every requested system is confirmed off.

The Workflow Observatory is operational UI, not an ambient effect. "Disable all ambient features" does not close it or discard workflow data.

Ambient state is presentation state. It MUST NOT be written into a thread, prompt, message, project, activity log, or model context.

Atmosphere/chat-media switches, sources, video presentation, colors, presets, and glow are shared backend-authoritative preferences and therefore update every connected authenticated renderer. Playback state, cinema rail state, custom geometry, native opacity, and every conditional Local Media/visualizer preference are per-device.

## User-facing behavior

### Window atmosphere

The Appearance settings panel MUST provide:

- a Window atmosphere switch;
- one radio group with `Snow`, `Rain`, and `Matrix`;
- color;
- effect transparency;
- speed; and
- a reset-to-default action.

The switch is the off control. Turning it off preserves the last selected type, color, transparency, and speed. The radio group is available only while the switch is on.

The persisted numeric value is `opacity`, even if the interface says "Transparency". The UI MUST make the direction unambiguous: 0% opacity is invisible and 100% opacity is solid.

Recommended bounds and defaults:

| Setting          | Bounds                               | Default  |
| ---------------- | ------------------------------------ | -------- |
| Enabled          | Boolean                              | `false`  |
| Type             | `snow`, `rain`, `matrix`             | `snow`   |
| Color            | `"auto"` or valid `#RRGGBB` sRGB hex | `"auto"` |
| Opacity          | 0.05–1.00                            | 0.35     |
| Speed multiplier | 0.25–4.00                            | 1.00     |

The effect MUST cover the viewport but MUST NOT intercept pointer, keyboard, drag-region, or screen-reader interaction. It MUST be clipped to the app window and must not create scrollbars.

The three modes have stable meanings:

- Snow: softly drifting flakes with bounded horizontal sway.
- Rain: downward streaks with bounded length and density.
- Matrix: columns of printable characters with a brighter leading character. Characters are decorative and not selectable.

`"auto"` resolves at render time to a conservative per-effect, per-theme color and updates when the theme changes. An explicit color applies to the particles/characters. Implementations MAY derive limited shade variation from it and add a bounded outline/shadow. Cafe Code guarantees readable defaults and an accurate preview; contrast for a user-selected color over mixed app/video content is best-effort.

### Chat media

Cafe Code supports two independent media slots that may be visible together:

1. one YouTube video slot; and
2. one uploaded ambient image slot, with animated GIF as the primary use case.

Each slot MUST provide:

- an enable/disable switch;
- a source control;
- floating layout mode: `Preset` or `Custom`;
- preset placement: `Bottom left` or `Bottom right`;
- preset size: `Small`, `Medium`, or `Large`;
- ambient glow on/off;
- glow color and glow intensity;
- close/disable from the panel itself; and
- reset placement/size.

The YouTube source control also provides URL paste, public search, public playlist selection, optional account connection, and connected-account playlist discovery. An owned playlist is selectable for in-app playback only when the supported embed can play it; otherwise the picker provides the external signed-in YouTube action.

Canonical persisted defaults and bounds are:

| Field                          | Default        | Bounds/meaning                         |
| ------------------------------ | -------------- | -------------------------------------- |
| `ambientVideoEnabled`          | `false`        | Boolean                                |
| `ambientVideoSource`           | `null`         | Valid atomic `YouTubeSource` or `null` |
| `ambientVideoPresentationMode` | `floating`     | `floating` or `cinema`                 |
| `ambientVideoLayoutMode`       | `preset`       | `preset` or `custom`                   |
| `ambientVideoPresetPlacement`  | `bottom-right` | `bottom-left` or `bottom-right`        |
| `ambientVideoPresetSize`       | `medium`       | `small`, `medium`, or `large`          |
| `ambientVideoGlowEnabled`      | `false`        | Boolean                                |
| `ambientVideoGlowColor`        | `auto`         | `"auto"` or valid `#RRGGBB` sRGB hex   |
| `ambientVideoGlowOpacity`      | `0.35`         | 0.05–1.00                              |
| `ambientImageEnabled`          | `false`        | Boolean                                |
| `ambientImageAsset`            | `null`         | Valid `AmbientImageAsset` or `null`    |
| `ambientImageLayoutMode`       | `preset`       | `preset` or `custom`                   |
| `ambientImagePresetPlacement`  | `bottom-left`  | `bottom-left` or `bottom-right`        |
| `ambientImagePresetSize`       | `medium`       | `small`, `medium`, or `large`          |
| `ambientImageGlowEnabled`      | `false`        | Boolean                                |
| `ambientImageGlowColor`        | `auto`         | `"auto"` or valid `#RRGGBB` sRGB hex   |
| `ambientImageGlowOpacity`      | `0.35`         | 0.05–1.00                              |

An enabled slot with a `null` source/asset is an effective empty state: it renders no panel, network, decode, or animation work and prompts for a source. It is not persisted as corrupt and becomes active automatically after a valid source is selected.

The default positions are opposite corners. If both panels use the same preset corner, they stack vertically inward from that corner with a 12 CSS-pixel gap: video is nearest the bottom edge and image is above it. Both are re-clamped. If they do not fit, both step down through the preset sizes together; the narrow-layout rule applies if `small` still does not fit. Custom panels may overlap by explicit user choice.

Preset sizes MUST be comfortable but subordinate to the conversation. The 16:9 video widths are 360, 480, and 640 CSS pixels, clamped without taking the embedded viewport below YouTube's 200-by-200 minimum. Ambient images preserve their intrinsic aspect ratio within equivalent bounding boxes.

Custom mode MUST support mouse or precise-pointer drag and resize. Video remains 16:9 and large enough for YouTube's minimum viewport; an image remains locked to its validated intrinsic aspect ratio. Dragging occurs from an explicit handle, never from the iframe body. Resizing occurs from an explicit corner handle and changes width while deriving height. Pointer movement MUST use pointer capture and animation-frame batching; settings persistence happens at interaction termination, not on every move.

Custom geometry is stored as normalized `x`, `y`, and `width` fractions of the message-pane bounds; height is derived from the media aspect ratio. Geometry MUST be clamped after window, sidebar, plan-panel, zoom, or display changes so a panel and its controls cannot become unreachable. Pointer-up, pointer-cancel, lost capture, and window blur commit the most recent animation-frame-applied clamped geometry; unmount only cleans runtime resources.

First entry into custom mode seeds local normalized geometry from the currently resolved preset. A renderer that receives shared custom mode without valid local geometry does the same. Narrow/coarse-pointer fallback never changes the shared layout mode or erases local custom geometry.

Keyboard users MUST be able to move, resize, reset, close, and disable each panel. On small or coarse-pointer layouts, Cafe Code SHOULD use clamped preset placement and MUST NOT expose an unusable drag-only interface.

In floating presentation, media panels live over the messages pane, not over the sidebar, header, composer, branch toolbar, plan panel, dialogs, or toasts. They MUST NOT enter the virtualized message list.

### Video presentation modes

The YouTube slot has three distinct presentation states:

1. `Floating` is the default Cafe Code presentation. It uses the existing preset/custom placement, size, glow, and geometry contract above.
2. `Cinema workspace` is an in-app workspace layout with the existing project sidebar on the left, an unobstructed YouTube player in the center, and a chat rail on the right.
3. Native YouTube fullscreen is player-owned fullscreen entered through the embedded player's controls and the platform Fullscreen API. It is not a Cafe Code layout mode and MUST NOT be simulated by stretching the iframe across Cafe Code.

The Cafe Code presentation choice is shared Client Settings state in `ambientVideoPresentationMode`, with `floating` as its backward-compatible default and `cinema` as its other valid value. A renderer applies shared presentation updates without synchronizing active playback or remounting an unchanged source. Native fullscreen and each rail's collapsed/expanded state are transient per-device UI state. Native fullscreen returns to whichever shared in-app presentation was active before it.

Shared presentation is intent, not proof that a renderer can currently construct cinema. A renderer's effective cinema state is:

```text
ambientVideoPresentationMode == cinema
AND ambientVideoEnabled
AND ambientVideoSource != null
AND local player renderer ready
AND local protected-player layout fits
```

If any term is false, the renderer keeps the normal chat layout (and a floating player only when that player is otherwise locally renderable), reports the local reason, and leaves the shared `cinema` preference unchanged. A missing source, blocked/unavailable player, startup hydration, or responsive fit failure MUST NOT create a blank center region. When the local condition recovers, the renderer may realize the still-current shared cinema preference without another settings write.

Cinema workspace has the following canonical behavior:

- The center player preserves a 16:9 viewport and remains the primary surface. Cafe-owned atmosphere, glow, media, chat controls, popovers, toasts, dialogs, onboarding, and shutdown visuals MUST NOT paint over or intersect the iframe rectangle. YouTube's own iframe controls remain available.
- The existing project sidebar and the right chat rail collapse and expand independently. Collapsing either gives its space to the center player; neither action changes the other rail's state.
- The chat rail keeps the active conversation's header, timeline, branch affordances, and composer usable. It is a layout region, not an overlay over the player. Plan/Workflow chooses inline versus the existing sheet behavior from the measured chat-rail width, not the whole window width, and MUST NOT add a fourth pane beside the player.
- Entering cinema preserves the last floating preset/custom mode and normalized custom geometry without rewriting them. Exiting cinema restores that floating mode and its resolved geometry.
- Project and thread switches update the surrounding rails without remounting or replacing the active player. Playback and the selected source continue across those switches. Disabling the video slot or replacing its source still stops and unmounts the old player.
- The player/session owner and stable iframe host therefore live above route-, project-, and thread-specific chat content and are keyed by the selected YouTube source, not by navigation identity. `ChatView` only registers the measured floating anchor/portal target used for placement; it never owns or reparents the iframe.
- Ambient-image suppression is render-only. Effective cinema does not capture, restore, or patch `ambientImageEnabled`, `ambientImageAsset`, or any image geometry. The image panel is simply not rendered while cinema is locally effective. On exit or local suspension, the renderer reads the current authoritative shared image setting and current local geometry, so changes from another renderer made during cinema take effect normally. The image MUST NOT be placed over the cinema player.
- Opening Diff either uses the existing sheet constrained away from the protected player or locally suspends effective cinema and shows the normal chat/diff layout while the stable player session survives. It never creates a fourth competing pane and never patches the shared presentation preference.

On entry and every resize, cinema collapses rails before reducing the player. The player MUST remain 16:9 and satisfy YouTube's 200-by-200 minimum embedded viewport, which requires at least a 356-by-200 CSS-pixel 16:9 rectangle after rounding. When the app cannot fit that player plus reachable controls and safe-area insets, cinema is locally suspended in favor of the normal/floating-safe layout with a clear status; it MUST NOT render an undersized or covered iframe or patch the shared `cinema` preference.

Cinema controls require accessible names, visible state, and keyboard operation. Entering cinema records the invoking focus and moves focus to a stable cinema heading or the titled iframe; exiting restores focus when that target still exists. Each rail has a keyboard-operable toggle whose expanded state is exposed semantically. Cinema itself is not a focus trap. `Escape` exits Cafe Code cinema only when native fullscreen is not active and the iframe has not consumed the key; native fullscreen exit remains player/platform-owned.

### Local Media Theater (conditional extension)

A future, separately gated `Local Media` theater MAY use native libVLC integration to play approved local files, direct network streams, and local playlists. It is distinct from YouTube Cinema and MUST NOT be presented as a way to bypass YouTube's iframe, account, Premium, or content restrictions. Product copy SHOULD use `Local Media` or `Local Media (libVLC)` unless a branding review approves use of VLC marks.

This extension is not committed until a native feasibility, licensing, packaging, update, crash-isolation, and security spike passes. Browser VLC plugins are unavailable and are not an architecture option. The spike MUST establish supported desktop platforms and architectures, binary size/update behavior, Electron/native-process boundaries, installer and code-signing effects, LGPL notice and corresponding-source/relinking obligations, and an explicit tested codec/container/protocol matrix. It MUST compare three materially different video-output architectures:

1. a native drawable/child surface, which can be efficient but is composed by the operating system and cannot promise DOM interleaving, clipping, opacity, or a true chat/project overlay;
2. libVLC CPU video callbacks copied into renderer-owned canvas/WebGL textures, which can compose with the DOM but must prove copy, memory-bandwidth, latency, color, and long-session costs; and
3. LibVLC 4 GPU/texture output callbacks, which may permit lower-copy DOM composition but must prove API maturity, cross-platform graphics interop, synchronization, device-loss recovery, packaging, and supportability.

Cafe Code MUST NOT promise every codec, every network service, DRM playback, YouTube search/account parity, or extraction of playable URLs from websites. A true DOM background/overlay is available only if a renderer-owned CPU- or GPU-texture route passes the recorded composition and performance gates. Choosing a native drawable limits the feature to a dedicated theater region and user-facing copy MUST NOT claim a DOM overlay.

If approved, Local Media Theater may offer:

- local files selected through a native file picker;
- local playlists containing individually validated entries;
- direct network streams whose schemes and destinations pass a narrow allowlist and native-boundary request-safety policy; and
- a project/chat background or overlay presentation only when the approved renderer-owned texture architecture proves that composition.

The overlay presentation remains optional and default-off. It MUST provide a readable-content treatment, bounded opacity, a visible on/off status, and an explicit interaction mode. In `Pass through` mode, chat/project controls receive pointer input and media controls remain available through a keyboard command or dedicated non-overlapping control. In `Interact` mode, the media surface may receive pointer input, but the mode and escape path remain visible and keyboard operable. No invisible overlay may capture input.

Local files are opened only after explicit user selection and with the narrowest practical path capability; paths are not synchronized, logged, or exposed to browser clients. Playlist entries are revalidated when opened. Direct streams reject credentials in URLs, unsupported schemes, redirects outside policy, loopback/link-local/private destinations unless an explicit local-network policy allows them, and unsafe DNS rebinding. Network work has bounded redirects, timeouts, response size/buffering, and retry behavior. Secrets, full URLs, local paths, media titles, and playback history do not enter logs or Client Settings.

Playback lifecycle is desktop-local. Route, project, and thread switches MAY preserve a running native session when the user chose that behavior, but disable, source replacement, app shutdown, permission loss, helper crash/GPU hang, or crash teardown MUST release native processes, decoders, file handles, network requests, textures, PCM buffers, projectM analysis/render state, and audio. Browser deployments show an honest unsupported state and do not silently substitute an HTML media element.

### Audio-reactive visualizer (conditional Local Media extension)

If the Local Media feasibility gate passes, Cafe Code MAY integrate the open-source, MilkDrop-compatible `libprojectM` visualization engine. The supported direct signal path is decoded PCM owned by the approved local media pipeline:

```text
approved local file/playlist/stream
  -> libVLC decoder
  -> allocation-free bounded PCM tap
  -> crash-isolated least-privileged native media worker
  -> libprojectM FFT/beat analysis and rendering
  -> reviewed bounded texture/fence handle
  -> Cafe Code compositor
```

This path may visualize an audio file or the audio track of other approved Local Media content. The libVLC audio callback MUST be allocation-free, lock-free/nonblocking, and limited to writing a normalized timestamped sample block into a bounded ring buffer. Sample-rate/channel/format conversion happens off callback. Overflow drops the oldest visualization input without delaying playback; no visualizer backpressure may reach the decoder or audio device. The feasibility record defines maximum audio-to-visual latency, ring size, render FPS/resolution/device-pixel-ratio, hidden/unfocused behavior, and CPU/GPU budgets.

libprojectM and untrusted media/preset processing MUST NOT load in the sandboxed Electron renderer or the main backend. Raw PCM, FFT/spectrum data, and analysis history MUST NOT cross renderer/server JavaScript IPC. The selected native worker owns decode-adjacent analysis and rendering under least privilege; the typed bridge carries only minimal control/status plus a reviewed bounded texture/fence handle after the platform composition architecture is proven. A CPU-copy route may be considered only by a separate recorded architecture and budget review rather than being implied by `renderer-owned texture`. Worker crash, GPU hang, device loss, timeout, and restart tear down every buffer/context/handle without stopping chat.

Raw PCM, FFT/spectrum data, and analysis history are ephemeral sensitive media data. They MUST NOT persist, synchronize, enter logs, telemetry, prompts, workflow events, crash dumps, diagnostics, or any remote boundary. Playback metadata and preset choice follow the Local Media privacy rules above.

Version 1 ships only a reviewed, licensed bundled-preset allowlist. Presets, shaders, and texture packs are executable-like input material. User preset import remains absent unless a separate security gate approves private content-addressed extraction; archive count/compression-ratio/byte limits; traversal, absolute-path, symlink/reparse-point, shader-include, and external file/network-reference rejection; texture count/dimension/decoded-pixel and transition caps; TOCTOU-resistant use; helper watchdogs; GPU/device-reset recovery; and malicious shader, texture-bomb, traversal, TOCTOU, GPU-timeout, and cleanup tests.

The visualizer MUST use a reviewed photosensitivity-safe preset allowlist plus a tested post-render temporal flash limiter covering luminance and saturated-red flashes. Imported presets, if ever approved, pass the same output gate. Reduced motion disables animated visualization and all PCM tap, FFT, projectM, and visualizer GPU work while leaving user-requested audio playback unchanged. Hidden/unfocused policy may pause visualization work independently of playback.

If this feature ships, a runtime-schema-bounded desktop-local record owns only `{ enabled, bundledPresetId }`, defaults to disabled, rejects unknown preset IDs, and persists atomically with unrelated desktop settings preserved on recovery. Source, playback position, PCM, analysis state, and imported asset paths are never persisted. Disable, reset, and the global Disable All coordinator stop the PCM tap/native worker before reporting success.

YouTube is not a supported direct audio source. The YouTube IFrame API exposes playback control and state, not PCM samples, and YouTube API policy forbids separating, isolating, or modifying the audio or video components of YouTube audiovisual content. Cafe Code MUST NOT extract, intercept, decode, proxy, or otherwise analyze the iframe's audio stream, and MUST NOT market a visualizer as being driven by YouTube audio.

A generic desktop `System audio input` feasibility experiment MAY be evaluated separately from YouTube and Local Media. It would capture a user-selected operating-system output device and could therefore react to any audible application. It is not approved for shipping through this canon: it requires explicit capture permission and status, privacy and recording review, platform-specific WASAPI/Core Audio/PipeWire feasibility, device-change recovery, exclusion/feedback behavior, and written policy review for coexistence with protected third-party players. Until those gates pass, the control remains absent, and it MUST be unavailable whenever Cafe Code's YouTube player is active.

### Workflow Observatory

Cafe Code MUST provide an optional `Workflow` view beside the existing `Plan` view. On wide layouts it uses the existing right-panel boundary; on narrow layouts it uses the existing sheet behavior. Opening/closing and the selected tab are per-device UI state, not shared Client Settings.

The view combines:

- current plan steps and their provider-reported status;
- a hierarchical root/sub-agent tree;
- each agent's provider-reported display path/name, task label, status, elapsed time, and latest safe activity summary when available;
- recent tool/activity flow grouped under the agent that produced it when correlation exists; and
- completed/interrupted/failed agents for the current turn, collapsible after completion.

The canonical agent statuses are `queued`, `running`, `waiting`, `completed`, `failed`, `interrupted`, and `unknown`. Status is based only on explicit provider lifecycle/activity data. Silence is shown as `No recent activity`; Cafe Code MUST NOT infer that an agent is stuck, waiting, or complete from a timer alone.

Fields the provider does not report remain visibly unavailable. Use honest placeholders such as `Parent/path not reported` and `Duration unavailable`; never derive provider elapsed duration from local receipt time.

Provider fidelity is explicit:

- `live`: provider supplies correlated spawn/path/lifecycle updates;
- `lifecycle-only`: Cafe Code can show start/terminal events but not live inner work; and
- `not-reported`: the provider exposes no safe sub-agent lifecycle.

The current Codex adapter already recognizes `subAgentActivity` as `collab_agent_tool_call`, and Claude supplies task/sub-agent progress in its adapter. Implementation MUST normalize only fields actually present and degrade to a flat activity list or an explanatory empty state for other providers. It MUST NOT poll private provider internals or fabricate hierarchy.

The graph is a presentation of normalized orchestration events. It is not hidden reasoning. The UI MUST NOT display chain-of-thought, raw provider protocol payloads, secrets, full unredacted prompts, OAuth/media credentials, or data already removed by provider/server sanitization. It may show the same safe summaries, tool titles, and file/command previews Cafe Code already permits in its work log.

The view is read-only in version 1. Interrupting, steering, messaging, or spawning an individual sub-agent from the graph is a separate control/security project.

The visualization MUST:

- support arbitrary-depth agent paths without recursive layout blowups;
- use text/icons as well as color for state;
- provide a semantic keyboard/screen-reader list/tree alternative to any graphical connectors;
- keep nodes and recent events bounded/virtualized;
- reconstruct after reconnect from persisted current-turn activities or a normalized snapshot;
- tolerate duplicates, out-of-order lifecycle updates, missing terminal events, and provider restarts;
- avoid rerendering the chat timeline for every graph animation; and
- honor reduced motion by replacing pulsing/moving connectors with static state.

### Ambient glow

Glow is a CSS-rendered layer behind the media card. It MUST:

- be optional and off by default;
- use a bounded blur/radius and opacity;
- ignore pointer events;
- avoid continuous repaint work when the media frame is unchanged; and
- disappear when its media panel is disabled.

Version 1 uses a user-selected glow color, defaulting to the app accent where available. Live sampling of YouTube frame-edge colors is explicitly not promised: cross-origin video frames cannot be safely sampled by Cafe Code, and cloning a player to fake the effect would waste bandwidth and resources.

Palette extraction from an uploaded, trusted local image MAY be considered later, behind performance tests.

### YouTube sources

The persisted source is an atomic discriminated value:

```ts
type YouTubeSource =
  | { kind: "video"; id: YouTubeVideoId }
  | { kind: "playlist"; id: YouTubePlaylistId }
  | null;
```

The default is `null`. Video IDs match `[A-Za-z0-9_-]{11}`. Playlist IDs match `[A-Za-z0-9_-]{10,80}`; this intentionally bounded transport schema is validated again by YouTube rather than trying to infer every playlist prefix. A source update replaces the complete value; a partial object is invalid.

Cafe Code MUST accept video IDs only from these HTTPS URL forms and exact host allowlist:

- `youtube.com/watch?v=<id>` or `www.youtube.com/watch?v=<id>`;
- `youtube.com/live/<id>` or `www.youtube.com/live/<id>`;
- `youtu.be/<id>`; and
- `youtube.com/embed/<id>` or `www.youtube.com/embed/<id>`.

Playlist input accepts canonical `youtube.com/playlist?list=<id>` and `www.youtube.com/playlist?list=<id>` URLs. A watch URL containing both `v` and `list` is rejected as ambiguous with guidance to paste the canonical video or playlist URL. The parser MUST use the URL API and exact hostname equality. It MUST reject credentials, arbitrary/lookalike hosts, non-HTTPS input, embed HTML, scripts, unknown path forms, and malformed IDs. Extra query and fragment values are ignored after extracting the selected source and are never forwarded. Persist only the normalized source value, never the pasted URL or arbitrary query parameters.

The renderer MUST build video and playlist sources from hard-coded privacy-enhanced bases:

- `https://www.youtube-nocookie.com/embed/<video-id>`
- `https://www.youtube-nocookie.com/embed/videoseries?list=<playlist-id>`

It MUST use a normal sandboxed `iframe`, never Electron `webview`. The version 1 baseline is exact:

- `sandbox="allow-scripts allow-same-origin allow-presentation"`;
- `allow="encrypted-media; fullscreen; picture-in-picture"` plus the boolean `allowfullscreen`;
- `referrerpolicy="strict-origin-when-cross-origin"` and `loading="lazy"`; and
- a fixed descriptive title.

No other sandbox or feature token is allowed without a separate compatibility/security test. In particular, omit every `allow-top-navigation*` token, `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-downloads`, `allow-forms`, `allow-modals`, and `allow-pointer-lock`. Cafe Code provides its own explicit external-open action.

Autoplay is off by default and playback begins only after a user gesture. Disabling or replacing the video MUST unmount the iframe so playback and network activity stop.

The settings UI MUST disclose that starting playback contacts YouTube and shares ordinary network/device information. The privacy-enhanced domain reduces stored tracking before interaction but does not make third-party playback private.

### YouTube search, playlists, and account connection

Public search works for Cafe Code users who are not signed into YouTube. It requires a server-configured YouTube Data API key; the key stays in a scoped backend secret/config accessor and is never sent to the renderer. A dedicated Data API client redacts the `key` query parameter and full upstream URL/body from HTTP tracing, diagnostics, and errors. The authenticated Cafe Code endpoint validates bounded queries, rate-limits and caches requests, constrains result counts/pages, uses an explicit safe-search/region policy, and returns only the fields needed for video/playlist selection.

Search results remain recognizably YouTube results. Cafe Code MUST preserve returned titles/thumbnails/attribution, display required YouTube branding, and MUST NOT mix non-YouTube results into the list. Search queries, page tokens, and result-list metadata are transient and are not written to Client Settings, logs, prompts, or analytics. Selecting a result persists only its normalized public `YouTubeSource`, as described below. If no API key/quota is available, the UI explains that in-app search is unavailable and offers an explicit external "Search on YouTube" action.

Public playlist URLs and public playlist search require no YouTube account. Selecting a result stores the normalized video/playlist source. Backend Data API calls use exact Google API origins and bounded response decoding.

Search thumbnails use an authenticated Cafe Code proxy, never renderer-selected remote URLs. The proxy accepts only API-returned HTTPS URLs on the static V1 host allowlist (`i.ytimg.com`) whose paths match the bounded YouTube thumbnail form, disables redirects, resolves/connects only to the validated public destination, caps bytes/time/dimensions/MIME, and returns its own safe content headers. Invalid thumbnails render a placeholder. Thus merely viewing search results does not directly connect the renderer to YouTube; starting playback or choosing the explicit external action still does.

Connected-account playlist selection is optional and installation/profile-wide. Only a Cafe Code owner-authorized session may connect or disconnect the account. Version 1 supports exactly two configured deployment modes:

- Local packaged Electron with its Cafe Code backend on the same machine uses a Google **Desktop app** client and a temporary `127.0.0.1` loopback listener on a random available port. It never uses `localhost`, binds no non-loopback interface, stops after one response/timeout, and is disabled when the app is connected to a remote backend.
- Browser or Electron with a remote backend uses a Google **Web application** client only when the operator configures one fixed, pre-registered HTTPS callback on Cafe Code's externally reachable canonical origin. Startup validates the exact scheme/host/port/path against an allowlist; forwarded host/proto are trusted only from configured proxies. Otherwise account connection is disabled with operator guidance.

The renderer asks the backend to create an authorization transaction; it cannot supply a redirect or arbitrary external URL. Electron opens only the generated `https://accounts.google.com/o/oauth2/v2/auth` URL through the existing safe external-opening boundary. Browser clients open that same exact origin/path through a user-initiated navigation.

Authorization MUST:

- use Google's external system browser, never an Electron iframe, `BrowserView`, `webview`, or embedded user-agent;
- use Authorization Code with S256 PKCE, single-use expiring state/CSRF validation, the deployment-specific redirect above, and exactly `https://www.googleapis.com/auth/youtube.readonly`; no additional Google scope is allowed in version 1;
- keep OAuth client configuration and refresh/access tokens out of the renderer and Client Settings;
- encrypt tokens at rest in the backend secret store with an authenticated-encryption key outside that store, serialize refresh, and redact credentials and complete OAuth/Data API request URLs from logs/errors/tracing;
- provide connection status without exposing tokens;
- support disconnect, local token deletion, and best-effort Google revocation; and
- satisfy Google's app verification, homepage, privacy-policy, and consent requirements before public distribution.

The callback route is excluded from raw-query access logging. It sends `Cache-Control: no-store` and a no-referrer policy, never renders or records its query, consumes state atomically, and exchanges the code server-side. Success and every failure end with a `303` to a fixed query-free completion page; only an opaque transaction status, readable by the initiating owner session through the authenticated backend, reports the outcome. Authorization codes, state, and exchange errors never enter browser history beyond Google's unavoidable callback navigation, referrers, renderer state, ordinary error pages, or diagnostics.

The account browser/API flow lists playlists that the YouTube Data API permits for the authenticated account. Private or otherwise non-embeddable playlists remain visible only to the authorized owner and offer `Open in signed-in YouTube`; Cafe Code MUST NOT imply that account linking makes them playable in the privacy-enhanced iframe. The UI MUST also explain that some system collections, including Watch Later/history where the API forbids access, may not appear.

Account linking enables playlist discovery; it does not authenticate the embedded iframe, expose Premium entitlement, or guarantee Premium/ad-free playback inside Cafe Code. The YouTube IFrame API has no supported Premium-login handoff, and Google forbids OAuth in an embedded user-agent. Cafe Code therefore labels the action `Connect YouTube account`, not `Premium login`, and provides `Open in signed-in YouTube` for users who want their Premium benefits in the system browser. A future supported authenticated-player API may replace this limitation after a separate policy/security review.

### Ambient image source

Version 1 accepts user-uploaded raster files only. Arbitrary remote URLs, `file:` paths, data URLs, HTML, and SVG are not allowed.

The server MUST store bytes in a private authenticated asset store and persist only validated metadata in Client Settings. The existing content-hashed `BrandingImageStore` is the behavioral template, but ambient media receives a separate domain-neutral store and route rather than overloading sidebar branding.

Version 1 allows bounded animated GIF plus static PNG, JPEG, and WebP. APNG and animated WebP are rejected. Validation MUST inspect file bytes, not trust extension or declared MIME type. It MUST bound:

- encoded bytes;
- width and height;
- total pixels; and
- for GIF animation, frame count, duration, disposal/subframe behavior, and cumulative decoded-pixel/work budget.

The upload reader MUST enforce its byte limit while streaming, independently of `Content-Length`; the header is advisory only. It aborts as soon as the limit is exceeded. The project MUST select and audit an implementable GIF metadata/parser mechanism before this slice begins, including malformed/truncated input.

Uploads use an authenticated endpoint. Serving an asset requires the same authorization boundary. Ambient assets and their quota are scoped to the backend state directory/installation profile, matching the shared Client Settings they support; they are not keyed to a renewable session or individual session subject. Any authenticated session authorized to update Client Settings may upload/replace/remove, and authenticated sessions authorized to read those shared settings may fetch the currently referenced asset. Replace/remove makes the old asset eligible for profile-wide reference-checked deletion. A bounded, post-readiness background sweep uses a grace age, rechecks current references immediately before deletion, and processes limited batches so it cannot block startup or race a new reference. Temporary object URLs used for previews MUST be revoked.

Reduced motion always prevents animated GIF playback. Cafe Code shows a non-animated placeholder rather than pretending an `<img>` can be paused. When hidden or unfocused, GIF mounting follows `continueBackgroundAnimations`; disabling/replacing always unmounts it. YouTube playback is user-controlled, is not treated as decorative animation, and may be suspended by the browser; disabling/replacing always unmounts it.

### Whole-window opacity

This control is separate from atmosphere opacity and media/glow opacity.

The Appearance panel MUST provide an Electron-only Whole-window opacity switch and opacity control. Default is off/1.00. The saved value is bounded; the initial supported range is 0.65–1.00. The minimum may be lowered only after a recovery mechanism and legibility testing exist.

Version 1 means native whole-window opacity: text, controls, chat, effects, and media all fade together. It is not background-only blur, acrylic, or KDE-style per-background compositing.

The renderer MUST request this through a typed, validated preload bridge. Only trusted Cafe Code web contents may invoke it. The main process owns the capability check and calls Electron's native window API. It MUST reject out-of-range, non-finite, and malformed values.

The browser surface remains fully opaque. Desktop capability is the intersection of Electron platform support and an explicit release-build allowlist backed by a recorded native smoke result. Windows/macOS may be enabled only when present in that manifest; an unvalidated artifact shows a disabled `release-not-validated` reason and remains at 1.00. Electron's `BrowserWindow.setOpacity` is a no-op on Linux, so Linux is always `unsupported-platform` and Cafe Code MUST NOT claim that this version reproduces Konsole transparency on Linux/X11/Wayland.

This feature MUST NOT turn on `transparent: true`, disable sandboxing, enable Node integration, or weaken context isolation. Those are separate architectural choices with different compositor and security consequences.

The main process MUST load desktop-local opacity before creating/revealing each new main window and apply changes only on explicit updates. Theme/appearance sync MUST NOT overwrite it. Opacity mutation and main-window registration/reveal share one transaction/revision boundary: a new window cannot reveal mid-mutation, and a window destroyed during apply is removed without converting a successful apply into a phantom failure.

The service captures the previous confirmed settings and their effective value (`enabled ? opacity : 1`), applies the requested effective value to all registered live windows, and persists only after all applications succeed. If persistence fails, it restores that previous effective value—not the remembered slider value—to every live window while leaving the previous preference pair intact. If any window application fails, it best-effort resets every currently registered live window to 1.00 and persists safe `{ enabled: false, opacity: 1 }`. Before returning success it reconciles the current window registry under the same boundary.

A rollback/reset or recovery-persistence failure remains an explicit degraded error with retry; the UI MUST NOT claim that live windows and disk agree. State represents confirmed-versus-unknown persistence and consistent-versus-mixed/unknown live opacity explicitly. Every committed or degraded transition increments a revision and is broadcast to all trusted Cafe Code renderers; controls ignore stale revisions.

A recovery path MUST always exist:

- starting with unsupported or corrupt settings yields opacity 1.00;
- reset appearance returns opacity to 1.00;
- the bridge/recovery control remains available during rollback until all live windows are confirmed consistent at 1.00 and safe settings are confirmed persisted; and
- a documented safe-start option or keyboard-accessible reset is required before permitting values below 0.65.

## Persistence and contracts

Cross-surface atmosphere/media configuration belongs in `ClientSettingsSchema` and `ClientSettingsPatch`, with decoding defaults so older settings continue to load. Once authenticated, the backend remains authoritative as required by Cafe Code's settings architecture; local storage is bootstrap/fallback only.

Because Cafe Code applies Client Settings patches shallowly, version 1 SHOULD use flat bounded keys for the frequently changed controls. This avoids whole-group replacement from a stale snapshot overwriting sibling values. The exact names may change, but the canonical shape is:

```ts
fallingEffectsEnabled: boolean;
fallingEffectKind: "snow" | "rain" | "matrix";
fallingEffectColor: "auto" | HexColor;
fallingEffectOpacity: number;
fallingEffectSpeed: number;

ambientVideoEnabled: boolean;
ambientVideoSource: YouTubeSource;
ambientVideoPresentationMode: "floating" | "cinema";
ambientVideoLayoutMode: "preset" | "custom";
ambientVideoPresetPlacement: "bottom-left" | "bottom-right";
ambientVideoPresetSize: "small" | "medium" | "large";
ambientVideoGlowEnabled: boolean;
ambientVideoGlowColor: "auto" | HexColor;
ambientVideoGlowOpacity: number;

ambientImageEnabled: boolean;
ambientImageAsset: AmbientImageAsset | null;
ambientImageLayoutMode: "preset" | "custom";
ambientImagePresetPlacement: "bottom-left" | "bottom-right";
ambientImagePresetSize: "small" | "medium" | "large";
ambientImageGlowEnabled: boolean;
ambientImageGlowColor: "auto" | HexColor;
ambientImageGlowOpacity: number;
```

Exact schema names may change during implementation, but semantics, defaults, and bounds are canonical.

Custom geometry is device/layout presentation state and SHOULD remain in a versioned local geometry store keyed by media slot, not in server-authoritative settings. If cross-device geometry is later required, it must use normalized values and migration/clamping tests.

The patch schema MUST expose every new Client Settings key. Reset and changed-setting summaries MUST include every new field. Persisted settings recovery is field/group scoped: absent new keys take defaults; a malformed ambient field/group resets only the ambient field/group while preserving unrelated decodable preferences and emitting a warning. A malformed RPC patch is rejected atomically. Tests cover direct and legacy-wrapped documents, partial current documents, corruption, and the known downgrade limitation that an older binary may erase unknown future keys.

The atomic `ambientVideoSource` union is the deliberate exception to flat high-churn controls. `ClientSettingsPatch` accepts only a complete valid source or `null`; source helpers build the replacement from normalized IDs.

YouTube Data API keys, OAuth client configuration, tokens, connection state, search queries/results, playback, and page tokens do not belong in Client Settings. API configuration/tokens use backend config/secret storage; connection status comes from a dedicated owner-authorized API; discovery state is transient.

Workflow visualization does not add user preference fields to Client Settings. Provider-specific activities are normalized at the server boundary into runtime-schema-backed safe workflow lifecycle/snapshot data with stable node IDs, parent/path correlation where available, canonical status, timestamps, fidelity, and already-sanitized display fields.

Every snapshot/event carries a scope key `{ environmentId, providerInstanceId, providerEpochId, threadId, turnId }`. `providerEpochId` rotates whenever the provider process/runtime restarts even if its configured instance ID stays the same. Node IDs need be unique only within that scope key.

A snapshot separately adds `snapshotRevision` and `watermark`; pagination cursors are opaque and bound to that immutable revision. A live event separately adds a monotonic sequence/cursor after the watermark. The client subscribes from the watermark before applying buffered live events. It swaps/clears the projection only on scope-key change and rejects late, wrong-scope, or stale-order events.

Lifecycle precedence is monotonic within a provider epoch: terminal states cannot be reopened by a stale start/progress event, while a new epoch may reuse provider IDs safely. Reconnect reconstruction uses persisted orchestration activity plus this snapshot/live handoff, not renderer-only guesses.

Native opacity does not belong in Client Settings. `{ enabled, opacity }` is desktop-local shell state in `apps/desktop/src/settings/DesktopAppSettings.ts` and `desktop-settings.json`. It is loaded before window creation/reveal and queried/mutated through `DesktopBridge`, not the environment API. Runtime-schema-backed contracts provide `getWindowOpacityState`, `setWindowOpacityState`, `resetWindowOpacityState`, and `onWindowOpacityStateChanged`:

```ts
type WindowOpacityReasonCode =
  | "unsupported-platform"
  | "release-not-validated"
  | "apply-failed"
  | "partial-apply-failed"
  | "persist-failed"
  | "rollback-failed"
  | "safe-reset-failed"
  | "state-diverged"
  | "recovery-persist-failed";

type WindowOpacityCapability =
  | { supported: true; platform: "win32" | "darwin" }
  | {
      supported: false;
      reasonCode: "unsupported-platform" | "release-not-validated";
    };

type OpacitySettings = { enabled: boolean; opacity: number };
type ConfirmedOpacity = { kind: "confirmed"; settings: OpacitySettings };
type UnknownOpacity = { kind: "unknown"; lastKnownSettings: OpacitySettings };
type ConsistentOpacity = { kind: "consistent"; opacity: number };
type MixedOpacity = { kind: "mixed-or-unknown" };

type WindowOpacityState =
  | {
      revision: number;
      status: "unsupported";
      capability: {
        supported: false;
        reasonCode: "unsupported-platform" | "release-not-validated";
      };
      persisted: ConfirmedOpacity;
      liveOpacity: { kind: "consistent"; opacity: 1 };
      reasonCode: "unsupported-platform" | "release-not-validated";
    }
  | {
      revision: number;
      status: "ready";
      capability: { supported: true; platform: "win32" | "darwin" };
      persisted: ConfirmedOpacity;
      liveOpacity: ConsistentOpacity;
      reasonCode: null;
    }
  | {
      revision: number;
      status: "recovered";
      capability: { supported: true; platform: "win32" | "darwin" };
      persisted: ConfirmedOpacity;
      liveOpacity: ConsistentOpacity;
      reasonCode: "apply-failed" | "partial-apply-failed" | "persist-failed";
    }
  | ({
      revision: number;
      status: "degraded";
      capability: { supported: true; platform: "win32" | "darwin" };
      reasonCode:
        | "rollback-failed"
        | "safe-reset-failed"
        | "state-diverged"
        | "recovery-persist-failed";
    } & (
      | { persisted: UnknownOpacity; liveOpacity: ConsistentOpacity | MixedOpacity }
      | { persisted: ConfirmedOpacity; liveOpacity: MixedOpacity }
    ));
```

Runtime-schema refinement also checks that `ready`/`recovered` consistent opacity equals the confirmed effective value and rejects every invalid capability/status/reason combination. In `ready` or `recovered`, confirmed disabled settings imply consistent opacity 1.00. A degraded state may legitimately have confirmed safe settings plus mixed live windows.

UI copy maps from reason codes; arbitrary main-process error strings do not cross the bridge. `onWindowOpacityStateChanged` atomically registers the listener and immediately emits the current state, eliminating a get-then-subscribe gap; `getWindowOpacityState` remains available for diagnostics/retry. Each control keeps only the highest revision. A degraded state disables optimistic claims and exposes retry/safe-start guidance.

## Rendering architecture

### Layering

The target stack, from back to front, is:

1. native window/background;
2. application surfaces and chat media/glow within the messages wrapper;
3. full-window atmosphere (`pointer-events: none`, `aria-hidden`);
4. chat affordances such as scroll-to-bottom;
5. popovers, dialogs, command palette, toasts, onboarding, and shutdown overlays.

`WindowAtmosphere` mounts once in `apps/web/src/routes/__root.tsx`. A stable video session/iframe host mounts in an authenticated workspace shell above chat routes. `ChatView` supplies only a measured floating-media anchor/portal-target registration; route changes and presentation changes MUST NOT move the iframe to a different DOM parent. The ambient-image overlay may remain scoped to the messages wrapper because its decode/lifecycle is independent.

Z-index values MUST be named/documented or derived from existing layer tokens. Arbitrary ever-higher values are not acceptable. In floating presentation, the atmosphere visibly crosses the media image/iframe as requested but, because it ignores pointer events, media and app controls remain interactive. Cinema workspace is the deliberate exception: its player rectangle is a protected region above which no Cafe-owned visual layer may render.

### Atmosphere engine

Use one canvas rather than one DOM node per particle. Simulation and drawing SHOULD be separated into pure, deterministic functions with a seedable random source for tests.

The engine MUST:

- cap device-pixel ratio;
- cap particle/column count by viewport area;
- reuse bounded arrays instead of allocating per frame;
- handle resize without unbounded growth;
- avoid React state updates per frame;
- stop and release its animation frame when disabled/unmounted; and
- produce no network traffic.

It MUST obey Cafe Code's existing document policy:

- pause when hidden or unfocused unless `continueBackgroundAnimations` is enabled;
- pause for `prefers-reduced-motion: reduce`, regardless of the background override;
- recompute when either policy changes; and
- never use the power-save blocker merely to keep decoration moving.

The reduced-motion presentation is no falling animation. A future static decorative state MAY be added if it is separately accessible.

### Media layout engine

Placement and clamping calculations live in a pure module. The visual component owns focus and pointer behavior but not geometry math.

Dragging an iframe itself is unreliable because it owns pointer events. Cafe Code MUST use an explicit overlay handle/customize mode. Pointer listeners and temporary body cursor/user-selection changes MUST be cleaned up on pointer-up, pointer-cancel, lost capture, blur, and unmount.

Panel state changes MUST NOT cause the message timeline to remount, invalidate its virtualization cache, or change thread auto-scroll state.

The video session owner and iframe host MUST also survive project and thread content changes. Switching those surrounding views updates the rails without changing the iframe DOM identity, parent, source, or player adapter instance. Entering or leaving cinema changes layout around that stable host; it never reparents the iframe. `ChatView` publishes measured placement information and a floating anchor/portal target but does not own player lifecycle. Only source replacement, disable, teardown, or an unrecoverable player error creates a new player lifecycle.

### Workflow projection

Workflow derivation lives in a pure reducer from normalized lifecycle activities to a bounded graph snapshot. It MUST be deterministic and idempotent for duplicate events. Unknown provider fields remain unknown rather than being cast into the canonical schema.

The UI SHOULD evolve `PlanSidebar` into a plan/workflow right-panel shell rather than adding a competing overlay. Graph/list nodes use stable node IDs, and activity updates target the affected node so token streaming does not rebuild the entire tree.

## Security and privacy invariants

The current Electron defaults remain mandatory:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`; and
- denied `window.open` with safe external opening.

Before external iframe or discovery support ships, Cafe Code MUST add and test a Content Security Policy and related response headers. Renderer CSP must be restrictive and explicitly allow only the required YouTube privacy-enhanced frame origin; Data API and thumbnail network access remains in the backend's fixed outbound allowlists. Do not add a blanket `https:` source.

At minimum, the release security work covers restrictive `default-src`, `script-src`, `style-src`, `font-src`, `img-src`, `media-src`, `worker-src`, `connect-src`, `frame-src`, `object-src`, `base-uri`, `form-action`, and `frame-ancestors`, plus a referrer policy, `X-Content-Type-Options`, and a minimal Permissions Policy. The design MUST inventory and test Cafe Code's inline boot script/style, Google Fonts, data/blob upload previews, workers/service worker, authenticated asset routes, user-selected remote HTTP/WebSocket environments, Vite/HMR development, browser production, and packaged Electron. Inline content uses a nonce/hash or is externalized. Any broad `connect-src` needed for saved environments is documented; `frame-src` remains exact. Development exceptions must not leak into production.

No feature accepts or renders arbitrary HTML. User-visible URLs, workflow labels, provider summaries, and source errors are escaped as text. Media settings must never contain cookies, OAuth tokens, signed arbitrary URLs, or full upload bytes. OAuth state/verifier/code/tokens never enter renderer logs or orchestration activity. Callback and Data API routes apply the stricter query/request redaction rules above before generic access logging or tracing.

## Accessibility and legibility

All controls require accessible names, keyboard operation, visible focus, and explanatory disabled states.

The interface MUST:

- honor reduced motion;
- never rely only on color to communicate mode/state;
- keep panel toolbars reachable at browser zoom;
- preserve composer, timeline, header, and plan-panel operation;
- avoid flashing patterns;
- use conservative default opacity/glow; and
- provide a one-action disable/reset path.

Presentation-mode and independent rail controls expose their current state without relying on icons or color. Focus transfer and `Escape` behavior follow the video presentation contract, and the iframe has a descriptive title in both floating and cinema presentations.

Atmosphere is `aria-hidden`. Media has descriptive titles. Decorative GIFs use empty alternative text; meaningful user-supplied descriptions are a later product decision because this media is not chat content.

Whole-window opacity can reduce contrast against arbitrary desktop backgrounds. The UI MUST warn about legibility and preview changes without allowing the window to become effectively invisible.

## Performance and reliability budgets

Cafe Code sessions commonly run for 16 hours or longer. Acceptance requires:

- no unbounded particle, timer, listener, iframe, object-URL, or decoded-image growth;
- no atmosphere work while disabled;
- no media network/animation work after its slot is disabled;
- no iframe duplication for glow;
- no unbounded search result/cache, workflow node, connector, or activity growth;
- stable memory after repeated enable/disable and route/thread changes;
- stable iframe identity and playback session across project/thread switches and floating/cinema transitions;
- bounded canvas resolution and animation density on high-DPI displays; and
- typing, message scrolling, token-to-screen timing, renderer CPU, and memory remain within the numeric budgets recorded in Phase 0.

Phase 0 records hardware, build type, scenario, sampling duration, particle/DPR caps, and allowed deltas. The implementation plan includes a soak test and background/minimize test. Performance regressions block release even when functional tests pass.

## Responsive behavior

Desktop and browser are first-class surfaces.

- Atmosphere spans either surface.
- Native opacity is capability-gated to Electron.
- Preset media sizes clamp to the messages pane.
- When the messages pane is narrower than 640 CSS pixels, both media panels unmount and a compact "Ambient media hidden at this width" status appears in settings; YouTube does not auto-resume when the pane widens.
- Custom handles require a fine pointer and at least 768 CSS pixels of messages-pane width; otherwise the last custom geometry is preserved while the panel uses its nearest safe preset.
- Opening the plan or diff panel recomputes floating-media bounds.
- In effective cinema, Plan/Workflow uses the measured chat-rail width to choose inline or the existing sheet. Diff is forced into a sheet outside the protected player or locally suspends cinema while the stable playback session survives. Neither feature adds a fourth pane.
- Cinema workspace collapses its left project sidebar and right chat rail independently before reducing its 16:9 player. If the protected player cannot remain at least 356 by 200 CSS pixels with reachable controls, the renderer locally uses the normal/floating-safe presentation while preserving the shared `cinema` preference.
- The 640-pixel floating-media hide rule does not independently unmount a player already in cinema; cinema uses the protected-player fit rule above.
- Workflow uses the right-panel sheet on narrow layouts and remains keyboard navigable without a spatial graph.
- Safe-area insets and on-screen keyboard behavior remain intact.

## Observability

Expected user input failures are reported near the relevant setting: invalid YouTube URL, rejected upload, unsupported opacity, geometry reset, or—if Local Media ships—unsupported local media, denied file access, or rejected direct stream. They are not uncaught errors.

Logs MAY record feature kind, capability outcome, normalized error code, workflow node counts, and provider fidelity. Logs MUST NOT record pasted URLs, normalized video/playlist IDs, search queries, playback/watch events, Data API keys/full upstream URLs/bodies, OAuth authorization codes/state/verifiers/tokens/full request URLs, private playlist titles, raw provider workflow payloads, hidden reasoning, image bytes, upload filenames, local media titles, direct-stream URLs, local file paths, PCM, FFT/spectrum values, analysis history, or visualizer frame contents.

No analytics or telemetry is added by this feature without a separate product decision.

## Implementation constraint references

- [Electron `BrowserWindow` API](https://www.electronjs.org/docs/latest/api/browser-window) and [custom window styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
- [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies), [desktop/native flow](https://developers.google.com/identity/protocols/oauth2/native-app), and [web-server flow](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps)
- [Google API OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes)
- [YouTube embedded-player parameters](https://developers.google.com/youtube/player_parameters) and [IFrame API](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube API Services developer policies](https://developers.google.com/youtube/terms/developer-policies)
- [YouTube Data API search](https://developers.google.com/youtube/v3/docs/search/list), [owned playlists](https://developers.google.com/youtube/v3/docs/playlists/list), and [playlist items](https://developers.google.com/youtube/v3/docs/playlistItems/list)
- [projectM](https://github.com/projectM-visualizer/projectm)

## Non-goals for the first release

- arbitrary streaming providers or arbitrary iframe URLs;
- Local Media Theater unless its separate feasibility and conditional ship gates pass;
- browser media plugins, DRM circumvention, website media-URL extraction, universal codec/service support, or YouTube feature parity through Local Media;
- Electron `webview`;
- embedded Google/YouTube login or cookie sharing;
- claiming or detecting YouTube Premium entitlement through the Data/IFrame APIs;
- remote GIF/image hotlinks;
- background-only blur/acrylic/vibrancy;
- Linux compositor-specific Konsole transparency;
- live YouTube edge-color sampling;
- audio visualizers outside the conditional Local Media/projectM path, including direct YouTube audio analysis;
- generic system-audio capture unless its separate privacy, platform, performance, and third-party policy gates pass;
- media tied to a thread or prompt;
- per-particle physics editors;
- multiple videos or more than one ambient image;
- touch-first freeform window management;
- new power-save behavior;
- playback synchronization across clients;
- retaining unbounded orphan media assets;
- exposing hidden reasoning or raw provider payloads; and
- sub-agent control/steering from the Workflow Observatory.

## Definition of complete

This canon is satisfied only when:

1. all features and defaults match this document;
2. schema migration and capability fallbacks are safe;
3. security headers, OAuth boundaries, API-key protection, and source validation are in place;
4. reduced-motion, keyboard, browser, Electron, workflow fallback, and responsive behavior pass;
5. the repository's required format, lint, typecheck, unit test, browser test, desktop smoke, and desktop-build gates pass, with a native smoke result for every platform advertised as opacity-supported;
6. a long-session soak finds no unbounded resource growth; and
7. a reviewer who did not author each implementation slice has audited it and all findings are resolved or explicitly accepted in writing.
