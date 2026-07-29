# Club Code Current-Build Guide

This guide describes user-visible behavior implemented in the current Club Code
repository source. It is a current implementation inventory, not proof that a
particular installer, GitHub branch, or pull request has been published. The
project plan records source status and the remaining release gates separately.

Alpha notice

Club Code is alpha/testing software. It is provided without
warranties or claims of reliability, fitness for a particular purpose, or
uninterrupted operation. Use it at your own risk, keep backups of important
work, and verify important results.

> [!CAUTION]
> **Auto Nudge can spend real money quickly.** Every automated follow-up is a
> real provider request and may rapidly consume tokens, credits, quota, or paid
> usage. You remain responsible for provider charges; Club Code maintainers
> cannot reimburse or assume responsibility for those costs. Use conservative
> round and time caps, write a carefully scoped prompt or skill for the exact
> thread, and monitor active runs—including from the phone Web UI when away.
> Leave it running unattended overnight only when you knowingly accept the cost
> risk.

The [Japanese companion guide](./club-code-current-build-guide.ja.md) covers the
same current source in Japanese.

## What Club Code Changes

Club Code keeps Cafe Code's coding-agent chat foundation and compatibility
identifiers, then adds a local-first desktop experience, bounded automation,
operator observability, media, and extensive presentation controls.

| Area                 | Current Club Code behavior                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product shape        | Branded Club Code desktop and Web UI, while retaining compatible `cafe-code`, `@cafecode/*`, `CAFE_CODE_*`, protocol, and data-path identifiers. It stays chat-centered and does not restore an in-app terminal or pretend to be a full editor.                                             |
| Providers            | Codex, Claude, and OpenCode remain available. The build incorporates Cafe Code's Codex 0.146 protocol support and adds a separate **LM Studio Local** provider whose callable local models appear in the main model picker.                                                                 |
| Prompt workflow      | Exact-thread draft recovery, visible queued follow-ups, provider-aware **Steer**, durable FIFO ordering, image and bounded `.txt` attachments, and a camera button with preview, front/rear selection, retake, and system-camera fallback.                                                  |
| Auto Nudge           | Exact-thread mode, editable standing-order text, per-thread round/time caps, foreground or opt-in background continuation, minimized controls, per-thread Stop, an emergency stop for known connected threads, and normal-history messages. Server-accepted operator work goes first.       |
| Atmosphere           | Full-window snow, rain, or Matrix; Roman/Japanese mix; 2ch glyph enrichment; fixed, rainbow, per-stream rainbow, and music-reactive colors; shimmer speed; live-work vocabulary; and Flat, Forward, Reverse, Warp, Walk Forward, and Walk Reverse motion.                                   |
| Mobile presentation  | A touch-sized composer toggle switches the current renderer between responsive Desktop and forced Mobile optimized layout. Explicit Mobile also enables/selects Matrix without resetting its appearance; returning to Desktop leaves Matrix on.                                             |
| Clock and weather    | An optional transparent, movable multi-city clock offers rainbow shimmer, amber nixie, analog, and old-school LED styles. Weather is separately disabled by default and requires renderer-local network consent.                                                                            |
| Verified activity    | Optional Matrix routes for provider-observed network, database, build, and agent-delegation activity. Safe reported filenames may enrich the bounded live-work vocabulary. Lines, packets, trails, endpoints, and telemetry never use prompts, commands, SQL, secrets, or invented traffic. |
| Ambient media        | YouTube, Spotify embeds, direct local media, desktop VLC playback, a single image/GIF or bounded image-directory cycle, floating/custom/Theater/Cinema layouts, adaptive glow, and a Spectrum or bundled 395-preset MilkDrop/Butterchurn visualizer.                                        |
| YouTube queues       | Three bundled one-click lists—Japanese, EDM, and K-pop—plus local `.txt` list import. Reimporting the same filename replaces that browser's list; a new filename adds another choice. Non-embeddable or unavailable videos are skipped within the bounded queue pass.                       |
| Resource monitor     | A transparent, movable, resizable, collapsible Project Resources panel with Matrix-colored graphs for host CPU/RAM/network, selected-project disk volume, GPU/VRAM, and measured hardware temperatures where the host exposes them.                                                         |
| Observatories        | Provider-reported Workflow views plus a read-only Workspace Observatory with bounded project tree, text preview, SQLite table viewing, verified file focus, and up to eight tiled panes. These views do not edit files/databases or silently add their contents to model context.           |
| Supervised browser   | A temporary sandboxed desktop browser with native approval for assisted actions and an explicit, origin/thread/provider-bound Codex or Claude grant. Sensitive fields stay out of prompts and routine logs.                                                                                 |
| Usage and completion | Provider-reported usage windows and paid-usage state, advisory Model Pacing, cache/compaction counters, Ultra Caching handoff behavior, and optional privacy-safe completion sounds or fixed English/Japanese speech.                                                                       |
| Personalization      | Locally persisted settings profiles for presentation/client preferences, first-run Club Code presentation defaults, whole-window opacity on supported desktop builds, and Meeting Privacy for hiding selected projects from presentation surfaces without stopping their work.              |
| Connections          | A LAN-capable Web UI and saved direct connections to other reachable Cafe Code/Club Code servers. Projects, threads, providers, and subscriptions are scoped to the selected server.                                                                                                        |
| Desktop workflow     | Thread movement between projects, recycle-bin/restore/permanent-delete flows, configurable external editor, real-path opening, separate source and packaged update checks, and hardened provider/session/checkpoint lifecycle handling.                                                     |

## Auto Nudge: Exact Behavior and Safe Use

Auto Nudge is **completion-driven, not time-driven**:

1. The provider must report a new completed turn for that exact thread.
2. Every accepted operator follow-up for that thread must have drained in FIFO
   order.
3. The thread, provider, transport, approvals, user input, draft, and configured
   caps must still be eligible.
4. A five-second safety debounce rechecks those facts before dispatch.
5. That completed turn is consumed at most once. Only a later completed-turn
   identity can authorize another automated follow-up.

The five-second debounce is not a repeating schedule. The background
coordinator's repeating interval only reconciles the host/browser emergency
suppression signal; it has no scheduling or dispatch path. The configured
maximum minutes is a run ceiling, not a nudge interval. Idle wall-clock time by
itself does not authorize a provider request.

The two built-in starting modes now supply plan-driven continuation prompts.
**Steady Progress** resumes current context, reconciles the applicable
handoff/plan/canon/PR state, and keeps at most two coherent lanes aimed at the
next verifiable slice. **Hardcore Fanout** uses bounded, non-overlapping lanes
with one owner per lane and converges through repository gates and required
independent audits. Both assign actionable status and dependencies to Linear,
durable decisions and research to Notion, avoid duplicate records, and include
explicit stop conditions. The text remains editable for each persisted thread;
a prompt saved for one thread is not project-wide policy and does not become
another thread's prompt.

Background continuation is separately opt-in for the exact thread. It keeps the
controller alive while the user visits Settings or another chat. Concurrent
renderers may observe the same completion, but the exact environment server
serializes commands and permits only one valid revision/turn consumption. The
default run limits are five rounds and 30 minutes; the hard configurable ranges
are 1–20 rounds and 5–120 minutes.

The control starts minimized and its collapsed bar is limited to the chat
manuscript width. Red means Off, green means On, and an animated cyan/green
state means On with exact-thread background continuation selected. Collapsing
the control changes presentation only; it does not stop an enabled policy.

Once the server accepts an operator follow-up, that exact-thread FIFO and its
provider work block Auto Nudge. An unsent draft remains local to its renderer:
the dispatching renderer checks its own exact-thread draft, but the server
cannot reserve intent typed on another device before it is submitted and
accepted. The emergency stop similarly uses a durable browser/host suppression
barrier and sends Stop to known connected threads; it is not a server-global
signal shared automatically by unrelated machines.

Use it conservatively:

- Prefer a small round cap and a short time cap.
- Write an objective, stopping condition, verification requirement, and scope
  limit into the exact-thread prompt. A narrowly designed skill can make that
  standing order more repeatable.
- Use **Steady progress** for bounded continuation. Reserve aggressive fan-out
  for work that genuinely benefits from parallel exploration and whose cost you
  are prepared to supervise.
- Watch the visible background round count, normal chat history, and provider
  usage. When away from the computer, use the LAN Web UI on a phone rather than
  assuming the run is healthy.
- Use **Stop this thread** for one thread or **Emergency Stop all** for every
  known thread. A stop prevents future handoffs; it cannot retract a request
  already accepted by a provider.
- Treat overnight execution as an informed exception, not a default.

## Providers and Local Models

### LM Studio Local

LM Studio is not OpenCode. In **Settings > Providers**, choose the distinct
**LM Studio Local** setup row. Club Code starts a separate Codex OSS app-server
instance and discovers callable chat models from LM Studio's OpenAI-compatible
`/v1/models` endpoint. Embedding-only models are omitted, cloud Codex remains
separate, and local models appear in the main composer model picker after a
provider refresh.

The default endpoint is:

```text
http://127.0.0.1:1234/v1
```

A literal private/LAN address such as `http://192.168.1.50:1234/v1`, or an HTTPS
endpoint, is also accepted. Plain HTTP hostnames, public IP addresses, embedded
credentials, query strings, and non-API paths are rejected. Start LM Studio's
server and load a chat model—or enable its just-in-time loading—before
refreshing Club Code.

Codex's built-in LM Studio route in this build has no bearer-token hook.
Therefore it cannot connect when LM Studio's **Require Authentication** option
is enabled. Use an unauthenticated endpoint only on loopback or a trusted,
firewalled private network/VPN. Never expose it directly to the public internet;
plain HTTP is not encrypted.

### Other provider-facing additions

- Provider usage displays only facts the provider reports, including unavailable
  and stale states. It does not invent quota or a billing estimate.
- Model Pacing is advisory. It compares reported allowance with time remaining
  and a reserve; it does not silently switch models.
- Cache reads, cache writes, output usage, and observed compaction are kept as
  separate counters rather than combined into a fictional “tokens saved”
  number.
- Completion alerts respond to an observed same-turn completion. They do not
  read prompts, answers, paths, or project content aloud.

## Prompt Input, Queues, and Camera

When a provider is already running, submitted follow-ups remain visible in an
exact-thread queue. Club Code preserves FIFO order. The queue head can steer the
active turn when the provider honestly supports live steering; otherwise it
waits and starts as the next turn after the session is ready. Server-accepted
queued operator work has priority over Auto Nudge. A draft or submission that
has not reached the server on another device is not yet part of that durable
FIFO.

The attachment picker supports existing image attachments and bounded plain
`.txt` input. Text files are visibly decoded into the composer rather than
silently becoming an arbitrary binary upload.

The camera icon next to the paperclip opens a live preview when the browser
provides a secure camera context. It requests video only—never microphone
audio—prefers the rear camera, can switch front/rear devices, lets the user
retake, and attaches the accepted frame as a bounded JPEG image. Closing the
dialog stops its media tracks. Mobile browsers can instead use the system camera
fallback.

Camera access on a phone normally requires HTTPS with a certificate that the
phone trusts. Loopback is treated specially by browsers, but a plain LAN HTTP
address is generally not a secure camera context. Provider/model image support
still determines whether the resulting attachment can be sent.

## Visuals, Media, and Project Resources

### Matrix and atmosphere

- Snow, rain, and Matrix are optional and pointer-transparent.
- Matrix base font size for Flat, Forward, Reverse, and Warp is adjustable from
  1–72 px.
- Walk endpoints are adjustable from 1–144 px in whole-pixel steps. Depth and
  position interpolate continuously, while whole-pixel font caching reduces
  local rendering cost.
- Perspective ratios also affect bounded activity routes, trails, packets,
  pulses, and telemetry. Near endpoints flare; Warp narrows toward its center
  plane.
- Falling effects over Cinema video are separately opt-in and off by default.
  Provider-activity connectors remain behind the player so operational lines
  are not mistaken for video content.
- Reduced-motion behavior removes travel animation and retains only safe static
  presentation where applicable.

The touch-sized presentation control beside the composer shows whether the
current renderer has explicitly selected **Mobile optimized** or normal
responsive **Desktop** presentation. Mobile optimized reuses the existing
compact sidebar, run-context, chat-padding, and right-panel layout even on a
wide desktop screen; it does not maintain a second copy of the UI. Natural
phone-width responsiveness still works without writing the override.

Turning Mobile optimized on also enables the falling layer and selects Matrix.
It preserves the operator's current Matrix colors, shimmer, density, speed,
font sizes, perspective, and activity-line choices. Returning to Desktop
removes only the layout override, so Matrix remains on until the operator
changes it separately. The override is persisted for that browser/Desktop
renderer: a phone cannot force another connected desktop renderer into its
compact layout.

### World clock and optional weather

The disabled-by-default world clock is a transparent overlay that can show one
to six curated cities, each bound to an explicit IANA timezone. Choose
**Rainbow shimmer**, **Amber nixie tubes**, **Transparent analog**, or
**Old-school LED**. The panel can be moved, resized, collapsed, and operated by
keyboard; it stays clamped to narrow viewports. Clock work and Matrix-color
subscription pause while collapsed or hidden, and reduced-motion behavior
freezes decorative shimmer.

Clock enablement, style, and cities can be saved in a local settings profile.
Panel geometry remains local to the renderer. Weather is a separate
disabled-by-default renderer-local consent and is deliberately excluded from
profiles: loading a profile or changing another connected client must not start
a third-party request.

When weather is enabled, the visible renderer sends only the selected catalog
coordinates and its network IP (inherent in the HTTPS connection) directly to
Open-Meteo. It sends no prompt, project, provider, account, or workspace data.
Reads are batched and bounded, cached, timed out, and visibly marked stale when
an old observation is retained. The Settings notice and widget attribution link
to the service's current terms. See the
[clock/weather guide](./world-clock-weather.md) before enabling it.

### Media

The streaming surface supports normalized YouTube and Spotify embeds. YouTube
playback persists while Settings is open. Browser, owner, regional, age,
embedding, autoplay, and mobile-browser policy still apply; Club Code cannot
bypass them.

The current source queue inventory is:

- [JPMusic.txt](../examples/youtube-url-queues/JPMusic.txt): 77 supplied URL
  lines, 71 accepted unique videos, three duplicate entries, and three malformed
  10-character IDs reported.
- [EDMYoutubeList.txt](../examples/youtube-url-queues/EDMYoutubeList.txt): 31
  supplied lines, 30 accepted, and one malformed 10-character ID reported.
- [KPOPList.txt](../examples/youtube-url-queues/KPOPList.txt): eight supplied
  lines, all accepted.

Imported queue libraries are local to that browser/device. Active queues remain
session-only. Same-name import replaces the local list; a distinct filename
adds a selectable list. An item that does not permit embedding is skipped, not
treated as proof that the whole list is broken.

Direct browser media and desktop VLC queues are also session-only. Native paths
do not cross into the renderer. YouTube/Spotify audio visualization requires an
explicit display-audio share; there is no microphone fallback or hidden iframe
audio extraction.

### Project Resources

The panel is a movable, resizable overlay, so it does not reserve or cut off the
chat transcript layout; move it away if it visually overlaps content. Polling
stops while collapsed or hidden. Its background and cards are transparent, and
graph colors follow the active Matrix palette, including
shimmer/music-responsive modes.

The current source shows every detected GPU as a stable **GPU 1**, **GPU 2**,
and so on, with each adapter's own utilization, VRAM used/total/free, measured
core temperature when available, and bounded history. Adapter numbering
remains stable even if the host reports the devices in a different order.

Temperature cards display the hottest measured sensor in each class: CPU, GPU,
RAM, VRAM, storage, case/ambient, and other. Missing values are shown as
unavailable; Club Code never estimates temperatures. On Windows, non-GPU
temperatures require temperature sensors exposed through Libre Hardware Monitor
or Open Hardware Monitor WMI. NVIDIA GPU core temperature may be available
through `nvidia-smi`. On Linux, the server reads supported `/sys/class/hwmon`
sensors. Hardware, drivers, firmware, and sensor software determine which
categories populate.

## Settings, Persistence, and Privacy

Settings profiles are local presentation presets. A profile can save and switch
theme, atmosphere/Matrix, media presentation, Mobile optimized/Desktop layout,
world-clock appearance and cities, completion alerts, UI layout, and other
allowlisted client preferences. Up to 32 profiles are stored in that browser or
desktop client's bounded local storage; saving the same name replaces the local
profile, and the active profile survives restart.

Profiles intentionally exclude provider accounts, credentials, endpoints,
server exposure, repository/project paths, model pacing, and exact-thread Auto
Nudge authority. The renderer-local weather consent is also excluded so loading
a profile cannot begin third-party network activity. Loading a “Mobile” or
“Desktop” profile changes presentation, not who can run work or where provider
traffic goes.

Meeting Privacy locally hides selected projects and their threads from
presentation surfaces. Hidden work remains connected and can continue running;
it is a presentation tool, not an access-control or process-stop boundary.

Validated ambient images/GIFs persist in the local server store. Local/VLC
queues, YouTube `.txt` queues, display-audio streams, browser grants, and camera
streams are session-scoped. Workflow/Workspace views are read-only and do not
automatically enter provider context.

## LAN and Phone Web UI

Enable LAN/network access in the desktop settings, allow the displayed backend
ports through the host firewall, and use the host machine's private LAN address
from the phone. The packaged defaults are:

- HTTPS/WSS: `3775/tcp`
- HTTP/WS fallback and certificate bootstrap: `3773/tcp`

The Web UI carries the Matrix atmosphere, shimmer, and activity overlays when
the browser exposes the required rendering capabilities. Background tabs,
reduced-motion preferences, device performance, and mobile browser media policy
can reduce or pause effects.

The composer toggle is available in the LAN Web UI, so the current phone
renderer can enter Mobile optimized presentation without changing the desktop
renderer left at the desk. Clock rendering also works through the Web UI;
weather still requires a separate opt-in on that renderer.

Club Code does not create a VPN, SSH tunnel, trusted certificate, or firewall
rule for you. Browser credentials are session-scoped; desktop saved-server
credentials use Electron safe storage. Do not expose the backend directly to
the public internet.

## Current-Build Boundaries Worth Remembering

- Visual activity is evidence-based and incomplete when a provider does not
  report an event. No line is better than an invented line.
- Every detected GPU has its own utilization, VRAM, temperature, and history
  presentation; an unavailable sensor stays explicitly unavailable.
- Temperature availability depends on real host sensors and supported sensor
  software.
- YouTube and Spotify retain control of embedding, login, DRM, autoplay, and
  playback policy.
- Camera access on LAN clients depends on a browser-trusted secure context.
- Mobile/Desktop presentation is renderer-local; Matrix appearance remains an
  independently saved setting.
- Weather is optional third-party networking and is never enabled by a profile
  or another connected renderer.
- LM Studio is external software, and network use needs a trusted private
  boundary.
- Auto Nudge is powerful paid automation. Completion gating and caps reduce
  risk; they do not make provider calls free.
