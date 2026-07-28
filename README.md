# Club Code

### The original Cafe Code, after hours — with the Club Code sign lit

![Club Code desktop screenshot](./docs/images/cafe-code-desktop.png)

Made in Japan with love, too much glitter, and absolutely no chance of catching the last train.

**Warning**: Large parts of the application are currently under development and have been completely rewritten. It may take some time for the system to become stable.

_Heeey, darling. Come in, come in. Closer. I am not shouting; the room is just very far away. Club Code is the late-night fork of Cafe Code: chat goes in, work comes back, and nobody drags a fake IDE onto my dance floor. Snow in the window? Yes. A little movie in the corner? Yes. One more glass? Also yes. That one is probably unrelated._

This repository is **Club Code**, an after-hours fork of [Cafe Code](https://github.com/cafeai/cafe-code), which began as a fork of [T3 Code](https://github.com/pingdotgg/t3code). The app still uses Cafe Code package, command, and data-directory names for compatibility. New sign outside; dependable regulars behind the bar.

It stays small, quick, and out of the way. No freezing, no dragging, no enormous dashboard getting sleepy on your shoulder.

T3 Code wanted to be minimal. Cafe Code went smaller. Club Code put on nicer lights without making the room heavier.

No terminal drawer. No editor pretending to be VS Code. The new observatories are read-only windows into work that is already happening; they do not quietly become another agent or another place that edits your files.

<p align="center">
  <img src="./docs/images/cafe-code-character.png" alt="Club Code character" width="360" />
</p>

## Tonight’s Very Sensible Menu

Listen, gorgeous, I wrote this down before the second bottle, so it is accurate. Everything below stays operator-switchable. A genuinely new Club Code profile opens with the visual first-round setup described below; capture, account connections, browser grants, Auto Nudge, and completion voices still wait for explicit action. The fresh media setup is the named exception: its Japanese queue requests playback as described below. Chat remains the main table; glitter is never allowed to steal the mouse, invent provider truth, or sneak page secrets into a prompt.

- **Snow, rain, or Matrix across the whole window:** Choose one effect or turn it off, then set transparency, speed, and density. Matrix has a 0–100% Roman/Japanese stream mix (and matching English/Japanese live terms), reviewed coding-flavored kanji, optional 2ch-inspired glyphs and cat AA, and a separate switch that folds only bounded, non-secret work vocabulary into the rain. Color has five choices: fixed; one synchronized rainbow; **Rainbow Extra**, where every falling string keeps its own phase; one synchronized music-reactive cycle; and music-reactive Rainbow Extra, where those independent phases move with bounded beat and coarse frequency energy. Direct/VLC media works directly; YouTube/Spotify works only through the display-audio stream the operator already approved for the visualizer. It never starts another capture or microphone, extracts iframe audio, or retains PCM, bins, or history, and quiet/stale/stopped input falls back honestly. A separate independently switchable activity layer can flash safe NETWORK/FETCH, DATABASE/QUERY, or BUILD/COMPILE pairs (with fixed Japanese counterparts) and connect only same-category events with the exact same provider-reported item or tool identity. Routes use only horizontal and ±60° hex segments; choose independently randomized route colors or the selected/rotating Matrix palette, while a bright white packet travels the route with a fading trail and the endpoints pulse. Reduced motion keeps a dim static route and removes packet travel. This layer never drops prompt text, commands, SQL, URLs, secrets, or invented traffic into the rain. The canvas is pointer-transparent, capped, reduced-motion aware, and paused when the configured focus policy says so.
- **A tiny atmosphere bartender:** The movable console opens in a viewport-clamped custom slot at `321, 280`, sized `622 × 477.5`, and still supports corner anchors, dragging, and resizing. It understands local commands such as “make it snow,” “density 80,” “next song,” and “visualizer random.” Its deterministic parser costs zero model tokens. An optional LM Studio interpreter can translate one short control sentence through the fixed loopback endpoint at `127.0.0.1:1234`; it never receives chat, project files, prompts, or an internet fallback. Small brain, one job, very cute.
- **One image, one GIF, or a whole ambience directory:** Keep the original single validated PNG, JPEG, WebP, or GIF path, with a 10 MiB ceiling per asset, either lower corner, glow controls, presets, and mouse/keyboard custom sizing. On a capable desktop, a directory choice scans a bounded 128 entries, accepts at most 24 supported images totaling 80 MiB in stable order, uploads only validated content-addressed assets, and forgets the source and relative paths. The 160 MiB local profile quota permits the old and replacement 80 MiB cycles to coexist briefly until the settings write succeeds, then cleans references safely; it does not relax per-upload validation or request limits. Cycling is separately enabled, runs from 3 seconds to 1 hour, and has manual previous/next controls. Floating mode keeps the corner/custom window; **Theater** fills the contained chat-media surface with the current image and a blurred backdrop. Collision handling still keeps the image and player from sitting on each other like two tired hostesses in one chair.
- **YouTube without surrendering the room:** Paste a video or playlist, use optional server-side public search, or load a session-only `.txt` queue containing one supported YouTube URL per line. Club Code also ships the exact operator-supplied [Japanese music example](./examples/youtube-url-queues/JPMusic.txt)—39 committed URL lines, of which the strict parser accepts 36 and visibly reports three malformed 10-character IDs—and [EDM example](./examples/youtube-url-queues/EDMYoutubeList.txt)—20 committed URL lines, 19 accepted, one malformed 10-character ID reported. In any untouched renderer session with no saved ambient-video source, the Japanese example initializes the session queue. Playback is requested only when the video surface is enabled; the branded fresh profile enables it, so its first accepted item requests autoplay. The source remains null and the parsed queue is not persisted; browser policy, YouTube policy, embeddability, or an unavailable item may still prevent playback. It never overwrites an existing ambient-video source, and a manual clear or queue/source choice wins for the rest of that session. Both examples remain selectable in Settings; only their public source files live in the repository, while the parsed queue remains session-only. Previous, next, manual skip, unavailable-item recovery, and playlist controls stay bounded. Floating mode supports presets and custom geometry; Cinema keeps projects on the left, gives video the middle, and moves chat into a right rail; native player fullscreen remains separate. A configured local owner may connect a YouTube account to discover playlists through memory-only PKCE. That is playlist discovery, not embedded Premium login, not password collection, and not a promise that a private or non-embeddable item will play.
- **Glow that can follow the picture:** The fixed-color edge glow remains. YouTube’s optional adaptive mode blends a bounded four-edge palette from public thumbnail artwork for the current validated video ID; it never reads cross-origin iframe pixels, audio, cookies, credentials, or the screen. Approved direct/VLC video has its own live-frame mode: the exact current player is downsampled into a throwaway 32×18 canvas every 750 ms, four edge colors are applied, and the canvas is immediately cleared. Hidden/background/teardown paths stop sampling; reduced motion keeps a static palette; unready, tainted, or denied frames return immediately to the fixed color, with automatic retries capped at three. No frame, pixel, path, palette history, or model context is retained. Spotify remains fixed-glow only.
- **Spotify, behind the official velvet rope:** A supported track, album, artist, playlist, show, or episode URL becomes an official Spotify Embed. Club Code retains only the validated type and ID. Spotify owns its login, DRM, account, and playback behavior. This is not a Spotify account connector, library browser, or in-app search surface.
- **Local media with a real VLC lane:** Choose a session-only queue of up to 64 supported audio/video files and 64 GiB total. Direct playback keeps only one current browser `blob:` URL; desktop **Open with VLC** uses an installed VLC executable and one private tokenized loopback item at a time, bringing FLV, MKV, AVI, WMA, transport streams, and VLC’s wider codec support into the same floating, custom, Cinema, and video-background layouts. Previous, next, manual skip, ended auto-advance, and one bounded error-skip pass are available. The renderer receives only the current index/count, a bounded sanitized filename-derived title, and opaque ownership/playback tokens—the native path never crosses over, and the stable queue ID is not the rotating item URL. The desktop picker rejects duplicates, symlinks, devices, directories, and other non-regular entries; the browser queue rejects malformed or MIME/extension-spoofed entries. Navigation, replacement, clear, owner teardown, or shutdown releases the old object URL or VLC child plus private files, requests, tokens, and port. Rich embedded-metadata extraction, network-stream entry, arbitrary VLC arguments, and a universal codec guarantee remain deliberately unclaimed.
- **The visualizer finally has a wardrobe:** Spectrum is the quiet option; the locally bundled Butterchurn/MilkDrop catalog contains 395 deduplicated styles with search, previous/random/next, timed cycling, and adjustable blends. It can react to the selected browser/VLC media element. For YouTube or Spotify, the user must explicitly choose a tab, window, or system-audio share through Chromium’s display-media picker; there is no microphone fallback, direct iframe extraction, recording, upload, or invisible capture. Stop sharing and the analysis path disappears.
- **Workflow and workspace observatories:** Workflow shows provider-reported plans, tools, hierarchy, duration, activity, and honest “possibly stalled” warnings without turning silence into a fake state. Keep the accessible semantic list or switch to a bounded pan/zoom node-edge graph; it draws only explicit reported parent links and leaves missing or cyclic relationships unknown. The full-window Workspace Observatory adds a read-only project tree, bounded/redacted text viewer, verified read-only SQLite tables, a provider-observed agent-color focus surface, and up to eight tiled panes. Only visible open panes poll, at a selectable 1–5 second cadence with pause/resume and stale-response rejection. Optional capped line changes start off. SQLite names row changes only when a complete safe declared primary key proves identity; otherwise it says only that the snapshot changed, and it never guesses which agent wrote a row. Current providers still do not emit every file edit or database operation. These are local presentation views; they do not add their own model context or edit files or databases.
- **A supervised browser inside the window:** The desktop opens one temporary sandboxed tab with Node disabled, blocked popups/downloads, exact-origin sharing, and native approval before every assisted action. The operator path can put a user-supplied credential or 2FA code through a transient sensitive field without adding it to a prompt or routine log. Separately, an explicit grant lets only the exact live Codex or Claude thread/provider request a compact redacted DOM/accessibility snapshot, fresh-target click, non-sensitive type, same-origin credential-free navigation, or history action. The grant is also bound to the current tab and HTTP(S) origin, defaults to five minutes within a 1–10 minute range, permits at most 40 requests with a four-request queue and 90-second action timeout, and still asks for native approval on every action. Its bearer, typed values, queue, and results stay process-only; identity/origin/tab drift, expiry, request exhaustion, provider stop/restart, shutdown, or operator revoke ends it. OpenCode has no equivalent grant yet. Provider tools cannot type passwords, tokens, OTPs, CAPTCHA controls, or other sensitive fields, and there is still no pixel OCR, screenshot tool, inbox connector, email-code retrieval, CAPTCHA solver, or 2FA bypass. The separate operator-approved redacted snapshot-to-draft handoff remains visible for review.
- **A file picker that starts on All Files:** The chat paperclip no longer traps the native picker on Images. Images still use the existing attachment path; a plain `.txt` file—including one whose operating system supplies an empty MIME type—is decoded as bounded UTF-8 or BOM-marked UTF-16 (256 KiB file ceiling), placed visibly into the composer with its filename, and sent through the universal text prompt path so Codex, Claude, and OpenCode can all read a YouTube URL list. The normal 120,000-character message limit still wins. Unsupported/binary files fail visibly rather than disappearing, and this is not an arbitrary binary-upload tunnel.
- **Keep-going controls without an immortal gremlin:** Auto Nudge still sends exactly **Fan out and keep going** or **Keep a few lanes going, make steady progress** five seconds after a provider-confirmed terminal turn. The ordinary mode remains a durable device-wide preference and foreground behavior is unchanged. A separate default-off switch can give exactly one explicitly selected thread app-level background ownership, so leaving chat for Settings does not unmount its controller. One run defaults to five automated rounds or 30 minutes and is configurable only within hard limits of 1–20 rounds and 5–120 minutes. Pause, resume, stop, transfer ownership, and a bounded visible ledger are in the chat control; sent entries name the normal-history message ID and consumed terminal turn. Manual or offscreen draft activity, queued/operator work, provider or transport trouble, a missing/archived thread, settings disable, or either cap halts it. Before any background dispatch, supported Chromium/Electron surfaces take an exclusive cross-tab Web Lock and reload the durable state. A contended lock sends nothing and retries on a later bounded tick; missing or rejected lock support pauses/fails closed, and an unsupported surface disables and explains the background control. Completed turns are consumed before transport, reloads cannot duplicate them, backward-clock or stale callbacks cannot revive them, and a sent prompt that fails to appear in the projection within 60 seconds pauses for manual recovery. It is one bounded continuation lane, never a hidden endless loop or extra fan-out scheduler.
- **Usage, pacing, and honest token efficiency:** The optional top-left widget polls provider-reported Codex/Claude windows every 1–5 minutes and shows remaining usage and reset times when the provider actually exposes them. Model Pacing compares remaining allowance with remaining time and a chosen reserve; it advises rather than fabricating quota or silently changing models. Usage Stats attributes output and real reported cache-read/cache-write/observed-compaction counters by provider and model. Those are separate signals, not an additive or counterfactual “tokens saved” total and not a billing estimate.
- **Ultra caching without magic smoke:** Per-provider Ultra Caching keeps reusable prefixes stable and requests concise structured handoffs. Codex also uses a stable durable-summary prompt and an earlier 120k compaction ceiling; Claude receives a stable compact-handoff instruction. It can reduce carried context and improve prompt-cache reuse, but actual savings remain provider-dependent and are measured from reported usage. It is not yet a persistent hierarchical summary/index service. The bundled cross-project **Audit and Repair** skill keeps each independent reviewer responsible for its own fixes and validation, avoiding a second model’s recontextualization when possible; Club Code does not yet automatically orchestrate or enforce that workflow.
- **Short completion audio, because nobody asked for a podcast:** Completion alerts are off by default and fire only on an observed same-turn `running → completed` transition. Choose the original soft two-note station-like ping or cycle through up to eight locally persisted MP3/WAV files, each no larger than 5 MiB or 15 seconds, plus the fixed privacy-safe phrases “Task complete.” and/or “作業が完了しました。” English and Japanese voice gender preferences are separate. Windows native speech can play Japanese left/English right simultaneously or reverse the channels; exact language/voice matches are required, so an absent Japanese voice is reported instead of replaced with English. For female voices Club Code prefers local Microsoft Haruka, then Ayumi, in Japanese and Zira in English. The panel names detected voices, links Microsoft’s exact Add voices guide, and can refresh after installation. Browser speech fallback is honestly labeled centered and sequential. Club Code does not bundle a voice pack, and macOS/Linux do not yet have the complete native stereo path.
- **Whole-window opacity:** The Electron preference fades the complete native window within a bounded 65–100% range. The packaged Windows path has native smoke evidence; unsupported surfaces fail closed. This is whole-window translucency, not a claim of KDE/Konsole acrylic, blur, or full invisibility. One reset action disables persistent atmosphere/media presentation and opacity, then clears session-only local playback.
- **LM Studio through Codex:** Add the distinct **LM Studio** provider or turn on **LM Studio mode** for a Codex instance. Club Code launches `codex --oss --local-provider lmstudio app-server`, skips cloud login checks, and discovers models from the configured OpenAI-compatible API root. The default is loopback (`http://127.0.0.1:1234/v1`), while private/LAN HTTP addresses such as `http://192.168.1.50:1234/v1` and HTTPS endpoints are also supported. Each provider instance receives its own process-scoped endpoint, so local and network LM Studio instances can coexist without changing global environment variables. Plain public HTTP, embedded credentials, query strings, and non-API paths are rejected. Important security limit: Codex's built-in `lmstudio` provider currently has no API-key or bearer-token hook, so it cannot connect when LM Studio's **Require Authentication** setting is on. LM Studio recommends authentication whenever it is served beyond loopback; until Codex exposes that hook, use this integration only on loopback or behind a trusted private network, VPN, or firewall, and never expose an unauthenticated endpoint to the public internet. HTTPS encrypts transport but does not authorize clients. LM Studio itself remains external and is not bundled.

### What This Looks Like During a Real Session

Club Code’s additions are meant to cooperate instead of becoming a pile of unrelated toys:

1. **Set the room once.** Atmosphere, Matrix language/color behavior, streaming/image presets, glow, completion alerts, Auto Nudge, usage polling, and supported native opacity are normal persisted preferences. Direct/VLC local-media layout, glow, and visualizer choices remain renderer-session state. The presentation reset turns the persistent decorative/media switches back off and clears session playback without deleting projects or chats.
2. **Bring your own background.** A single corner GIF or a bounded cycling image directory can sit beside a YouTube, Spotify, direct-file, or VLC player. Preset geometry is the calm path; custom geometry enables pointer and keyboard movement/resizing, and image Theater offers a larger contained backdrop. Fixed glow works across the supported players. YouTube may derive adaptive colors from its current public thumbnail artwork; approved direct/VLC video may derive them from a tiny bounded current-frame sample. Either returns to fixed color when its safe route fails. Cinema rearranges the existing project and chat rails around video rather than replacing them, while player fullscreen remains the player’s own separate action.
3. **Route audio deliberately.** Direct browser Local Media and Club Code’s private VLC stream can feed the visualizer and the bounded Matrix music-color signal directly. Cross-origin YouTube/Spotify begins only after the operator explicitly shares display audio; that same approved analyser may feed Spectrum/MilkDrop and Matrix color without a second prompt or microphone. Stopping or losing the share removes both reactions.
4. **Watch work without manufacturing work.** Workflow Observatory follows provider events and plans in either the semantic list or an explicit-parent graph. Workspace Observatory can refresh visible read-only file/database panes and present explicitly reported file focus, but provider coverage remains incomplete and database writer attribution stays unknown. Matrix activity links reuse only safe provider evidence. Agent colors, elapsed time, hierarchy, links, and “possibly stalled” hints are presentation over evidence—not chain-of-thought, a second scheduler, filesystem/database mutation, or a hidden prompt.
5. **Keep the agent moving on your terms.** Ordinary Auto Nudge remains a once-per-confirmed-terminal-turn foreground feature. A separate default-off background permission can keep exactly one explicitly owned thread eligible while the operator visits Settings or another chat, with the visible round/time caps, pause/resume/stop controls, normal-history messages, durable turn dedupe, cross-tab Web Lock, and projection timeout described above. Unsupported or denied locking leaves background continuation off. Usage and Model Pacing help decide when and how hard to continue. Ultra Caching and the Audit and Repair skill reduce avoidable recontextualization, while provider-reported cache counters and observed compaction remain separate measurable signals rather than an invented savings total.
6. **Hear completion, not conversation.** The alert system watches the same terminal transition used by Auto Nudge, then plays only a chosen ping/custom clip or one of the two fixed completion phrases. It never narrates prompts, answers, paths, filenames, or project content. Native bilingual stereo is capability-gated; browser fallback is clearly identified.

### What Persists, What Does Not

- **Fresh first round:** Only a genuinely new Club Code Client Settings profile gets the operator-inspired scene. Matrix starts enabled in regular synchronized **Rainbow**—not Rainbow Extra—at `0.55` opacity, speed `4`, density `2.5`, and a `0.45` Japanese ratio, with 2ch enrichment, bounded live-work vocabulary, and Matrix-colored activity links enabled. Rainbow Extra remains selectable. The video surface starts in custom layout with bottom-right/large as its preset fallback, floating presentation, and adaptive auto glow at `0.65`. Its saved source remains null, but the bundled Japanese session queue is activated and requests autoplay; the player or browser may deny that request. The bundled ambience GIF starts bottom-left/large/floating with auto glow at `0.35`. Workflow Observatory, the provider usage widget with a two-minute poll, and advisory Model Pacing with a 5% reserve are on.
- **Desktop launch and privacy:** The main desktop window opens maximized on every launch because this checkout does not persist outer-window geometry. Whole-window transparency remains disabled and effectively opaque; `0.84` is the missing-setting/reset slider value for when the operator enables it, while an existing explicit desktop setting remains untouched. The visual seed is written only when Client Settings do not exist. Existing Client Settings are not overwritten, and onboarding completion, projects, threads, local paths, provider/account state, capture state, and custom session geometry are not copied into repository defaults. Live-work terms and activity links consume only bounded, sanitized provider evidence; they can be disabled independently at any time.
- **Persisted preferences:** atmosphere and Matrix color/activity controls; streaming/image source, image-cycle asset references, interval, preset, presentation, and glow choices; Auto Nudge mode, background permission, and hard caps; usage/pacing settings; completion-alert choices; Atmosphere Console preferences; and supported desktop opacity. Validated custom completion clips stay in per-device browser storage rather than provider context. Auto Nudge’s one-thread owner/dedupe ledger is bounded local browser state; Client Settings follow their connected server, other console/ledger data stays in bounded browser storage, and native opacity is desktop-local. Older settings documents decode through bounded defaults.
- **Persisted private ambient content:** validated uploaded ambient images/GIFs are stored by the local server and referenced by Client Settings. Replacement/removal uses reference-aware cleanup; selected directory and relative paths are never persisted. This is not the same lifecycle as Local Media.
- **Session-only by design:** local file URLs, direct/VLC queues plus layout/glow/visualizer state and custom drag coordinates, `.txt` YouTube queues, owner playlist grants, display-audio streams, browser snapshots/sensitive fields, provider-browser grants/bearers, VLC playback tokens, and the active Atmosphere Console command. Closing or clearing the owning surface tears these down. A chat `.txt` selection becomes ordinary visible draft text, so it follows the draft/message lifecycle rather than the media queue lifecycle.
- **Read-only views:** Workflow/Workspace Observatory projections, file previews, and SQLite panes. They do not write to files or databases and do not silently add their contents to model context.
- **External capabilities required:** public YouTube search needs a server-side API key; owned-playlist discovery needs the explicitly enabled desktop OAuth client; VLC playback needs an installed VLC; native voices must be installed in the OS; LM Studio must already be serving locally; whole-window opacity and supervised-browser actions must pass their desktop capability checks.
- **Compatibility names remain on purpose:** the product says **Club Code**, while `@cafecode/*`, `cafe-code`, `CAFE_CODE_*`, `.cafe-code`, and existing protocol/data identifiers remain where changing them would break upstream compatibility or existing installs.

### Turn On the New Toys

Atmosphere, image/GIF, streaming, local media, observatories, usage, completion audio, and opacity controls live in their labeled Settings sections when the connected server and desktop expose the matching capability. Workflow lives in **Plan | Workflow**. Round globe and atmosphere-console launchers stay out of the way until opened.

Public YouTube search keeps its Data API key on the server. Enable both values before launching the backend:

```bash
CAFE_CODE_YOUTUBE_PUBLIC_DISCOVERY_ENABLED=true
CAFE_CODE_YOUTUBE_API_KEY=your_server_only_key
```

Owned-playlist discovery is deliberately desktop-local and stays off unless both of these are configured before launching the local backend:

```bash
CAFE_CODE_YOUTUBE_ACCOUNT_CONNECTION_ENABLED=true
CAFE_CODE_YOUTUBE_OAUTH_DESKTOP_CLIENT_ID=your-desktop-client.apps.googleusercontent.com
```

Enable the YouTube Data API, complete Google's consent-screen setup, and use a Desktop OAuth client ID. Club Code uses Google's Desktop-app loopback form, `http://127.0.0.1:<Club Code backend port>`, with the backend's actual port and no added path. The grant is per owner session and memory-only—no refresh token is written at rest—and remote-web backends do not expose this connection flow.

For LM Studio, start its local API server on `localhost:1234`, open Settings > Providers, choose **Add provider**, then choose **LM Studio**. Club Code creates a separate local Codex OSS instance; select that instance in a chat just like any other provider. Cloud login is not required for the local instance, and an existing cloud Codex instance is left alone.

VLC must be installed for the desktop VLC lane. Native speech depends on voices installed in the operating system. YouTube search/account discovery requires the configuration above. Capability gates, operating-system support, native smoke tests, licensing, packaging, performance, and security reviews still decide what is exposed in a release. A sparkly sign is not a release commitment. Mm. Responsible.

## Why Fork?

Because the app should stay small, fast, and predictable.

Bug fixes are welcome. Performance fixes are welcome. Reliability fixes are
welcome. Security fixes are extra welcome.

Feature requests need to pass the tiny-window test: does this make Club Code
smaller, calmer, faster, easier to understand, lower CPU, lower memory, or less
annoying when something fails?

If yes, maybe.

If it turns Club Code into a pretend editor, a pretend terminal, a release
dashboard, a project-management suite, or a museum of buttons, no.

## What Changed From T3 Code

This is the practical working list. It will probably get cleaned up later.

- Completely rewrote the lifecycle system to be more inline with Codex and Claude.
- Numerous bug fixes.
- Excessive debugging information.
- Rebranded the fork around Club Code while retaining Cafe Code package, command,
  environment-variable, and data-path identifiers for compatibility.
- Moved local app data into `~/.cafe-code`.
- Removed the in-app terminal drawer and terminal UI.
- Removed hosted web-app assumptions and focused the project on the Electron app.
- Added separate source-branch and packaged-release update checks. Packaged
  download/install behavior remains platform- and artifact-gated; unsigned
  artifacts are not publisher-authenticated.
- Added a queue/follow-up workflow for prompts sent while a provider is running.
- Added provider-aware queue actions: steer when supported, interrupt when that
  is the honest behavior.
- Added thread moving between project folders and working directories.
- Added "Move to Recycle Bin", "Recently Deleted", restore, permanent delete,
  and empty recycle bin flows.
- Added a default editor setting for VS Code, Antigravity, Finder, or system
  default.
- Made file-change rows and path pills open real paths instead of truncated
  display text.
- Added a localhost-only debug endpoint behind `--cafe-debug`.
- Reduced needless Git polling and checkpoint churn.
- Hardened hidden checkpoint handling, ignored-file capture, and old ref pruning.
- Fixed provider/session edge cases around reconnects, stale running state,
  resume metadata, and null checkpoint timestamps.
- Removed or hid features that do not belong in a minimal coding-agent shell.

## Run From Source

For this fork, the dependable path documented here is a source checkout.
Packaging and updater code exists, but build/native-smoke evidence is not the
same thing as a signed, notarized, publisher-authenticated release. This source
guide does not promise that a DMG, installer, or in-place update is available
for the current checkout.

The npm package exists, but do not treat it as the fresh install path yet. It
will probably be out of date until Club Code settles down a little more. The app
is in pretty good shape now, but the fastest-moving build is still the repo
itself.

Windows has recorded production-build, desktop-smoke, and native
whole-window-opacity coverage. The Matrix color, adaptive-YouTube-glow,
composer-text, bundled YouTube queue examples, and Japanese session-default
slices passed the dated 2026-07-23 focused/composite evidence recorded in the
project plan. That evidence predates the newer Matrix telemetry, ambient
directory, LM Studio provider, observatory, provider-browser, background-nudge,
local/VLC queue, and live-frame-glow changes; their focused and independent
audit evidence is tracked separately while a fresh final composite run remains
pending. macOS remains the most established upstream path. Linux may still need
platform-specific tweaking.

Install Node.js 24.13.1 and Corepack, then run Club Code from a checkout. The
repository pins the exact Yarn release through Corepack:

```bash
git clone https://github.com/John-Ryan21337/club-code.git
cd club-code
corepack enable
corepack yarn install --immutable
corepack yarn build:desktop
corepack yarn workspace @cafecode/desktop start
```

Debug mode:

```bash
corepack yarn workspace @cafecode/desktop start --cafe-debug
```

### Browser Web UI Firewall Ports

If you want to open the Club Code Web UI from another device on your LAN, first
enable network/LAN access in Club Code, then allow the desktop backend ports
through your firewall. The default desktop ports are:

- HTTPS/WSS Web UI: `3775/tcp`
- HTTP/WS fallback and certificate bootstrap page: `3773/tcp`

For `ufw`:

```bash
sudo ufw allow 3775/tcp comment 'Club Code HTTPS'
sudo ufw allow 3773/tcp comment 'Club Code HTTP'
```

For local development with `corepack yarn dev:desktop`, the default ports are:

```bash
sudo ufw allow 13775/tcp comment 'Club Code dev HTTPS'
sudo ufw allow 13773/tcp comment 'Club Code dev backend'
sudo ufw allow 5733/tcp comment 'Club Code dev Vite'
```

If Club Code prints a different port, or you run with `CAFE_CODE_PORT`,
`CAFE_CODE_HTTPS_PORT`, `CAFE_CODE_DEV_INSTANCE`, or
`CAFE_CODE_PORT_OFFSET`, allow the printed port instead.

### Saved Remote Servers

The Connections settings can save direct connections to other reachable Cafe
Code servers using a pairing URL or a host plus pairing code. Club Code scopes
projects, threads, providers, and live subscriptions to the selected server.

Club Code does not create SSH or Tailscale tunnels. Configure the network,
certificate, firewall, or reverse proxy separately, then use the server's
pairing details. Desktop credentials are encrypted with Electron safe storage;
browser credentials are retained only for the current browser session.

If you want Codex or Claude to do it for you, paste this into the CLI:

```text
Install Club Code from source. Clone https://github.com/John-Ryan21337/club-code.git, install Node.js 24.13.1 and Corepack, run corepack enable, run corepack yarn install --immutable, run corepack yarn build:desktop, then start it with corepack yarn workspace @cafecode/desktop start. Also verify Codex CLI is installed and logged in with codex login, and Claude Code is installed and logged in with claude auth login if I want Claude support.
```

The old npm path is still here for later, but it may lag behind current work:

```bash
npx @cafeai/cafe-code
npm install -g @cafeai/cafe-code
cafe-code
```

Club Code expects at least one provider to already be installed and
authenticated:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- OpenCode: install [OpenCode](https://opencode.ai/docs/) and configure at least one upstream provider, or configure Club Code with an existing OpenCode server URL

Club Code currently ships Codex, Claude, and OpenCode provider integrations.

## Local Development

Run the app from a checkout:

```bash
corepack yarn install --immutable
corepack yarn start:desktop
```

Run the desktop package directly:

```bash
corepack yarn workspace @cafecode/desktop start
```

Debug mode:

```bash
corepack yarn start:desktop:debug
```

The app prints a localhost-only debug URL on startup.

Useful checks:

```bash
corepack yarn fmt
corepack yarn lint
corepack yarn typecheck
corepack yarn test
```

### Local Arch Package

Build a local pacman package from the Linux AppImage artifact:

```bash
corepack yarn install --immutable
corepack yarn dist:arch:local
sudo pacman -U release/arch/cafe-code-*.pkg.tar.zst
```

To build and install in one step:

```bash
corepack yarn dist:arch:local --install
```

This helper builds a package from the current checkout and does not publish
anything.

### AUR Source Package

The compatibility-named `cafe-code` AUR directory is currently a legacy
upstream recipe: it pins `cafeai/cafe-code` version `0.0.51`, not this Club Code
checkout. It is useful as packaging scaffolding, but do not publish or install
its result as current Club Code. To inspect/build that pinned recipe on Arch
Linux:

```bash
corepack yarn dist:aur:cafe-code
```

The package is written to `packaging/aur/cafe-code/`. Its `PKGBUILD`, generated
`.SRCINFO`, launcher, desktop entry, and packaging license are kept in that
directory so it can also be used as the contents of the standalone AUR Git
repository.

If you intentionally maintain that legacy upstream AUR listing, its metadata
can be staged with:

```bash
git clone ssh://aur@aur.archlinux.org/cafe-code.git ../aur-cafe-code
cp -a packaging/aur/cafe-code/. ../aur-cafe-code/
cd ../aur-cafe-code
makepkg --printsrcinfo > .SRCINFO
git add .gitignore .SRCINFO LICENSE PKGBUILD cafe-code.desktop cafe-code.sh
git commit -m "Initial cafe-code package"
git push
```

Before this can become a Club Code AUR package, update the upstream URL, source
commit/tag, checksums, version, package description/branding, and generated
`.SRCINFO`, then audit the installed AppImage and launcher. Merely changing
`pkgver` is not enough.

### Debian Package

Build a Debian package for the host architecture:

```bash
corepack yarn install --immutable
corepack yarn dist:desktop:deb
```

Explicit architecture targets are also available:

```bash
corepack yarn dist:desktop:deb:x64
corepack yarn dist:desktop:deb:arm64
```

The package is written to `release/`. Install the emitted file with your
graphical package installer or with `sudo apt install ./release/<file>.deb`.

## 日本語でも、もう一杯。え、まだ飲むのぉ？

いらっしゃぁ〜い、Club Code へようこそ。ね、こっち。もっとこっち座ってぇ。
あたし？　全然酔ってないよ。シャンパン三杯と、Git の差分をロックで一杯だけ。
終電は？　あ〜……行ったね。歌舞伎町の午前三時に終電の話する人、初めて見た。かわいい。お水ちょうだい。

Club Code は Cafe Code の深夜 fork。表の看板は最初から **Club Code** だけど、
package、command、`CAFE_CODE_*`、`.cafe-code` は互換性のため残してるの。
名前を変えたからって常連さんのボトルまで捨てないでしょ？　そういうこと。あたし気が利くぅ。乾杯。

Codex、Claude、OpenCode、それから外で起こしてある LM Studio の model と話せる小さい desktop app。
editor のふりも terminal のふりもしない。新しい file/database の席は見るだけ、勝手に書き換えない。
ここは chat と agent の仕事を見る club。小さいのに朝まで働く。あたしも働いてるよ？　今これ説明してるし。

ねぇ、ここから本当にすごいから聞いて。メモは読める。字が二重に見えるだけ。

- **雪・雨・Matrix**を窓ぜんぶに降らせるの。off、透明度、速さ、密度まである。Matrix はローマ字・記号↔日本語の stream を 0〜100% で混ぜて、live work term も English↔日本語で同じ比率。AI coding に似合う漢字、2ch っぽい文字、たまに猫 AA もね。色は五つよ、一色固定、全員そろって虹、一本ずつ違う位相で虹になる **Rainbow Extra**、音で全員そろって反応、音で一本ずつ別位相の Rainbow Extra。beat と bass/mid/treble の小さい bounded signal だけで踊るの。direct/VLC はそのまま、YouTube/Spotify はあなたが visualizer 用に許可した display audio 一本だけを一緒に使う。二回目の capture も microphone も iframe の盗み聞きもなし。PCM や bins や履歴も残さないし、quiet/stale/stop なら「鳴ってるぅ」って盛らず固定色へ戻る。もう一つ独立した switch で、provider が本当に見せた NETWORK↔FETCH、DATABASE↔QUERY、BUILD↔COMPILE と安全な日本語の組だけ短く光らせられる。同じ category の二件が、provider の exact item か tool identity まで同じ時だけ、水平と ±60° だけの hex route を引くの。agent が同じ、operation 名が似てる、時間が近い、それだけで恋の矢印みたいに結ばない。線の色は一本ずつ random か、選んだ Matrix 色と回る rainbow に合わせるか選べて、真っ白な packet が fading trail を引いて走り、両端も pulse。reduced motion なら薄い静止線だけ。prompt、command、SQL、URL、秘密、見えてない通信は絶対に降らせない。クリックも奪わない。画面だけ強い。あたしもこういう照明ほしい。
- **Atmosphere Console**は `321, 280`、`622 × 477.5` の custom 席から始まって、小さい画面ならちゃんと内側へ収まる係。corner anchor へ戻してもいいし、動かして resize もできる。「snow」「density 80」「next song」みたいな命令は local parser だけだから model token はゼロ。必要なら `127.0.0.1:1234` の LM Studio に短い一文だけ解釈させるけど、chat、project、file は渡さないし、cloud へ逃げない。環境係に人生相談させない。仕事分け、大事。
- **画像/GIF は一枚でも directory ごとでもいいの。** 一枚を選ぶ昔の道は残して、一 asset 10 MiB まで。左下・右下、small / medium / large / custom、mouse/keyboard の drag と resize、edge glow もそのまま。desktop で directory を選ぶと最大 128 件だけ見て、検査に通った PNG/JPEG/WebP/GIF を合計 80 MiB まで安定した順で最大 24 枚、source path も relative path も覚えず content-addressed の private asset だけにする。local profile は 160 MiB 上限だから、replace の設定書き込みが成功するまで旧/new の最大 80 MiB cycle を短時間だけ安全に共存できて、asset/request の検査上限は緩めない。cycle は別 switch で、3 秒〜1 時間、前・次も手で押せる。Floating は角のお席、**Theater** は chat media の中いっぱいに blurred backdrop。勝手に始めないし、video と席かぶりで揉めない。酔ってる店ほど席順は大事なの、ほんとよぉ。
- **YouTube**は video、playlist、公開検索、それから URL を一行ずつ入れた session-only `.txt` queue。さらに、お客さまがくれた URL を一文字も盛らずに置いた [Japanese music example](./examples/youtube-url-queues/JPMusic.txt) は commit 済み 39 行、そのうち strict parser が受けるのは 36、10 文字しかない malformed ID 三つはちゃんと report。[EDM example](./examples/youtube-url-queues/EDMYoutubeList.txt) は commit 済み 20 行、accepted 19、malformed な 10 文字 ID 一つを report。ね、酔ってても 39 と 36 を同じって言わない。saved ambient-video source がない untouched renderer session なら Japanese session queue を初期化する。video surface が on の時だけ playback を request して、fresh profile はそこも on だから最初の accepted item に autoplay を request。source は null のまま、parsed queue も persist しないけど、browser policy、YouTube policy、embed 不可、unavailable item なら再生されないことはある。既存の persisted ambient-video source は上書きしないし、いったんあなたが clear するか別の queue/source を選んだら、その session はあなたの指名が勝つ。二つとも Settings から選び直せて、repo に残るのは public example file、parse 後の queue は session-only。前・次・skip があるし、再生不可なら bounded に次へ進む。floating、custom、Cinema、player 本来の fullscreen は別々。Cinema は project が左、video が中央、chat が右。account 接続は local owner が playlist を探すための memory-only PKCE で、Premium login でも password 預かりでもない。private/non-embeddable が急に再生できる魔法でもない。そこ盛ったら怒られるから、酔ってても盛らない。
- **光る edge glow**は fixed color をちゃんと残す。YouTube の adaptive は検査済み current video ID の public thumbnail artwork から上・右・下・左の色を作るだけで、cross-origin iframe の pixel、音、cookie、credential、screen は読まない。direct/VLC video は、あなたが選んだ今の player だけを 750 ms ごとに使い捨て 32×18 canvas へ小さく写して四辺の色を出せる。canvas はすぐ空、frame も pixel も path も palette history も model context も残さない。hidden/background/close なら止まり、reduced motion は静止、unready/tainted/denied は即 fixed、勝手な retry も三回でおしまい。Spotify は fixed のまま。見えない色を「見えたぁ」って盛らない照明係、酔ってるあたしより堅い。ちょっと悔しい。
- **Spotify**は official Embed だけ。対応 URL の type と ID だけ残して、login、Premium、DRM、再生は Spotify に任せる。account connector、library browser、アプリ内検索ではないよ。勝手に裏口を作らない。うち、入口は派手でも裏は堅いの。
- **Local Media**は一回の session で対応 audio/video を最大 64 file、合計 64 GiB まで queue にできる。direct は今の一件だけ `blob:`、desktop の **Open with VLC** も installed VLC と private token 付き loopback で今の一件だけ。FLV、MKV、AVI、WMA、transport stream とか VLC の広い codec が同じ floating/custom/Cinema/background player に来る。前・次・manual skip、終わったら次へ、error は一周だけ bounded skip。renderer が見るのは current index/count、安全に短くした filename title、opaque queue/playback token だけで original path は出ないし、ずっと同じ queue ID と一曲ごとに変わる URL も混ぜない。desktop picker は duplicate、symlink、device、directory、non-regular を入口で断って、browser queue は malformed や MIME/extension spoof を通さない。移動、replace、clear、owner close、shutdown で古い object URL か VLC child、private file、request、token、port まで片付ける。rich metadata 抽出、network stream、勝手な VLC argument、全 codec 必勝保証はまだない。帰ったお客さんのグラスを朝まで置かないタイプだけど、メニューにない酒まで出たふりはしない。
- **Visualizer**は Spectrum と、local bundle の Butterchurn/MilkDrop **395 styles**。検索、前、random、次、自動 cycle、blend まである。browser/VLC media は直接反応。YouTube/Spotify は、あなたが Chromium の picker で tab/window/system audio を明示的に share した時だけ。microphone fallback、録音、upload、iframe の音抜きはなし。share を止めたら分析も止まる。ちゃんと同意を取る男みたいでいいね。男じゃないけど。
- **Workflow Observatory**は provider が出した plan、tool、agent hierarchy、時間、activity を、読みやすい list のままでも、pan/zoom できる node-edge graph でも見る。線は本当に報告された parent だけ。missing と cycle を勢いで恋人同士にしない、関係ない子は関係ないの。**Workspace Observatory**は read-only file tree、上限付き/redacted text、検査済み read-only SQLite、provider-observed の agent 色 focus、最大八枚 tile。開いて見えてる pane だけ 1〜5 秒で refresh、pause/resume、古い返事は捨てる。code の line change は default off で上限つき。DB row は安全な primary key が全部そろった時だけ add/remove/change を言って、なければ「snapshot changed」だけ。誰が書いたかは絶対に酔った勘で決めない。provider が全部の file edit や DB operation を出すわけじゃないのも正直に言う。見る席であって edit 席じゃないし、眺めるだけで model context も増えない。
- **中の Browser**は temporary sandbox 一枚。Node off、popup/download block、exact-origin share、assisted action は毎回 native approval。あなた自身は transient sensitive field で credential や 2FA code を一回だけ入れられて、prompt や普通の log には入らない。別の explicit grant を出すと、その時の **Codex か Claude** の exact thread/provider だけが、redacted DOM/accessibility snapshot、fresh target の click、non-sensitive text、同じ credential-free HTTP(S) origin の navigate、back/forward/reload/stop をお願いできる。tab と origin にも縛って、default 5 分、1〜10 分、最大 40 request、queue は四つ、action timeout 90 秒。bearer、typed value、queue、result は process の外へ持ち出さず、tab/origin/thread/provider がずれた時、期限、上限、stop/restart/shutdown、あなたの revoke でおしまい。もちろんお願い一件ごとに native approval、勝手に連打はしない。OpenCode はまだこの安全な道がない。agent は password、token、OTP、CAPTCHA、sensitive field を type できないし、pixel OCR、screenshot、inbox/email-code retrieval、CAPTCHA solver、2FA bypass もない。承認した redacted snapshot を composer へ見える形で渡す別の道は残す。見えないものを「見えたぁ」って言う子、信用できないでしょ。
- **Chat の paperclip**は最初から **All Files**。もう Images の filter から `.txt` を探して迷子にならない。image は今までの attachment、plain `.txt` は OS が MIME type を空で渡しても拡張子で見つけて、UTF-8 か BOM 付き UTF-16 を 256 KiB まで読む。filename 付きで composer に中身を見せてから共通 text prompt として送るから、Codex も Claude も OpenCode も YouTube URL list を読める。最終的には 120,000 characters の message 上限が優先。binary や unsupported file は黙って消えず error、何でも upload できる裏口ではないよ。入口は All Files でも厨房は検品するの。えらい。
- **Auto Nudge、でも不死身の妖怪はお断り。** terminal turn の五秒後に送る文は今まで通り、きっちり `Fan out and keep going` か `Keep a few lanes going, make steady progress` だけ。普通の foreground 動作と端末全体の mode 保存もそのまま。そこに別の default-off switch を足して、あなたが指名した chat **一つだけ** app-level の background owner にできる。Settings に寄り道しても controller は席を立たない。一回の run は初期値 5 rounds / 30 分、変更しても 1–20 rounds / 5–120 分の硬い上限つき。pause、resume、stop、owner の移動、message ID と消費した terminal turn が見える bounded ledger もある。manual/offscreen draft、queue や確認待ち、provider/transport trouble、消えた thread、archive、settings disable、上限でちゃんと停止。background で送る直前は Chromium/Electron の exclusive Web Lock を取って durable state を読み直すから、別 tab と同時に酔った勢いで二通送らない。先客が lock を持ってたら今回は送らず次の bounded tick、lock 機能がないか request 自体を拒否されたら pause/fail-closed、unsupported surface は control も理由つきで unavailable。送る前に turn を消費するから reload で二重送信しないし、時計の逆戻りや古い callback でも蘇らない。送った user row が 60 秒たっても projection に現れなければ、あやしい夜は続けず pause。勝手に永遠 fan-out する子じゃないの。そういう重い子、店でもアプリでも困るでしょ。
- **Usage と Model Pacing**は、provider が本当に出した remaining/reset を一〜五分ごとに見る。残り時間と allowance と reserve を比べて pace を案内するけど、quota を作ったり勝手に model を変えたりしない。model 別の cache-read/cache-write/observed compaction も別々に表示。足して「saved total」にしたり、反実仮想の請求額にしたりしない。架空の節約額でシャンパン入れさせない。良心的ぃ。
- **Ultra Caching**は、Codex の stable structured handoff と 120k の早め compaction ceiling、Claude の stable compact handoff で、持ち回る context を軽くして cache-friendly にする。効果は provider 次第だから、実測 counter で見る。persistent な階層 summary/index はまだない。bundled **Audit and Repair** skill は reviewer がその場で直して test まで持つけど、Club Code が自動で何周も orchestrate/enforce する workflow ではまだない。audit 済みの頭を別の fixer にもう一度説明しないぶん、recontext token を無駄にしにくい。ね、ちゃんと考えてるでしょ。褒めて。
- **Completion Audio**は default off、同じ turn が `running → completed` になった時だけ。短い original 二音 ping、または一個 5 MiB / 15 秒までの local MP3/WAV を最大八個、device の browser storage に置いて cycle。声は固定の「Task complete.」「作業が完了しました。」だけで prompt は読まない。英/日と male/female preference を別に選べて、Windows native なら日本語左＋英語右を同時、または逆。female は日本語なら Haruka、次に Ayumi、英語なら Zira を優先するよ。Haruka も Ayumi もいなければ英語 voice で日本語のふりをせず「入ってない」と言って、Microsoft の Add voices 案内と refresh button を出す。入れて戻れば見つけるからね、かわいく喋る準備だけしておいて。browser fallback は center/sequential と正直に表示。voice pack は同梱してないし、macOS/Linux に Windows と同じ native stereo path はまだない。ずっと喋らない。完成だけ。あたしより静か。
- **窓全体の透明度**は native Electron window に 65〜100% の安全な範囲で適用。packaged Windows は smoke 済み、未検証 surface は fail-closed。KDE/Konsole acrylic や blur、完全に消える窓そのものじゃなく窓全体の fade。まとめて reset すれば atmosphere/media/opacity を止めて session media も clear。透明なのは窓だけ、責任まで透明にはしない。
- **Local model**は Settings > Providers に **LM Studio**ってちゃんと別の指名札があるの。選ぶと普通の chat/thread で使える別 routing の Codex OSS instance を作って、`codex --oss --local-provider lmstudio app-server` で外に起こした `localhost:1234` へ行く。cloud login check は local mode では不要、local と cloud の model list も混ぜないし、いつもの Codex 指名を勝手に着替えさせない。LM Studio 本体は同梱しないから先に起こしてね。別会計、そこだけは泥酔でも伝票を混ぜない。

### で、実際どう使うの？　もう一杯ぶんだけ説明するね

飾りをいっぱい足したけど、ばらばらに騒ぐ子たちじゃないの。ちゃんと同じ club で働く。

1. **最初にお部屋を決める。** atmosphere、Matrix の言語と色、streaming/image の preset と glow、completion alert、Auto Nudge、usage polling、対応 desktop の opacity は保存される preference。direct/VLC Local Media の layout/glow/visualizer は renderer session だけ。presentation reset なら飾りと media preference をまとめて off、session playback も片付けるけど、project や chat は消さない。そこ間違えたら修羅場だから。
2. **背景を連れてくる。** corner GIF 一枚でも、bounded な directory cycle でも、YouTube / Spotify / direct file / VLC player と一緒に置ける。preset size と corner はお行儀いい席、custom は mouse と keyboard で move/resize できる自由席、image Theater は大きい背景席。fixed glow は対応 player で使えて、YouTube は current public thumbnail artwork、direct/VLC video は tiny bounded current frame から adaptive 色を作れる。安全に取れなければ fixed に戻る。Cinema は project rail を左、video を中央、chat を右へ並べ直すだけで、chat を追い出さない。player fullscreen はまた別。席替えと貸切、同じにしないの。
3. **音は同意してからつなぐ。** direct Local Media と private VLC stream は visualizer と bounded Matrix music-color signal へ。cross-origin の YouTube/Spotify は勝手に音を抜けないから、あなたが display audio を share した時だけ。その一本の approved analyser で Spectrum/MilkDrop と Matrix color を一緒に踊らせて、二回目の許可も microphone もなし。share を止めたら両方の反応も止まる。盗み聞きしない club、えらい。
4. **仕事は見せる、作り話は見せない。** Workflow は provider event と plan を list か explicit-parent graph、Workspace は見えてる pane の bounded read-only file/database data と、届いた分だけの explicit file focus。Matrix の activity line も同じ安全な evidence だけ。live focus coverage はまだ不完全、DB writer attribution は unknown のまま。agent の色、親子関係、経過時間、line、「止まったかも」は evidence の見せ方で、chain-of-thought じゃないし、二人目の scheduler でもないし、file/database をこっそり書き換えたりもしない。
5. **続けるかはあなたが決める。** 普通の Auto Nudge は visible chat の confirmed terminal turn に一回だけ。別の default-off background permission を入れて指名した一 thread だけは、Settings や別 chat を見てても、上の round/time cap、pause/resume/stop、普通の history、durable dedupe、exclusive cross-tab Web Lock、projection timeout を守って続けられる。lock が使えない時は黙って弱い道へ行かず background を unavailable にする。Usage と Model Pacing で残りと reset を見て、Ultra Caching と Audit and Repair で recontext の無駄を減らす。cache reuse と observed compaction は別々に見て、架空の saved total にしない。気分で盛らない。ボトルの本数も token も会計は正直。
6. **喋るのは完成した時だけ。** Auto Nudge と同じ terminal transition を見て、選んだ ping/custom clip か固定の二文だけ鳴らす。prompt、answer、path、filename、project は読まない。native bilingual stereo は voice capability がある時だけで、browser fallback は fallback ってちゃんと名札を付ける。あたしみたいにずっと喋らない。……今のは説明だから別ね。

### 覚えるもの、朝になったら忘れるもの

- **最初の一杯だけ、この席ね:** 本当に新しい Club Code の Client Settings だけ、この visual preset。Matrix は **普通の Rainbow**、みんな同じ色で回る方ね。Rainbow Extra じゃないよ、Extra はあとで選べる。opacity `0.55`、speed `4`、density `2.5`、日本語 ratio `0.45`、2ch、bounded live-work、Matrix 色の activity link は on。video は custom layout、preset fallback は右下/large、floating、adaptive auto glow `0.65`。saved source は null のままだけど Japanese session queue を active にして autoplay を request するから、止めたい時は switch を off。browser や YouTube に断られる時はあるよ、そこまで口説ける魔法はないの。bundled ambience GIF は左下/large/floating、auto glow `0.35`。Workflow Observatory、二分ごとの usage widget、reserve 5% の advisory Model Pacing も on。最初から照明はいい感じ、でも全部あとで選び直せる。
- **main window と常連さんのボトル:** outer-window の geometry はまだ保存しないから、main desktop window は毎回 maximized で開く。whole-window transparency は disabled、つまり実効 opaque のまま。`0.84` は setting がない時/reset 後の slider 値で、既存の明示的 desktop setting は触らない。first-round profile を書くのも Client Settings がまだない新規だけ。既存 Client Settings は overwrite しないし、onboarding 完了、project、thread、local path、provider/account、capture、session の custom 座標も repo default へ copy しない。live-work と activity link が使うのは bounded/sanitized な provider evidence だけで、それぞれいつでも off にできる。誰かの席札まで GitHub に上げたら営業停止でしょ。そこは素面。
- **保存する preference:** atmosphere/Matrix の色と activity、streaming/image の source・cycle asset reference・interval・preset・presentation・glow、Auto Nudge の mode・background permission・hard caps、usage/pacing、completion alert、Atmosphere Console、対応 whole-window opacity。検査済み custom completion clip は provider context じゃなく device の browser storage。Auto Nudge の一 thread owner と dedupe ledger は bounded local browser state。Client Settings は接続 server、ほかの console/ledger は bounded browser storage、native opacity は desktop-local と scope も分ける。古い settings も bounded default で安全に読む。昨日のお客さんも入口で転ばせない。
- **private に保存:** 検査済みの ambient image/GIF は一枚でも cycle 分でも local server に保存して、Client Settings から参照する。replace/remove は reference を確認して片付けて、選んだ directory path と relative path は保存しない。Local Media と同じ一夜だけの扱いじゃないよ。
- **session が終われば片付け:** local file URL と direct/VLC queue、layout・glow・visualizer state と custom 座標、YouTube の `.txt` queue、owner playlist grant、display-audio stream、browser snapshot/sensitive field、provider-browser grant/bearer、VLC playback token、いま打った Atmosphere Console command。clear/close した席のものは残さない。chat で選んだ `.txt` は見える普通の draft text になるから、media queue じゃなく draft/message の寿命についていく。忘れ物管理、厳しめ。
- **見るだけ:** Workflow/Workspace の projection、file preview、SQLite pane。file/database に書かないし、見えた内容を勝手に model context へ入れない。見学席から厨房に包丁投げない。
- **外で用意が必要:** YouTube 公開検索は server-side API key、owner playlist は明示的に有効化した desktop OAuth client、VLC lane は installed VLC、native speech は installed OS voice、LM Studio は起動済み local server、opacity/browser assisted action は desktop capability check。ないものを「ありますぅ」で通さない。歌舞伎町でもそこは契約書。
- **昔の名前が残るところ:** 看板と UI は **Club Code**。でも `@cafecode/*`、`cafe-code`、`CAFE_CODE_*`、`.cafe-code`、既存 protocol/data ID は compatibility が壊れる場所では残す。改名祝いで常連のボトル札まで捨てたら怒られるでしょ。そういうこと。

飾りは全部 switch で戻せる。本当に真っさらな Club Code だけ上の first-round profile、既存 settings はそのまま。
Japanese queue の playback request 以外は、capture、account 接続、browser grant、Auto Nudge、voice を勝手に始めない。Settings には connected
server/desktop が本当に持ってる capability だけ出す。Workflow は `Plan | Workflow`、Workspace と Browser は
full-window の席。きらきら optional、仕事 main。順番だけは酔ってない。

YouTube のアプリ内公開検索を使う server は、起動前にこれ。API key は browser に渡さないよ。

```bash
CAFE_CODE_YOUTUBE_PUBLIC_DISCOVERY_ENABLED=true
CAFE_CODE_YOUTUBE_API_KEY=your_server_only_key
```

自分の YouTube playlist を見る desktop-only の接続は、local backend 起動前にこれも。

```bash
CAFE_CODE_YOUTUBE_ACCOUNT_CONNECTION_ENABLED=true
CAFE_CODE_YOUTUBE_OAUTH_DESKTOP_CLIENT_ID=your-desktop-client.apps.googleusercontent.com
```

YouTube Data API と consent screen を設定して、Desktop OAuth client ID を使ってね。callback は Google の Desktop app 用 loopback 形式、`http://127.0.0.1:<Club Code backend port>`。backend の実際の port を使って、余計な path は足さないの。owner session の memory だけで、refresh token は disk に置かない。remote web はこの接続を出さない。ね、約束を盛らないのもサービス。

LM Studio は local API server を `localhost:1234` で起こして、Settings > Providers の
**Add provider**から **LM Studio**を指名。別の local Codex OSS instance ができるから、chat で普通の provider みたいに選ぶの。local instance は cloud login いらないし、いつもの cloud Codex はそのまま。伝票わけた、はい乾杯。

VLC lane には VLC の install、native voice には OS voice の install が必要。
実際の release は OS、capability gate、native smoke、license、security、performance 次第。
看板が光ってても未出荷を「あるよぉ」って売らない。約束は出せる時だけ。大人でしょ。たぶん。お水まだぁ？

### ソースから動かす

この fork で今ちゃんと案内してる道は source checkout。packaging support と
native smoke があっても、署名して配ってる installer と同じ意味じゃないからね。
この README は DMG、updater、notarized bundle を約束してないよ。
npm のパッケージもあるけど、今はそれを信じすぎないでね。
Club Code がもう少し落ち着くまでは、npm はたぶん少し古くなる。

Node.js 24.13.1 と Corepack を先に入れてね。Yarn のバージョンは
リポジトリ側で固定してあるよ。

```bash
git clone https://github.com/John-Ryan21337/club-code.git
cd club-code
corepack enable
corepack yarn install --immutable
corepack yarn build:desktop
corepack yarn workspace @cafecode/desktop start
```

デバッグしたいならこれ。

```bash
corepack yarn workspace @cafecode/desktop start --cafe-debug
```

LAN の別デバイスから Club Code の Web UI を開きたいなら、先に Club Code
側でネットワーク/LAN アクセスを有効にして、ファイアウォールでこのポートを開ける。

- HTTPS/WSS Web UI: `3775/tcp`
- HTTP/WS のフォールバックと証明書案内ページ: `3773/tcp`

`ufw` ならこれ。

```bash
sudo ufw allow 3775/tcp comment 'Club Code HTTPS'
sudo ufw allow 3773/tcp comment 'Club Code HTTP'
```

`corepack yarn dev:desktop` の開発中は、デフォルトではこっち。

```bash
sudo ufw allow 13775/tcp comment 'Club Code dev HTTPS'
sudo ufw allow 13773/tcp comment 'Club Code dev backend'
sudo ufw allow 5733/tcp comment 'Club Code dev Vite'
```

Club Code が別のポートを表示しているときや、`CAFE_CODE_PORT`、
`CAFE_CODE_HTTPS_PORT`、`CAFE_CODE_DEV_INSTANCE`、`CAFE_CODE_PORT_OFFSET`
を使っているときは、その表示されたポートを開けてね。

Windows は production build、desktop smoke、whole-window opacity の native coverage が記録されてるよ。
Matrix color、YouTube adaptive glow、composer text、bundled YouTube queue examples、Japanese session default は、project plan にある **2026-07-23 時点**の focused/composite gate を通過済み。39 本を盛って 36 本、EDM は 20 本から 19 本、短すぎる ID は酔ってても勝手に一文字足して誤魔化さないの。でもその記録は、その後に入った Matrix telemetry、ambient directory、LM Studio provider、observatory、provider browser、background nudge、local/VLC queue、live-frame glow より前。新しい子たちは focused test と independent audit を別々に記録中で、最後の fresh composite はまだ。昔の合格印を今日の bottle に貼り替えない、会計ちゃんとしてるでしょ。macOS は upstream でいちばん馴染んだ道。
Linux はまだ platform-specific の調整がいるかも。
でも今の Club Code は、けっこういいところまで来てる。

Codex とか Claude に丸投げするなら、これを投げてもいいよ。

```text
Club Code をソースから入れてください。https://github.com/John-Ryan21337/club-code.git を clone して、Node.js 24.13.1 と Corepack を入れ、corepack enable、corepack yarn install --immutable、corepack yarn build:desktop、corepack yarn workspace @cafecode/desktop start まで実行してください。Codex を使うなら codex login、Claude を使うなら claude auth login も確認してください。
```

npm 版は残しておくけど、今は古いかもしれない。

```bash
npx @cafeai/cafe-code
npm install -g @cafeai/cafe-code
cafe-code
```

Codex を使うなら先に `codex login`。
Claude を使うなら先に `claude auth login`。
そこは自分でログインしておいてね。

```bash
corepack yarn fmt
corepack yarn lint
corepack yarn typecheck
corepack yarn test
```

## License

Club Code is AGPL-3.0-or-later.

The fork keeps the upstream attribution story intact; see the license and notice
files for details.
