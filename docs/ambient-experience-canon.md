# Club Code Experience and Operator-Visibility Canon

Status: implementation truth for the current working checkout, not a release
certificate. The baseline suite is substantial, but several ideas from the
operator request ledger are partial, intentionally bounded, externally blocked,
or not implemented. Matrix telemetry, expanded Matrix color/audio modes,
ambient-image directory cycling, direct/VLC live-frame adaptive glow, the live
Workspace Observatory, explicit LM Studio instance creation, the workflow
graph, bounded local/VLC queues, bounded background Auto Nudge, and the
provider-callable browser bridge are landed in the working tree with focused
evidence and completed independent repair passes. Their final composite gates
are still pending.

## Status language

- **Implemented** means the behavior exists in this checkout behind its stated
  capability and privacy boundaries.
- **Landed - validation pending** means production code and focused evidence
  exist in this working tree, but independent repair and the fresh composite
  release gates have not all completed.
- **Partial** means a useful subset exists, but an explicitly requested mode or
  parity item is still absent.
- **Not implemented** means there is no production path for the requested
  behavior.
- **Externally blocked** means Club Code cannot honestly provide the behavior
  without a supported upstream API, entitlement, or platform capability.

This distinction is part of the product contract. A design note, setting,
scaffold, or test fixture is not by itself a shipped feature.

## Purpose and naming

Club Code is the user-facing name of this fork. Upstream Cafe Code package
names, commands, environment variables, stored-data directories, and protocol
identifiers remain where compatibility requires them. New user-facing copy and
documentation use Club Code.

## Product invariants

- Chat and provider truth remain primary. Presentation cannot invent a running,
  completed, stalled, authenticated, or usage state.
- Decorative, media, browser, observatory, pacing, and alert features are
  operator-switchable or capability-gated. A fresh-install presentation
  profile may initialize explicit visual settings, but they do not silently add
  model context.
- Prompts, model output, credentials, raw filesystem paths, private media
  tokens, and browser secrets stay out of decorative surfaces and routine
  telemetry.
- Browser and desktop capabilities differ. Unsupported paths fail closed and
  explain the limitation instead of imitating a privileged feature.
- User-approved local files, origins, capture streams, and accounts do not
  expand into arbitrary filesystem, network, inbox, or provider authority.

## Request coverage at a glance

| Requested area                                            | Current status              | Canonical boundary                                                                                                                                |
| --------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snow, rain, and Matrix over the whole window              | Implemented                 | Off switch, density, speed, opacity, color, motion and performance bounds                                                                         |
| Roman/Japanese Matrix mix, coding terms, 2ch and cat AA   | Implemented                 | Reviewed glyph pool; matching English/Japanese live terms; bounded safe activity labels and basenames only                                        |
| Rainbow and music-reactive Matrix color                   | Landed - validation pending | Uniform and per-string rainbow/music modes reuse direct, VLC, or one explicitly approved display-audio signal                                     |
| Matrix project-activity pulses and links                  | Landed - validation pending | Network/database/build pulses; links require explicit provider correlation and carry bounded hex-routed packets                                   |
| Movable local environment-control LLM                     | Implemented                 | Deterministic zero-token grammar first; fixed loopback LM Studio fallback only                                                                    |
| Query LM Studio models as a chat provider                 | Landed - validation pending | Explicit LM Studio instance template creates a normal Codex OSS provider instance; LM Studio remains external                                     |
| Persistent image/GIF ambience and 10 MiB limit            | Landed - validation pending | Single image plus bounded directory queue, timed/manual cycling, custom geometry and theater presentation                                         |
| YouTube video/search/playlists/text queues/skip controls  | Partial                     | Strict session queues include two public examples; the fresh profile activates the Japanese queue and requests embeddable playback                |
| Spotify connector and visualizer                          | Partial                     | Official Embed plus explicit display-audio visualization; no Spotify library/search/account browser                                               |
| Cinema layout and video behind/alongside chat             | Partial                     | Club Code Cinema retains project/chat rails; native iframe fullscreen remains player-owned                                                        |
| Adaptive TV-style media glow                              | Landed - validation pending | YouTube uses bounded artwork; approved direct/VLC video uses bounded live frames; live iframe pixels remain unavailable                           |
| Broad local formats through installed VLC                 | Landed - validation pending | Bounded picker-owned queues, previous/next, one-child playback, failure skip, and cleanup; no network stream or raw VLC args                      |
| Hundreds of Winamp-like visualizations                    | Implemented                 | Spectrum plus 395 local Butterchurn/MilkDrop presets                                                                                              |
| Current local title with filename fallback                | Implemented                 | Current item uses a bounded sanitized filename without extension; rich embedded metadata extraction is not claimed                                |
| Workflow graph, elapsed/activity, and stall hints         | Landed - validation pending | Existing semantic cards remain; graph edges and “possibly stalled” hints use only provider evidence                                               |
| Complete sub-agent/provider activity coverage             | Partial                     | Supported projections show reported hierarchy/activity, but providers do not expose every event                                                   |
| Live read-only file/SQLite panes and bounded diffs        | Landed - validation pending | Visibility-aware polling, capped line changes, and primary-key-proven row changes                                                                 |
| Per-agent file/DB focus and writer attribution            | Partial                     | Explicit provider-observed file focus exists; coverage is incomplete and DB writer remains unknown                                                |
| Agent-operable embedded browser                           | Landed - validation pending | Codex/Claude get a bounded supervised DOM tool grant; provider secret/OTP entry remains unavailable                                               |
| Pixel OCR/image recognition                               | Not implemented             | DOM/accessibility text exists, but there is no screenshot or pixel-recognition worker                                                             |
| Inbox email-code retrieval                                | Not implemented             | The operator-only transient secret field is not an inbox connector or 2FA automation                                                              |
| Persistent Auto Nudge                                     | Landed - validation pending | Optional one-thread background ownership is completion-event-only with a hard round cap, durable dedupe, visible history, and stop/pause controls |
| Usage windows and Model Pacing                            | Partial                     | Reported windows and advisory pacing exist; no autonomous routing or spend scheduling                                                             |
| Ultra Caching and hierarchical summaries                  | Partial                     | Stable handoffs and earlier compaction exist; no persistent multi-level summary index                                                             |
| Auditor-as-fixer workflow                                 | Partial                     | Installable cross-project skill exists; Club Code does not automatically enforce or orchestrate it                                                |
| Tokens-saved meter per model                              | Partial                     | Honest provider cache/compaction counters exist; exact counterfactual savings cannot be measured                                                  |
| Completion ping, English/Japanese speech and stereo order | Partial                     | Windows exact installed voices support the complete path; no bundled voice pack or full cross-platform parity                                     |
| Whole-window KDE-like transparency                        | Partial                     | Capability-gated whole-window opacity is validated on Windows; Linux/KDE parity is absent                                                         |
| Chat file picker defaults to all files and accepts `.txt` | Implemented                 | Text is visibly imported into the prompt; unsupported arbitrary files remain rejected                                                             |

## Active delivery additions - final composite validation pending

These additions are present in the working tree and therefore belong in the
canon. Their independent audit/repair evidence is recorded in the project plan,
but the status label above remains intentionally provisional until the full
repository gates finish.

### Matrix color, approved audio, and project telemetry

Matrix has five explicit color modes:

- **Fixed** uses the selected color.
- **Rainbow** advances one uniform hue for the full rain field.
- **Rainbow Extra** gives each falling string a stable independent phase in the
  same bounded rainbow clock.
- **Music reactive** applies one uniform hue response to a bounded,
  session-only audio envelope and coarse bass/mid/treble/beat features.
- **Music reactive - Rainbow Extra** uses those same bounded features while
  retaining stable per-string phases.

Direct media and VLC reuse the renderer-owned media analyser. YouTube and
Spotify may reuse only the one display-audio stream the operator explicitly
approved for the visualizer. Club Code does not open a second capture, use the
microphone, extract iframe audio, retain PCM/frequency bins/history, or persist
the signal. Signal loss, source replacement, capture stop, staleness, and
teardown clear the reactive state.

The optional **Provider activity links** layer turns only safe,
provider-observed network, database, and build/compile categories into brief
Matrix pulses. The master switch retains three independent checkboxes:
**Network / web**, **Database / query**, and **Build / compile**. All three
category inputs default on when absent so older settings retain their behavior;
clearing all three produces no activity events, pulses, or links. At most 24
recent category/hash events and eight simultaneous links are retained, and
visual state expires after roughly 2.2 seconds. A pulse may exist without a
line. A line exists only when two events have the same category and exact same
provider-reported item or tool identity. A shared agent, operation label,
dependency label, temporal proximity, or similar wording is not enough.

Connected falling strings use reviewed semantic pairs—NETWORK/FETCH,
DATABASE/QUERY, BUILD/COMPILE, or fixed Japanese counterparts according to the
string's existing language assignment—rather than random glyph meaning or raw
provider identifiers. Routes use horizontal and +/-60-degree hex-grid segments.
A packet travels over the total polyline length with a short fading trail. Each
route, packet, and trail shares one deterministic hue in Random mode, while a
glyph shared by multiple routes renders once using its newest attached route's
hue. Matrix mode follows the selected Matrix palette and interpolates between
independently cycling endpoint colors. Activity marks use the same configured
opacity cap as Matrix glyph heads and remain legible until a short terminal
fade; no activity draw raises its canvas alpha above that cap.
Reduced-motion removes packet
travel, rapid flashes, and continuously repainted fading while retaining the
same static route until its bounded expiry. Full-screen opacity, event/link
counts, lifetime, and frame work remain capped.

The telemetry projection never retains or draws prompts, model output, command
text/output, URLs, request bodies, SQL text/values, credentials, cookies, raw
paths, raw audio, hidden operating-system traffic, or hidden reasoning. If a
provider does not report that same-category item/tool relation, the rain does
not claim it.

### Ambient image directory cycling

The original single-image path remains. On capable desktop renderers the
operator may also select a directory through a file-handle picker. Club Code
scans at most 128 entries, accepts at most 24 validated PNG/JPEG/GIF/WebP
assets totaling at most 80 MiB, applies the ordinary 10 MiB per-file ceiling,
and sorts deterministically. The 160 MiB local profile quota permits an old and
a replacement maximum 80 MiB cycle to coexist only for the transactional upload
and settings-write rollback window; request, image-validation, and concurrency
bounds remain separate. Directory and relative paths
are transient selection data: they are not stored, logged, displayed, or sent
to a provider. Content-addressed authenticated assets are the only persistent
references.

Cycling remains off until explicitly enabled. The interval is bounded from
three seconds to one hour, with manual previous/next controls. Floating preset
and custom mouse/keyboard geometry remain available. **Theater** uses the chat
media surface as a contained blurred-backdrop presentation rather than granting
the image arbitrary window or filesystem authority. Reduced-motion,
hidden/unfocused GIF suspension, replacement rollback, deduplication,
reference-aware deletion, and orphan cleanup remain part of acceptance.

### Provider selection and operator observatories

Settings > Providers offers **LM Studio** as an explicit local template. It
creates an ordinary custom Codex provider instance with `ossMode: true`, a safe
unique routing ID, and local-only explanatory copy. It does not bundle LM
Studio, imply cloud authentication, or change a normal Codex instance.

The Workspace Observatory refreshes only an open pane while its dialog and
document are visible, supports pause/resume and a bounded one-to-five-second
cadence, and discards stale in-flight responses. Optional live code changes are
off by default and retain only the latest capped line diff. SQLite row diffs
name added/removed/changed rows only when a complete, non-redacted declared
primary key proves identity; otherwise the UI says only that the snapshot
changed. Row writer attribution remains unknown. Agent colors and follow-file
actions use explicit provider observations; temporal database correlation is
labeled as correlation, not authorship.

The Workflow Observatory retains its accessible list and adds an optional
pan/zoom node-edge view. It draws an edge only for an explicit parent ID already
present in the bounded provider projection. Missing parents, cycles, and
unreported dependencies remain visibly unknown rather than being inferred from
timing, labels, or hidden reasoning.

### Direct/VLC adaptive edge glow

The local-media player retains its fixed operator-selected glow and adds an
explicit **Adaptive video edges** mode for a picker-approved direct or VLC video.
Only the exact current renderer `HTMLVideoElement` may be sampled. A temporary
32-by-18 canvas reads one current frame at a 750 ms cadence, derives four edge
colors, then immediately clears the canvas. It does not retain frames, pixels,
paths, file bytes, palettes, or history; start a capture; or add anything to
provider context.

Sampling stops while the document is hidden, when the player is torn down or
replaced, and whenever background presentation hides the glow. Reduced-motion
uses a static current palette rather than continuous sampling. Unready,
cross-origin-tainted, or denied frames fall back immediately to the fixed color.
Automatic fallback retries stop after three consecutive misses and resume only
for explicit media activity. This capability does not make live cross-origin
YouTube iframe pixels readable.

### Bounded local/VLC queues

Direct browser media and the installed-VLC lane accept a picker-owned queue of
at most 64 files and 64 GiB total for the current renderer session. Selection
does not store paths. The renderer receives only the current safe title, media
kind, zero-based index, total count, and—on VLC—the opaque queue session plus a
separate per-item playback URL. The stable queue token and rotating playback
token are never interchangeable.

Previous, next, manual skip, ended auto-advance, and error skip use one bounded
pass rather than an endless retry loop. A one-item queue may replay after a
normal end, but one failed item stops. Direct playback creates one current
`blob:` URL at a time. VLC launches one child at a time and invalidates the
previous playback token before adopting the next item. Stale picker/navigation
results and malformed desktop responses fail closed.

The current title is a sanitized, bounded filename without its extension.
Club Code does not claim embedded metadata extraction. Object URLs, VLC
children, active protocol requests, private launch files, loopback state, and
tokens are cleaned on navigation, replacement, clear, owner destruction, and
desktop shutdown. The desktop queue rejects duplicates, symlinks, devices,
directories, and other non-regular entries; the browser queue rejects
MIME/extension mismatches instead of treating arbitrary files as media. Broad
extensions are attempted through the browser with a visible VLC fallback;
neither path is a universal codec guarantee.

### Provider-callable supervised browser bridge

An operator may grant Codex or Claude temporary access to the existing isolated
browser tab. A grant is bound to the exact live Club Code thread, provider
instance, browser tab, and canonical credential-free HTTP(S) origin. It
defaults to five minutes, is bounded from one to ten minutes, admits at most 40
requests with a four-request queue and 90-second action timeout, and remains
revocable in the browser UI.

The provider tools expose compact redacted DOM/accessibility snapshots,
fresh-snapshot clicks, non-sensitive typing, same-origin navigation, back,
forward, reload, and stop. Every renderer action still crosses the existing
native per-action approval. Popups, downloads, screenshots, pixel OCR, cookies,
storage, credentials, one-time codes, CAPTCHA controls, sensitive fields,
cross-origin navigation, URL userinfo, unsafe schemes, and remote-to-loopback
pivots remain unavailable.

The MCP listener is ephemeral loopback-only. Its 256-bit bearer, exact identity
headers, grants, queues, typed values, and results are process memory only and
never enter provider settings, process arguments, ordinary logs, or the durable
provider command ledger. Revocation occurs on operator action, tab/origin/share
change, thread/provider change, expiry, request limit, interrupt/stop, provider
restart, or shutdown. Completion rechecks tab/origin identity before returning
a result. OpenCode remains unavailable until it has an equally safe ephemeral
per-session injection path.

### Bounded background Auto Nudge

Ordinary Auto Nudge remains a foreground once-per-terminal-turn feature. A
separate default-off option may give exactly one explicitly chosen thread an
app-level background continuation owner, so leaving chat for Settings does not
unmount its controller. The exact operator-approved prompt is dispatched
immediately only when a new provider-confirmed response completes.

One background run defaults to five automated rounds and is configurable only
within a hard limit of 1–20 rounds. The control exposes pause, resume, stop,
ownership transfer, restart, and a bounded 40-entry ledger. Every dispatch is an ordinary visible
`thread.turn.start` user message; sent entries retain only its normal message
ID and terminal-turn key.

The terminal turn is consumed before transport, and the durable sent ledger
prevents reload or full-app restart duplication. A persisted expected-message
timestamp spans the transport/projection gap; if that exact user row does not
appear within 60 seconds, the controller pauses for operator recovery. Manual
composer/send/steer activity, offscreen drafts, renderer queues, approvals or
user input, provider/transport trouble, missing or archived ownership,
settings disable/stop, and either hard cap win over automation. Every supported
background dispatch first acquires an exclusive `navigator.locks` gate and
reloads durable state while holding it. Contention sends nothing and retries on
a later bounded tick. Missing support pauses/fails closed and disables/explains
the control; a rejected lock request also pauses rather than risking a cross-tab
duplicate. Backward-clock input and stale async rejection callbacks also fail
closed. This is not an endless hidden worker or a second fan-out scheduler.

## Implemented behavior and exact boundaries

### Fresh-install presentation profile

When `client-settings.json` does not exist, Club Code writes one explicit
operator-inspired first-run profile. This is separate from conservative schema,
malformed-document recovery, and compatibility defaults. An existing settings
file is never replaced by the first-run profile. It does not copy onboarding
completion, project or thread identity, local paths, provider/account state,
capture state, custom session geometry, or any other operator-specific runtime
state into repository defaults.

The main desktop window opens maximized on every launch. This is the main-window
launch default because this checkout does not persist outer-window geometry or
have a fresh-profile signal at that boundary. Native whole-window transparency
remains disabled and therefore effectively opaque; `0.84` is the
missing-setting/reset slider value if the operator later enables the
capability. An existing explicit desktop setting remains untouched.

The first-run Client Settings profile contains these explicit presentation
values:

- Matrix is enabled in regular uniform `rainbow` mode at `0.55` opacity, speed
  `4`, density `2.5`, and Japanese ratio `0.45`. Rainbow Extra remains
  selectable but is not the first-run mode. 2ch enrichment, bounded live-work
  vocabulary, all three activity-link category inputs, activity links, and
  Matrix-colored link routes are enabled.
- The ambient-video surface is enabled with a null source, custom layout with
  bottom-right/large as its preset fallback, floating presentation, and
  adaptive auto glow at `0.65`. The bundled Japanese URL example becomes the
  active session-only queue and requests autoplay of its first accepted item.
  The source remains null and is not persisted; browser/YouTube policy or item
  availability may still prevent playback.
- The bundled ambience GIF is seeded into the managed ambient store and starts
  bottom-left/large/floating with auto glow at `0.35`.
- Workflow Observatory, the provider usage widget at a two-minute poll, and
  advisory Model Pacing with a 5% reserve are enabled.

These settings remain independently editable and can be disabled. Default-on
live-work terms and activity links still use only the bounded and sanitized
provider evidence defined below; they do not expose prompts, output, commands,
SQL, URLs, secrets, raw paths, or unreported activity.

### Full-window atmosphere

Snow, rain, and Matrix effects cover the Club Code viewport without receiving
pointer input. Controls include off/on, effect kind, fixed color, opacity,
speed, density, and a 0-100% Roman-to-Japanese Matrix stream mix. The same ratio
selects English or Japanese switchable live terms. The Matrix pool contains
reviewed coding-flavored kana and kanji. Optional 2ch-inspired glyphs and intact
cat AA apply only to Japanese streams. Their conservative
compatibility/recovery default is off; the explicit fresh-install profile
enables them, and the operator can disable them independently.

Matrix color has five modes:

- Fixed uses the chosen color.
- Rainbow cycles one uniform hue on the bounded atmosphere animation clock.
- Rainbow Extra gives each falling string an independent stable hue phase.
- Music reactive uses a bounded live audio envelope and coarse frequency/beat
  features as one uniform color response.
- Music reactive - Rainbow Extra applies the same bounded signal with
  independent per-string phases.

Music modes use direct/VLC media or reuse the visualizer's one explicitly
approved YouTube/Spotify display-audio stream. A stale, stopped, replaced, or
absent signal safely falls back to the fixed color.

Live-work vocabulary is also off in conservative compatibility/recovery
defaults and enabled by the explicit fresh-install profile. It accepts only a
bounded set of fixed operation labels and safe basename-only filenames from
explicit provider-observed activity. It excludes summaries, prompts, file
contents, command output, raw paths, dotfiles, secret-looking names, and
high-entropy identifiers, and the operator can disable it independently.

Canvas DPR, pixels, particles, token width, and frame delta are bounded.
Reduced motion disables animation. The normal background policy pauses it while
hidden or unfocused unless the operator explicitly allows background animation.

### Atmosphere Console and local models

The movable/resizable Atmosphere Console defaults to an open, viewport-clamped
custom rectangle at `x=321`, `y=280`, `width=622`, and `height=477.5`. It also
supports corner anchors plus custom geometry. Its deterministic parser handles
a fixed atmosphere, Matrix, media transport, and visualizer grammar locally.
Normal commands use no model tokens.

The optional language fallback sends one bounded control sentence to an LM
Studio-compatible endpoint at `127.0.0.1:1234`, with short timeout, bounded
response, and strict allowlisted JSON. It receives no chat, project, file,
provider-session, or credential context, cannot invent a media URL, and has no
cloud or paid-provider fallback.

Separately, Codex settings expose LM Studio mode for full chat/provider work.
That mode starts the Codex app server with its supported OSS local-provider
arguments, skips cloud account requirements, and uses the local LM Studio
provider. The lightweight Atmosphere Console path and the full provider path
are distinct features.

### Ambient image and GIF

PNG, JPEG, WebP, and GIF assets are validated and limited to 10 MiB. They
support lower-corner presets, small/medium/large sizing, custom drag and
keyboard resize, optional glow, collision-aware layout, reduced motion, and
background policy.

An accepted ambient image is stored in the server's ambient asset store and
referenced by Client Settings. It is therefore persistent, unlike local media
object URLs, URL queues, and display-capture streams. Replacing or clearing it
must retire the previous managed asset without exposing its storage path.

The single-image path remains available. A desktop directory selection may
create a bounded, content-addressed cycle queue with deterministic order,
manual previous/next controls, a three-second-to-one-hour interval, and
floating or Theater presentation. Source paths are transient selection data
and are never persisted or shown.

### YouTube, Spotify, and presentation

YouTube accepts a validated supported video or playlist URL. Public search is
available only when the backend has server-side YouTube Data API
configuration. An optional owner-local OAuth/PKCE flow discovers playlists
within its granted scope. Club Code does not collect the account password.

A `.txt` YouTube URL queue is session-only, bounded by bytes, lines, items, and
validated URL forms. It supports previous, next, manual skip, and one bounded
pass over unavailable items. It does not bypass embedding, regional, privacy,
age, account, or owner restrictions.

Two exact public example files are committed and selectable in Settings:

- `examples/youtube-url-queues/JPMusic.txt` contains 39 supplied URL lines. The
  strict parser accepts 36 and reports three malformed 10-character video IDs.
- `examples/youtube-url-queues/EDMYoutubeList.txt` contains 20 supplied URL
  lines. The strict parser accepts 19 and reports one malformed 10-character
  video ID.

These source-line totals and accepted queue totals are deliberately distinct.
For an untouched session whose persisted ambient-video source is still unset,
Club Code initializes the session queue from the Japanese example.
For the branded fresh profile, the enabled video surface activates that queue
and requests autoplay of its first accepted item. Initialization does not set a
persisted source or write the parsed queue into Client Settings, and it does not
overwrite an existing ambient-video source. Browser policy, YouTube policy,
embeddability, or item availability may prevent playback. A manual clear or
explicit queue/source choice prevents the automatic default from returning
during that session. The committed examples remain public repository assets;
their parsed runtime queues remain session-only.

The strict-origin iframe bridge exposes only the required transport and
playlist navigation commands. Spotify uses the official Embed for normalized
supported entity types and IDs. Spotify owns authentication, DRM, entitlement,
and playback.

Floating presentation provides left/right presets, small/medium/large sizing,
custom geometry, optional glow, and collision-aware layout. Club Code Cinema
keeps projects at left, video in the center, and chat at right when the window
can support it. Local/VLC video may act as a controlled background behind Club
Code surfaces. Native YouTube iframe fullscreen is separate and player-owned;
Club Code cannot keep its project/chat rails inside that fullscreen surface.

Glow has a fixed mode and an adaptive YouTube mode. Adaptive YouTube glow
validates the current video ID, loads a bounded CORS-capable thumbnail from the
approved YouTube image host, downsamples it, extracts an edge palette, and
applies a multi-edge CSS glow. Failure falls back to the fixed color. This is
artwork-derived ambience, not sampling of live cross-origin iframe pixels.

### Direct local media and desktop VLC

Direct Local Media is browser playback of a user-selected file and is
session-only. Desktop **Open with VLC** locates an installed VLC executable
from fixed platform locations or an absolute `CAFE_CODE_VLC_PATH`, then
transcodes a picker-approved current queue item through a private tokenized
loopback session. Direct and VLC queues are capped at 64 items and 64 GiB total.
The renderer receives a bounded sanitized display title using the filename
without its extension; embedded metadata is not currently parsed.

This path supports VLC-decoded formats such as FLV, MKV, AVI, WMA, and
transport streams without exposing the original path or arbitrary VLC
arguments to the renderer. Previous, next, manual skip, ended auto-advance, and
bounded failure skip are available in floating, Cinema, and reachable
background controls. The renderer holds a stable opaque queue session ID and a
different rotating playback token; it never receives the native path. Only one
browser object URL or VLC child is current. Replace, clear, owner teardown, and
shutdown clean up object URLs, VLC, requests, temporary files, tokens, and the
loopback port.

For video, the optional adaptive glow downsamples only that already approved
current renderer frame into a 32-by-18 transient canvas at a bounded cadence.
It pauses when hidden or visually inapplicable, clears on teardown, and uses
the fixed glow after an unready or denied sample. No frame or palette is
persisted, logged, or sent to a model.

The implementation does not provide embedded metadata extraction,
network-stream entry, arbitrary VLC playlists/arguments, or a universal codec
or media-success guarantee.

### Audio visualization

The renderer ships a spectrum mode plus a lazy local
Butterchurn/MilkDrop-compatible catalog of 395 deduplicated presets. It
supports search, previous, random, next, timed cycling, and blend controls.

Direct and VLC media use a renderer-owned media element. YouTube and Spotify
require an explicit Chromium display-media selection of a tab, window, or
system audio source. There is no microphone fallback, direct iframe audio
extraction, recording, upload, or invisible capture. Stopping the share tears
down analysis. Club Code does not claim a native projectM engine or arbitrary
third-party preset import.

### Workflow and workspace observatories

Workflow Observatory projects provider-reported plans, activities, agent
hierarchy, elapsed duration, recent events, and evidence-based "possibly
stalled" wording into semantic cards. Silence is not treated as hidden
reasoning or a fabricated lifecycle state.

The semantic list remains the default accessible view. An optional pan/zoom
node-edge graph draws only explicit parent relationships in the same bounded
projection. Missing parents and cycles remain unknown. It does not calculate a
critical path or expose hidden reasoning.

Workspace Observatory is a full-window, environment-scoped, read-only view of
a contained project tree, bounded/redacted text, verified read-only SQLite
tables, and up to eight manually tiled panes. It permits no arbitrary SQL,
hidden filesystem traversal, database mutation, or automatic model-context
injection.

Open panes can refresh at a bounded one-to-five-second cadence only while the
dialog/document is visible, with pause/resume and stale-response rejection.
Optional line changes are off by default and capped. Agent-colored file focus
and follow-file consume only explicit safe `providerObserved` telemetry;
providers still do not report every edit. SQLite panes may show bounded
snapshot/row differences only when a complete declared primary key proves row
identity. They never attribute a row/write to an agent. The viewer remains
read-only rather than a full editing IDE.

### Supervised embedded browser

Desktop provides one temporary sandboxed browser view with Node disabled,
blocked popups/downloads, exact-origin sharing, and native approval before
assisted snapshot, click, or type. DOM/accessibility capture is compact,
redacted, editable, and memory-only until the operator chooses a draft handoff.
A user may enter a credential or one-time code into a transient sensitive
field; it is not put into a prompt or routine log.

An explicit grant now exposes a bounded provider-native tool to the exact live
Codex or Claude thread and provider instance. It is also bound to the current
tab and canonical HTTP(S) origin, uses a process-only bearer, and retains
native per-action approval. It supports redacted DOM/accessibility snapshot,
fresh-target click, non-sensitive type, same-origin credential-free navigate,
history, reload, and stop. OpenCode is unavailable. Exact caps and revocation
conditions are defined in the active-delivery section above and
`docs/embedded-browser-security.md`.

There is still no pixel OCR engine, screenshot tool, mailbox connector,
automatic email-code retrieval, secret-bearing provider type path, CAPTCHA
solver, or 2FA bypass. Image `alt`/`title` and DOM text are not represented as
pixel recognition. DNS rebinding by a same-origin hostname remains a Chromium
platform residual risk because this boundary cannot pin an origin to its
resolved IP; scheme, userinfo, cross-origin, and localhost-origin pivots are
still denied.

### Auto Nudge, usage, pacing, and efficiency

Auto Nudge is a durable per-device preference. Exactly once per newly completed
provider-confirmed terminal turn, it may immediately send the selected
operator-approved Steady Progress or Hardcore Fanout prompt. No timer,
countdown, elapsed-time cap, or wall-clock transition can authorize a prompt.
Dispatch is foreground-only for the visible chat unless the operator separately
enables bounded background continuation and explicitly assigns its single owner.

With background continuation, the app-level controller survives chat/settings
navigation and reload, defaults to five rounds, and cannot exceed 20 rounds.
Its normal-history messages, dedupe, fail-closed projection acknowledgement,
exclusive cross-tab Web Lock, pause/resume/stop/transfer controls,
durable 40-entry ledger, and stop conditions are defined above. Unsupported or
denied locking makes background continuation unavailable. Auto Nudge is not an
immortal background agent, an all-chat scheduler, or unbounded fan-out.

The optional top-left/sidebar Usage widget polls provider-reported Codex and
Claude windows at the configured one-to-five-minute cadence. It shows a meter,
remaining allowance, and reset timing only when the provider exposes them.
Model Pacing compares reported allowance, reset time, and an operator reserve.
It is advisory and does not silently switch models, schedule agents, or spend
quota.

The efficiency display reports available cache-read, cache-write, and observed
compaction data by driver/model. It is not an additive billing estimate. An
exact "tokens saved" counter requires a provider-supplied counterfactual
baseline that current providers do not expose; Club Code must not fabricate
one.

Ultra Caching uses stable provider-specific prompt structure, compact handoffs,
and an earlier Codex compaction ceiling. It does not implement a persistent
multi-level summary tree, semantic memory retrieval service, or guaranteed
token reduction.

The bundled `audit-and-repair` skill can be installed safely into supported
Codex and Claude provider configuration homes for cross-project use. It tells
an auditor to repair and verify findings in the same context. It is not an
automatic Club Code policy engine, cannot guarantee a second model is
available, and does not currently orchestrate repeated independent audit
rounds.

### Completion alerts and whole-window opacity

Completion alerts are per-device and off by default. They fire only on an
observed same-turn `running -> completed` transition, coalesce rapid updates,
and apply a cooldown. Operators may use the original low-gain two-tone ping,
cycle up to eight validated local MP3/WAV files of at most 5 MiB and 15 seconds
each, or speak only the fixed phrases `Task complete.` and
`作業が完了しました。`

English/Japanese language and gender preferences are independent. Windows
native speech requires an exact installed culture/gender voice and reports a
missing voice instead of substituting a false match. The selector prefers
Microsoft Haruka, then Ayumi, for Japanese female speech and Zira for English
female speech when installed. With matching Windows voices, Japanese and
English may play simultaneously in reversible stereo. Web Speech fallback is
centered and sequential. No prompt, response, project, filename, or thread text
is spoken.

Club Code does not bundle a "cute" Japanese voice pack. Voice installation,
licensing, package size, offline behavior, and macOS/Linux stereo parity remain
future work.

Whole-window opacity uses a bounded desktop bridge only where the native
platform/release capability proves it. Browser and unsupported Linux paths
report unavailable and do not call the native opacity API. The accepted range
is 65–100%. It is whole-window translucency, not KDE/Konsole acrylic,
per-surface blur, full invisibility, or a promise of Linux compositor parity.

### Composer file selection

The composer file picker has no restrictive `accept` filter, so the native
dialog starts with all files visible. Existing image attachments keep their
normal path. A supported `.txt` or `text/plain` file up to 256 KiB is decoded
as valid UTF-8 or BOM-marked UTF-16 and inserted visibly into the editable
prompt between bounded filename markers. The universal final-prompt ceiling of
120,000 characters still applies after import; paste and drop use the same
validation.

This is prompt-text import, not a binary provider attachment. Imported text can
be saved in the ordinary draft and enters provider/chat context if the operator
sends it. Other arbitrary file types remain unsupported and are rejected with
an explanation.

## Runtime architecture and non-functional contract

### Independent state and global disable

Atmosphere, streaming media, ambient image/GIF, direct/VLC local media,
whole-window opacity, observatories, browser tools, completion alerts, and the
Atmosphere Console are independent systems. Turning on one must not silently
enable another.

The one-action **Disable all ambient features** coordinator turns off the
backend-authoritative atmosphere, streaming panel, ambient image panel, and
desktop opacity, and clears current-document local media. It preserves saved
source choices and slider values where the setting contract calls for that.
Backend and native-opacity outcomes are reported separately. The Workflow and
Workspace observatories are operational UI rather than ambience and are not
discarded by this action.

Cross-renderer presentation intent, such as effect settings, normalized
streaming source, Cinema/floating choice, image asset, and glow preference,
uses bounded Client Settings. Device/session state includes direct local-media
selection, object URLs, playback position, URL queues, display capture, custom
geometry, active native fullscreen, browser session, and current visualizer
analysis. Native whole-window opacity remains desktop-local shell state rather
than a shared project setting.

### Layering and media lifecycle

The stable visual stack is application/media surfaces, pointer-transparent
full-window atmosphere, chat affordances, then popovers/dialogs/toasts and
shutdown overlays. Atmosphere is `aria-hidden` and cannot intercept input. A
protected Cinema player rectangle is not covered by Club Code decoration.

Streaming media uses a stable authenticated workspace host above route-specific
chat content. Project/thread changes and floating/Cinema transitions update
layout around that host instead of deliberately remounting an unchanged
iframe. Disable, source replacement, teardown, or an unrecoverable player
failure owns remount and cleanup.

Floating geometry is normalized, clamped to the measured chat pane, and
committed at the end of pointer/keyboard interaction rather than on every
pointer move. Dedicated handles own drag/resize so an iframe never has to leak
pointer ownership. Panels must remain reachable after resize, zoom, sidebar,
plan panel, and display changes.

### Source, iframe, and desktop trust boundaries

YouTube and Spotify input is parsed into an atomic normalized source. Arbitrary
iframe URLs, embed HTML, credentials, lookalike hosts, and unrecognized URL
forms are rejected. The renderer constructs only fixed official embed origins.
Production CSP/frame policy must keep those origins exact rather than allowing
a blanket `https:` frame source.

Electron retains context isolation, renderer sandboxing, disabled Node
integration, and safe external opening. Whole-window opacity, VLC, completion
speech, display capture, and the embedded browser cross typed, validated
bridges. None is a reason to enable a generic renderer filesystem/process API.

YouTube search keys, OAuth client configuration, OAuth state/verifier/code,
access/refresh tokens, and full upstream request URLs stay outside renderer
settings, activities, diagnostics, and routine errors. Ambient assets are
served through the authenticated bounded asset path. Browser and local-media
failures use stable safe codes/copy, not raw native errors or paths.

### Accessibility, responsive behavior, and resource budgets

Controls require accessible names, keyboard operation, visible focus, and
explanatory unavailable states. Mode and status cannot rely on color alone.
Reduced motion disables decorative animation and visualization work, not
operator-requested audio playback. Completion speech, graph work, and glow must
not obscure the composer, chat timeline, project rail, escape path, or native
media controls.

Responsive fit is capability, not preference mutation. If a floating player or
Cinema layout cannot fit, Club Code keeps a usable chat layout and preserves
the operator's saved presentation choice for a later larger viewport. Custom
panels remain clamped and reachable. Native fullscreen remains owned by its
player.

Long sessions must not accumulate particles, animation frames, timers,
listeners, iframes, object URLs, capture tracks, audio graphs, VLC processes,
browser views, database rows, workflow nodes, decoded images, or orphan assets.
Animation canvas size, device-pixel ratio, frame rate, particle density,
workflow/event counts, search/queue results, browser snapshots, and database
rows are bounded. Any future OCR input must be bounded separately.
Hidden/unfocused and teardown behavior is tested separately from functional
success.

### Observability and logs

Expected input/capability failures appear near the relevant control. Logs may
record feature kind, safe normalized error code, capability outcome, bounded
counts, and provider fidelity. They do not record pasted media URLs or IDs,
search queries, playback history, private playlist titles, upload filenames,
local paths/titles, browser secrets, raw workflow payloads, hidden reasoning,
file/image bytes, captured audio, FFT data, frame contents, or tokens.

No analytics or remote telemetry is added by these features without a separate
product and privacy decision.

## Remaining requested capabilities

The following requests remain on the project plan and must not be described as
complete:

1. Complete production provider telemetry coverage for agent-colored file
   focus; current providers do not reliably report every file edit or database
   row operation.
2. Add optional bounded offline pixel OCR and separately research tightly
   scoped inbox-code integration. The provider browser bridge is implemented,
   but neither extension may bypass 2FA, CAPTCHA, site policy, native approval,
   or secret-isolation boundaries.
3. Evaluate opt-in automatic Model Pacing only when provider usage data is
   trustworthy, with explicit routing rules and hard operator limits.
4. Evaluate a versioned hierarchical summary/memory index with deletion,
   leakage, accuracy, and token-quality benchmarks.
5. Add an opt-in audit workflow orchestrator that keeps the auditor as fixer
   and requests another independent model only after failed validation.
6. Evaluate Spotify account/library/search support through official APIs and
   minimal OAuth scopes.
7. Evaluate licensed/offline voice delivery, exact voice previews, and
   cross-platform dual-channel speech.
8. Perform a Linux/KDE compositor feasibility spike for safe whole-window
   opacity/blur. Unsupported Electron behavior must remain fail-closed.

## External and policy constraints

- YouTube Premium entitlement, password login, private playback, ad state, and
  embeddability are controlled by YouTube. The current account flow is playlist
  discovery only. Premium/private playback remains externally blocked unless
  YouTube provides a supported embedded-player mechanism.
- A cross-origin YouTube iframe does not expose live pixels to Club Code.
  Native iframe fullscreen is player-owned. Club Code will not pretend a
  thumbnail is a live frame or overlay its UI inside foreign fullscreen.
- Exact counterfactual tokens or dollars saved cannot be claimed without a
  provider-issued measurement source.
- Email-code support, if ever added, is an explicit connector with least
  privilege and user approval. It is not autonomous login or authentication
  bypass.

## Persistence and privacy

Client Settings use decoded defaults and bounded patches so older documents
load safely. Only the absence of `client-settings.json` selects the branded
first-run profile; existing documents are not overwritten, and malformed
documents retain the conservative recovery path. The first-run profile contains
no onboarding, project, thread, local-path, provider/account, capture, or custom
session-geometry state. Ambient image/GIF assets and their settings are
persistent.
Validated custom completion clips persist only in per-device browser storage
and never become provider context.
Direct local-media queues/object URLs, VLC playback sessions, YouTube URL
queues, display-capture streams, live audio levels, embedded-browser snapshots,
sensitive browser fields, provider-browser grants, and local control sentences
are session/process-only unless the operator explicitly transfers safe text
into another surface. Auto Nudge policy is Client Settings; its single owner,
bounded run state, and 40-entry ledger are bounded per-device browser storage.

OAuth tokens, raw local paths, VLC session tokens, browser secrets, captured
audio, browser-tool bearers/headers/typed values, prompt text, and file contents
are excluded from ordinary settings, the durable provider command ledger, and
telemetry. Provider-backed usage aggregates by driver/model rather than
configured account identity.

## Release acceptance

Before release:

1. Run repository formatting, lint, typecheck, unit, browser, and production
   desktop-build gates from the final composite worktree.
2. Run relevant desktop/native smoke tests and observe a source relaunch.
3. Verify capability gates, origin checks, capture teardown, privacy redaction,
   and failure copy for every changed privileged surface.
4. Record exact outcomes without carrying forward stale test counts.
5. Audit public documentation against this status vocabulary. A partial,
   unavailable, or externally blocked feature must remain labeled as such.
