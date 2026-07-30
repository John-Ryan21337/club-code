# Club Code Experience and Operator-Visibility Canon

Status: implementation truth for the current working checkout, not a release,
build, branch, or publication certificate. Current changes still require
proportional focused checks and the final composite release gates before any
release evidence is recorded. Several ideas from the operator request ledger
remain partial, intentionally bounded, externally blocked, or not implemented.

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
- Follow-up intent never becomes an implicit stop. Native provider steering is
  used only when the current runtime snapshot and active-turn identity prove it
  safe; otherwise the per-thread queue waits for a normal turn boundary. A
  missing, stale, or changing capability snapshot cannot interrupt provider
  work.
- Auto Nudge is terminal-event-driven, never interval-driven. Wall-clock idle
  time cannot authorize a provider call. All exact-thread operator follow-ups
  accepted by the environment server run first; only a new exact
  provider-confirmed completed turn may authorize one automated follow-up.
  Timers, countdowns, and elapsed-time caps are absent from the dispatch path.
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

| Requested area                                            | Current status              | Canonical boundary                                                                                                                                          |
| --------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snow, rain, and Matrix over the whole window              | Implemented                 | Off switch, density, speed, opacity, color, motion and performance bounds                                                                                   |
| Roman/Japanese Matrix mix, coding terms, 2ch and cat AA   | Implemented                 | Reviewed glyph pool; matching English/Japanese live terms; bounded safe activity labels and basenames only                                                  |
| Rainbow and music-reactive Matrix color                   | Landed - validation pending | Uniform and per-string rainbow/music modes reuse direct, VLC, or one explicitly approved display-audio signal                                               |
| Matrix project-activity pulses and links                  | Landed - validation pending | Network/database/build pulses; links require explicit provider correlation and carry bounded hex-routed packets                                             |
| Movable local environment-control LLM                     | Landed - validation pending | Transparent movable/resizable console; deterministic zero-token grammar first, then optional LM Studio, Codex, or Claude narrow-command interpretation      |
| Query LM Studio models as a chat provider                 | Landed - validation pending | Explicit LM Studio instance template creates a normal Codex OSS provider instance; LM Studio remains external                                               |
| Persistent image/GIF ambience and 10 MiB limit            | Landed - validation pending | Single image plus bounded directory queue, timed/manual cycling, custom geometry and theater presentation                                                   |
| YouTube video/search/playlists/text queues/skip controls  | Partial                     | Three bundled queues (Japanese, EDM, K-pop); same-name imports replace, new names add, and blocked videos skip boundedly in order.                          |
| Spotify connector and visualizer                          | Partial                     | Official Embed plus explicit display-audio visualization; no Spotify library/search/account browser                                                         |
| Cinema layout and video behind/alongside chat             | Partial                     | Club Code Cinema retains project/chat rails; native iframe fullscreen remains player-owned                                                                  |
| Adaptive TV-style media glow                              | Landed - validation pending | YouTube uses bounded artwork; approved direct/VLC video uses bounded live frames; live iframe pixels remain unavailable                                     |
| Broad local formats through installed VLC                 | Landed - validation pending | Bounded picker-owned queues, previous/next, one-child playback, failure skip, and cleanup; no network stream or raw VLC args                                |
| Hundreds of Winamp-like visualizations                    | Implemented                 | Spectrum plus 395 local Butterchurn/MilkDrop presets                                                                                                        |
| Current local title with filename fallback                | Implemented                 | Current item uses a bounded sanitized filename without extension; rich embedded metadata extraction is not claimed                                          |
| Workflow graph, elapsed/activity, and stall hints         | Landed - validation pending | Existing semantic cards remain; graph edges and “possibly stalled” hints use only provider evidence                                                         |
| Complete sub-agent/provider activity coverage             | Partial                     | Supported projections show reported hierarchy/activity, but providers do not expose every event                                                             |
| Live read-only file/SQLite panes and bounded diffs        | Landed - validation pending | Visibility-aware polling, capped line changes, and primary-key-proven row changes                                                                           |
| Per-agent file/DB focus and writer attribution            | Partial                     | Explicit provider-observed file focus exists; coverage is incomplete and DB writer remains unknown                                                          |
| Agent-operable embedded browser                           | Landed - validation pending | Codex/Claude get a bounded supervised DOM tool grant; provider secret/OTP entry remains unavailable                                                         |
| Pixel OCR/image recognition                               | Not implemented             | DOM/accessibility text exists, but there is no screenshot or pixel-recognition worker                                                                       |
| Inbox email-code retrieval                                | Not implemented             | The operator-only transient secret field is not an inbox connector or 2FA automation                                                                        |
| Persistent Auto Nudge                                     | Landed - validation pending | Exact-thread editable prompts, completion-event-only dispatch, hard round caps, durable dedupe, and Stop controls                                           |
| Idle Thread Guard                                         | Landed - validation pending | Separate opt-in running-turn silence guard; hard 1-hour floor, activity reset, one-shot fail-closed dispatch, and explicit paid-usage warning               |
| Matrix depth/perspective motion                           | Implemented                 | Full-viewport Walk spawns, bounded travel/fade, center wind, and non-overlapping font-aware spacing                                                         |
| Renderer-local Mobile optimized presentation              | Landed - validation pending | One composer toggle reuses responsive mobile branches; enabling it selects Matrix without resetting appearance, while returning to Desktop leaves Matrix on |
| Camera prompt attachments                                 | Implemented                 | Explicit camera button, front/rear switching where supported, preview-before-attach, system-camera fallback, exact-thread pinning                           |
| Local settings profiles                                   | Implemented                 | Desktop/mobile/custom profiles persist locally without copying exact-thread Auto Nudge authority or other live identities                                   |
| World clock and optional weather                          | Landed - validation pending | One-to-six-city transparent clock; weather is default-off renderer-local consent, excluded from profiles and other clients                                  |
| Transparent Project Resources monitor                     | Landed - validation pending | Movable/resizable overlay uses no timeline space; CPU/RAM/disk/network, measured temperatures, and stable per-adapter GPU/VRAM cards                        |
| Provider usage, paid/extra usage, and Model Pacing        | Landed - validation pending | Every configured provider remains visible; only provider-reported facts are shown; pacing remains advisory                                                  |
| Non-interrupting cross-provider follow-ups                | Landed - validation pending | Native live steer where explicitly supported; otherwise the per-thread queue waits and only an explicit Stop may interrupt                                  |
| Ultra Caching and hierarchical summaries                  | Partial                     | Stable handoffs and earlier compaction exist; no persistent multi-level summary index                                                                       |
| Auditor-as-fixer workflow                                 | Partial                     | Installable cross-project skill exists; Club Code does not automatically enforce or orchestrate it                                                          |
| Tokens-saved meter per model                              | Partial                     | Honest provider cache/compaction counters exist; exact counterfactual savings cannot be measured                                                            |
| Completion ping, English/Japanese speech and stereo order | Partial                     | Windows exact installed voices support the complete path; no bundled voice pack or full cross-platform parity                                               |
| Whole-window KDE-like transparency                        | Partial                     | Capability-gated whole-window opacity is validated on Windows; Linux/KDE parity is absent                                                                   |
| Chat file picker defaults to all files and accepts `.txt` | Implemented                 | Text is visibly imported into the prompt; unsupported arbitrary files remain rejected                                                                       |

## Active delivery additions

These additions are present in the working tree and therefore belong in the
canon. Source behavior and focused tests support the inventory below, but no
older build, commit, or derived artifact is evidence for unpublished working
tree changes.

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
provider-observed network, database, build/compile, and exact agent-delegation
lifecycles into brief Matrix pulses. The master switch retains four independent
checkboxes: **Network / web**, **Database / query**, **Build / compile**, and
**Agent / delegation**. All four category inputs default on when absent so
older settings retain their behavior; clearing all four produces no activity
events, pulses, or links. At most 24
recent category/hash events and 12 simultaneous links are retained, and visual
state has a persisted **Verified route visibility** control from 8 to 120
seconds, defaulting to 30 seconds. This duration only keeps an already verified
exact route and its bounded decorative packet replay visible longer; it never
creates provider activity, infers event frequency, or claims throughput.
Unpaired standalone pulses retain their fixed eight-second lifetime. A pulse
may exist without a line. A line exists only when two events have the same category and exact same
provider-reported item or tool identity. A shared agent name, operation label,
dependency label, temporal proximity, or similar wording is not enough.

Connected falling strings use reviewed semantic pairs—NETWORK/FETCH,
DATABASE/QUERY, BUILD/COMPILE, AGENT/DISPATCH, or fixed Japanese counterparts according to the
string's existing language assignment—rather than random glyph meaning or raw
provider identifiers. Routes use horizontal and +/-60-degree hex-grid segments.
Up to three evenly spaced packets repeatedly travel over each real correlated
route with short fading trails, making sparse provider events easier to see
without inventing additional activity or implying throughput. Packet trails
wrap continuously across the route boundary. The renderer uses three packets
per route through ten visible links and two at the 11- and 12-link cap, bounding
decorative packet instances to 30 per frame for Pi-class devices. Each route,
packet, and trail shares one deterministic hue in Random mode, while a
glyph shared by multiple routes renders once using its newest attached route's
hue. Matrix mode follows the selected Matrix palette and interpolates between
independently cycling endpoint colors. Activity marks use the same configured
opacity cap as Matrix glyph heads and remain legible until a short terminal
fade; no activity draw raises its canvas alpha above that cap.
The operation endpoint of up to six verified correlated routes also carries
bounded circular lettering such as `FETCH • VERIFIED •`. The ring text uses
only the reviewed operation vocabulary, the linked endpoint's existing glyph
paint (the shared route hue in random mode and its Matrix stream color in
Matrix mode), and glyph-head opacity;
standalone pulses do not receive a telemetry ring. `VERIFIED` means only that
the two safe lifecycle events share the exact provider-reported relation
identity. It does not claim that Club Code measured network throughput. A real
bytes-per-second label requires provider-observed byte counts and a trustworthy
measurement interval through a separately reviewed contract; animation cadence
is never presented as a transfer rate.
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

### Project Resources overlay

Project Resources is a bounded transparent overlay above the chat surface. It
can be moved, resized, collapsed, restored, and operated through its pointer and
keyboard geometry controls. Because it is absolutely positioned, it does not
reserve height or cut off the chat transcript layout; an operator can move it
when it visually overlaps content. Geometry remains clamped and locally
persisted.

The overlay reports host CPU and RAM, selected-project disk volume, host network
activity, and every detected GPU as a stable GPU 1, GPU 2, and so on. Each
adapter keeps its own utilization, used/total/free VRAM, measured core
temperature when available, and bounded history. Temperature cards use only
measured CPU, GPU, RAM, VRAM, storage, case/ambient, or other sensor classes;
missing sources remain explicitly unavailable and are never estimated.

Polling and Matrix-palette subscription run only while the document is visible
and the panel is expanded. The transparent frame and cards reuse the Matrix
palette, including cycling and music-responsive colors, without feeding metrics
or sensor data into model context.

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

### World clock and optional weather

The world-clock widget is disabled by default and renders as a transparent,
movable, resizable, collapsible overlay in Electron and authenticated browser
sessions. It shows one to six catalog cities with explicit IANA time zones and
offers Rainbow shimmer, Amber nixie tubes, Transparent analog, and Old-school
LED styles. Pointer and keyboard geometry stay clamped to the viewport; Shift
with an arrow key moves or resizes by one pixel. Clock ticks, Matrix-palette
subscription, and weather work stop while the document is hidden or the panel
is collapsed.

Clock enablement, style, and cities are ordinary allowlisted presentation
settings and may be captured by a local settings profile. Panel geometry and
collapsed state stay local to the renderer. Weather is a separate, default-off
renderer-local consent value. It is stripped from environment-wide settings
transport and excluded from profiles, so another renderer or profile load
cannot begin third-party weather networking.

When weather is enabled for a visible expanded panel, that renderer sends the
selected catalog coordinates in one bounded HTTPS request directly to
Open-Meteo; the renderer's network IP is necessarily visible to that service.
No prompt, project, thread, provider, account, or workspace data and no Club
Code credential are sent. Responses are limited to 64 KiB, time out after eight
seconds, remain fresh for 15 minutes, and retry failures no faster than every
five minutes. A previously cached observation retained after refresh failure is
marked stale; absent usable data stays unavailable. The widget and Settings
surface provide attribution and the current service terms. The dedicated
[clock and weather guide](./world-clock-weather.md) carries the operator-facing
privacy and commercial-use notice.

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

### Non-interrupting provider steering

A follow-up submitted while a provider turn is running is accepted as
thread-scoped intent. When the current provider snapshot explicitly advertises
live steering and the renderer can bind the request to the concrete active
turn, Club Code uses the provider's native steering path. Every supported model
on the Claude adapter, including Opus, Sonnet, and Fable, receives that input
through its long-lived streaming prompt queue; Codex uses its expected-turn
steering command.

If live steering is unsupported, temporarily unavailable, missing from a
snapshot, stale, or no longer bound to the projected active turn, the follow-up
stays in the renderer's per-thread queue. Its action remains visibly waiting
and disabled while the turn runs, then the normal queue controller sends it
after a provider-confirmed safe boundary. Capability refresh, navigation,
provider choice, and model choice cannot convert that intent into a stop.
OpenCode and any future configured provider follow the same fail-closed rule
until their adapter explicitly proves native live steering support.

Only the operator's explicit Stop control may dispatch
`thread.turn.interrupt`. Queue activation, steering fallback, Auto Nudge,
provider-status churn, renderer reconnect, and model pacing never invoke Stop
on the operator's behalf. Tests cover supported native steering,
unsupported/missing and changing capability waiting, an accessible inert
waiting control, cross-driver capability snapshots, and Claude's zero-interrupt
streaming-input path.

### Bounded background Auto Nudge

Auto Nudge is an exact-thread standing order with editable text. Each thread is
Off unless the operator explicitly enables its own policy; no prompt, mode,
limits, or background choice is inherited from another thread or project.
Minimizing its control or navigating to Settings does not disable an enabled
thread.

The built-in starting prompts are plan-driven. Steady Progress resumes current
context, reconciles the handoff/plan/canon/PR state, and keeps at most two
coherent lanes aimed at the next verifiable slice. Hardcore Fanout uses
bounded, non-overlapping parallel lanes with one owner per lane and explicit
convergence through repository gates and required independent audits. Both
assign actionable status and dependencies to Linear, durable decisions and
research to Notion, link instead of duplicating those records, refresh external
state only when relevant or stale, and include explicit stop conditions.

Dispatch is completion-event-driven. After all exact-thread operator follow-ups
accepted by the environment server have drained, only a newly observed
provider-confirmed completed-response identity may authorize one immediate
handoff. The complete queue, terminal, provider, authority, Stop, and round-cap
gates are re-read before transport. No timer, countdown, elapsed-time cap, or
wall-clock transition can create eligibility.

One thread policy defaults to five automated rounds and is configurable only
within a hard limit of 1–20 rounds. Every
dispatch is an ordinary visible user message. The terminal turn is consumed
before transport, and durable exact-thread state plus a bounded client ledger
prevent reload, route, and multi-window duplication. Manual composer activity,
accepted or in-flight FIFO follow-ups, approvals or user input, provider
trouble, archive/delete, explicit Stop/Off, and either hard cap all outrank
automation. Unsupported coordination fails closed. Auto Nudge never interrupts
running work and is not an endless hidden worker or a second fan-out scheduler.

The dispatching renderer can inspect its own exact-thread composer draft. An
unsent draft or pre-acknowledgement intent on another device is not server
state, so it cannot reserve FIFO priority until the environment server accepts
it. The Emergency Stop suppression barrier is durable across browser ports on
that host and requests Stop for known connected threads; it is not an
automatically shared server-global signal across unrelated machines.

Each automated follow-up is a real provider request and may consume tokens,
credits, or paid usage quickly. Provider charges remain the operator's
responsibility and Club Code cannot reimburse them. Conservative caps,
carefully scoped exact-thread prompts or skills, and active monitoring
(including the LAN web UI on a phone) are strongly recommended. Unattended
overnight use should be enabled only when the operator accepts that cost risk.

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

- Matrix is enabled in regular uniform `rainbow` mode at `0.55` opacity, falling
  speed `4`, color-cycle speed `1` (the original 18-second cycle), density
  `2.5`, and Japanese ratio `0.45`. Rainbow Extra remains selectable but is not
  the first-run mode. 2ch enrichment, bounded live-work vocabulary, all four
  activity-link category inputs, activity links, and Matrix-colored link routes
  are enabled.
- The ambient-video surface is enabled with a null source, custom layout with
  bottom-right/large as its preset fallback, floating presentation, and
  adaptive auto glow at `0.65`. The bundled Japanese URL example becomes the
  active session-only queue and requests autoplay of its first accepted item.
  The source remains null and is not persisted; browser/YouTube policy or item
  availability may still prevent playback.
- The bundled ambience GIF is seeded into the managed ambient store and starts
  bottom-left/large/floating with auto glow at `0.35`.
- Workflow Observatory is enabled. Provider Usage and advisory Model Pacing
  remain off until the operator enables them; their prepared values are a
  two-minute poll and a 5% reserve.

These settings remain independently editable and can be disabled. Default-on
live-work terms and activity links still use only the bounded and sanitized
provider evidence defined below; they do not expose prompts, output, commands,
SQL, URLs, secrets, raw paths, or unreported activity.

### Full-window atmosphere

Snow, rain, and Matrix effects cover the Club Code viewport without receiving
pointer input. Controls include off/on, effect kind, fixed color, opacity,
falling speed, density, and a 0-100% Roman-to-Japanese Matrix stream mix. Matrix
also has an independent persisted `0.25`-`64` color-cycle multiplier: `1`
preserves the original 18-second rainbow while the highest values provide a
rapid shimmer without increasing particles or per-frame draw work. The
multiplier drives Rainbow and Rainbow Extra hue motion and the continuous hue
drift of music-reactive modes; beat impulses retain their signal-defined size.
Matrix-colored activity links, packets, endpoints, and telemetry lettering use
the same resolved color frame. The same language ratio selects English or
Japanese switchable live terms. The Matrix pool contains reviewed
coding-flavored kana and kanji. Optional 2ch-inspired glyphs and intact cat AA
apply only to Japanese streams. Their conservative
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

Matrix Walk Forward and Walk Reverse each start a lifecycle at a randomized
point anywhere in the visible viewport. The display coordinate wraps at the
viewport boundary while lifecycle progress remains independent, so every
stream still falls exactly the operator-selected percentage of page height
before fading and reconnecting. Walk Forward grows from the selected start
font to the end font; Walk Reverse traverses those endpoints in reverse.
Outward center wind remains proportional to distance from the screen center.
Trail line height follows the resolved glyph size, and large endpoint settings
select an evenly distributed subset of the fixed stream pool with enough
projected column width to prevent glyph overlap. Verified Walk connectors attach
at each glyph's current scaled edge instead of crossing its center, and their
bounded stroke and packet depth interpolate between differently sized
endpoints. Non-Walk connector geometry does not inherit this trimming.

The falling-effects renderer is currently Canvas2D. It requests a
desynchronized context and isolates each full-window canvas as a compositing
layer, while runtime diagnostics report `canvas2d`, browser-managed
acceleration, main-thread text rasterization, and whether worker
`OffscreenCanvas` is available but inactive. Those hints can reduce presentation
queueing and compositing cost, but they are deliberately not described as
guaranteed GPU rendering. Matrix glyph shaping/rasterization and per-stream
layout remain CPU/main-thread work; moving that work to an OffscreenCanvas
worker or a WebGL glyph-atlas renderer is a future architectural lane because
the existing cinema/console copies and focus/reduced-motion lifecycle must keep
one animation owner and a Canvas2D fallback.

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

The console uses a transparent themed surface and has a persisted,
renderer-local visibility switch. The compatibility default remains on for
settings documents created before the switch existed. Turning it off unmounts
the console rather than hiding it, so its pointer/resize listeners are removed
without writing the choice to a connected environment server. When Matrix is
selected, a pointer-transparent canvas copies only the console rectangle from
the already rendered glyph bitmap, before activity links are drawn. It
therefore places Matrix glyphs over the console without intercepting controls,
obscuring other surfaces, or rendering the particle scene a second time. The
lifted copy has an additional 40% surface-opacity cap so maximum atmosphere
opacity cannot overpower console text and controls.

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
keyboard move/resize, touch-safe labeled handles, optional glow,
collision-aware viewport clamps, reduced motion, and background policy. Custom
geometry remains normalized and renderer-local. The image overlay is absolute
and contributes no chat-manuscript height; disabling it unmounts the panel and
stops its cycling timer and window listeners.

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

Three exact public example files are committed and selectable in Settings:

- `examples/youtube-url-queues/JPMusic.txt` contains 77 supplied URL lines. The
  strict parser accepts 71 unique items, reports three duplicates, and reports
  three malformed 10-character video IDs.
- `examples/youtube-url-queues/EDMYoutubeList.txt` contains 31 supplied URL
  lines. The strict parser accepts 30 and reports one malformed 10-character
  video ID.
- `examples/youtube-url-queues/KPOPList.txt` contains eight supplied URL lines,
  all eight of which are accepted.

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

Auto Nudge is durable exact-thread policy with operator-editable standing-order
text. It may send at most once for each new provider-confirmed terminal turn,
only after the exact thread's server-accepted FIFO operator work has drained
and all safety gates remain true at handoff. No timer tick or idle wall-clock
passage may generate a provider request without a new completed-response
identity.

Background continuation survives chat/settings navigation and reload, defaults
to five rounds, and cannot exceed 20 rounds. Its visible
normal-history messages, exact-thread dedupe, server-side revision/turn
serialization, Stop control, and fail-closed conditions are defined above.
Auto Nudge is not an immortal background agent, an all-chat scheduler, or
unbounded fan-out.

The optional top-left/sidebar Usage widget is default-off and requires an
operator to enable it. It lists every configured provider
instance, including disabled, unavailable, unauthenticated, unsupported, and
no-data states. While Club Code is visible it polls only authenticated instances
that explicitly declare account-usage support, at the configured
one-to-five-minute cadence. The server enforces a per-instance cooldown, so
staggered windows or tabs cannot multiply provider subprocesses; repeated
manual refreshes inside that cooldown reuse the last result. A failed or
malformed refresh retains the last known-good provider snapshot. Plan windows
and paid facts carry their own observation time, so a fresh live rate event
cannot re-date an older weekly window or paid balance. Old values remain
visible only with a stale label.

Codex usage uses the supported account-usage path and may include plan windows,
an exact provider-formatted paid-credit balance, spend used/limit,
provider-reported remaining percentage, and reset time. Amount strings are
opaque: Club Code does not prepend a currency, convert units, or infer that an
unlabelled number is dollars.

Claude plan and extra-usage polling is experimental and is offered only for
the documented `pro`, `max`, `team`, and `enterprise` subscription auth types
on Claude Code 2.1.216 or newer. API-key, Bedrock, Vertex, older CLI, unknown
identity, and unsupported sessions are not refreshable. Each poll creates a
separate bounded, no-prompt Agent SDK query, waits only for initialization and
the structured usage control response, strictly reduces it to plan windows and
extra-usage facts, binds those facts to the already checked account identity,
and tears it down. It never reuses, steers, pauses, resumes, or interrupts an
active chat Query. The upstream control internally scans local Claude
transcripts to calculate behavior attribution; enabling Provider Usage is
therefore explicit consent to that provider-side scan. Club Code discards the
behavior result and retains no transcript-derived detail. Claude may report extra usage used,
monthly limit, utilization, and an explicit currency; it does not report a
separate current paid balance, so the widget says that the balance is not
reported instead of deriving one. Session cost estimates, transcript behavior,
skills, account identity, and raw control payloads are discarded. Account
switches, unknown identity, and unsupported SDK/CLI pairs fail closed and leave
no usage attached to the wrong account.

Providers such as OpenCode that expose no account-usage source remain visible
with an explicit unsupported state. Platform availability follows the selected
provider runtime; the renderer does not claim Codex or Claude usage support on
an OS/architecture where that provider is unavailable.

Model Pacing compares trustworthy, non-stale reported plan allowance, reset
time, and an operator reserve. Paid balances and extra-usage limits are
informational and do not grant authority to spend. Pacing is advisory and does
not silently switch models, schedule agents, interrupt in-progress work, or
spend quota.

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
enable another. The Atmosphere Console visibility switch is renderer-local so
a phone can hide it without changing another connected client.

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

The composer exposes one touch-sized Mobile optimized presentation toggle.
Enabling it is an explicit per-device preference that makes a wide viewport use
the existing responsive mobile sidebar, run-context, chat-padding, and
right-panel branches; no second copy of the application UI exists. The
override is stored by that browser or desktop renderer and is never forwarded
through the environment-wide client-settings RPC, so a phone cannot force a
connected desktop into its layout. The same tap enables the falling-effects
layer and selects Matrix while preserving every saved Matrix color, density,
speed, font, depth, and motion value. Returning to responsive desktop changes
only the presentation override, so Matrix stays on. A naturally narrow phone
remains mobile without writing that override or silently changing an
operator's selected snow/rain/off atmosphere. Orientation and safe-area
behavior remain viewport-driven, virtual-keyboard detection remains
touch-capability-driven, and Matrix continues to obey reduced-motion policy.

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
9. Decide whether to bundle a trusted hardware sensor backend or document an
   operator-installed Libre/Open Hardware Monitor service. When neither WMI
   namespace exposes a requested sensor class, CPU, DIMM/RAM, storage,
   VRAM-junction, and case/ambient temperatures must remain explicitly
   unavailable rather than estimated.

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
- Claude subscription usage is exposed by an explicitly experimental Agent SDK
  control method. A Cafe Code product PR must retain the experimental/fail-closed
  boundary and complete Anthropic authentication/product-policy review before
  enabling claude.ai subscription polling for third-party users.
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
The Mobile optimized override is renderer-local rather than environment-wide,
but it is an allowlisted field in that renderer's local settings profiles.
World-clock enablement, style, and cities are allowlisted presentation fields;
clock geometry and collapsed state stay local to the renderer. Weather consent
is also renderer-local, but unlike Mobile it is deliberately excluded from
profiles so applying a profile cannot start third-party networking.
Validated custom completion clips persist only in per-device browser storage
and never become provider context.
Direct local-media queues/object URLs, VLC playback sessions, YouTube URL
queues, display-capture streams, live audio levels, embedded-browser snapshots,
sensitive browser fields, provider-browser grants, and local control sentences
are session/process-only unless the operator explicitly transfers safe text
into another surface. Auto Nudge policy and editable prompt are durable
exact-thread server state; its bounded client consumption ledger remains
per-device browser storage and never grants dispatch authority on its own.

OAuth tokens, raw local paths, VLC session tokens, browser secrets, captured
audio, browser-tool bearers/headers/typed values, prompt text, and file contents
are excluded from ordinary settings, the durable provider command ledger, and
telemetry. Provider usage snapshots exclude credentials, account IDs, raw
provider payloads, Claude session-cost estimates, and transcript-derived
behavior. Usage is displayed per configured instance without exposing its
provider account identity.

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
