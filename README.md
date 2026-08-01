# Club Code

### The original Cafe Code, after hours — with the Club Code sign lit

![Club Code desktop screenshot](./docs/images/cafe-code-desktop-frontpage.png)

Made in Japan with love, too much glitter, and absolutely no chance of catching
the last train.

Alpha notice

Club Code is alpha/testing software. It is provided without
warranties or claims of reliability, fitness for a particular purpose, or
uninterrupted operation. Use it at your own risk, keep backups of important
work, and verify important results.

アルファ版に関する注意

Club Code は現在テスト中のアルファ版ソフトウェアです。信頼性、特定目的への適合性、
無停止動作などについて、いかなる保証または表明も行いません。利用者ご自身の責任で使用し、
重要なデータはバックアップし、重要な結果は確認してください。

> [!CAUTION]
> **Auto Nudge can spend real money quickly.** Automated follow-ups consume real
> provider tokens, credits, quota, or paid usage. You remain responsible for
> provider charges; Club Code maintainers cannot reimburse or assume
> responsibility for those costs. Use conservative caps, exact-thread prompts
> or skills, and active monitoring—including the phone Web UI. Run it unattended
> overnight only when you knowingly accept the cost risk.

> [!CAUTION]
> **Idle Thread Guard can also spend real money.** It is a separate, default-off
> feature that may send one visible status request after an active turn has
> produced no projected transcript, tool, turn, or session activity for the
> configured interval. The minimum is one hour, the default is two hours, and
> activity resets the deadline. A provider may still be doing expensive,
> legitimate work while appearing silent. Use a long interval, monitor the
> thread, and disable the Guard when it is not needed.

> [!WARNING]
> **NO GUARANTEE OF COST CONTROL OR CORRECT OPERATION.** Auto Nudge and Idle
> Thread Guard are experimental alpha/testing features. Their gates, counters,
> activity detection, caps, and stop controls reduce risk but are not perfect
> and are not guaranteed to prevent duplicate, late, unwanted, or paid provider
> requests. Club Code and its maintainers provide no warranty, reimbursement,
> indemnity, or guarantee concerning provider charges, data loss, interrupted
> work, or results. You are solely responsible for configuration, supervision,
> provider bills, backups, and deciding whether to enable these features.

> [!CAUTION]
> **Auto Nudge は短時間で実費を発生させる可能性があります。** 自動 follow-up は、
> provider の token、credit、quota、または有料利用枠を実際に消費します。利用料金は
> 利用者が負担します。Club Code および保守担当者は、料金の補償、返金、または負担を
> 行いません。小さい round cap、対象 thread に限定した明確な指示、および継続的な監視を
> 使用してください。費用リスクを理解して受け入れる場合を除き、無人または夜間で
> 実行しないでください。

> [!CAUTION]
> **Idle Thread Guard も実費を発生させる可能性があります。** これは Auto Nudge とは
> 別の、初期状態で無効な機能です。実行中 turn について、設定時間のあいだ transcript、
> tool、turn、session の activity が投影されない場合に、可視の status request を一回
> 送信することがあります。最小値は1時間、初期値は2時間で、新しい activity があれば
> deadline はリセットされます。表示上は無音でも provider が正当な長時間処理を継続して
> いる可能性があります。長い時間を設定し、thread を監視し、不要な場合は無効にしてください。

> [!WARNING]
> **費用制御および正常動作は保証されません。** Auto Nudge と Idle Thread Guard は
> 実験中の alpha/testing 機能であり、完全ではありません。gate、counter、activity 検出、
> cap、stop control は危険を軽減しますが、重複、遅延、意図しない、または有料の provider
> request を防止する保証はありません。Club Code および保守担当者は、provider 料金、
> data loss、作業中断、結果について、保証、補償、返金、免責補償を提供しません。
> 設定、監視、provider の請求、backup、および機能を有効にする判断は、すべて利用者の
> 責任です。この警告には演出的または比喩的な表現を使用していません。

Current-build end-user documentation:

- [English guide](./docs/club-code-current-build-guide.md)
- [日本語ガイド 🍾✨](./docs/club-code-current-build-guide.ja.md)

_Heeey, darling. Come in, come in. Closer. I am not shouting; the room is just
very far away. Club Code is the late-night fork of Cafe Code: chat goes in,
agents get to work, and the operator gets a whole after-hours control room around
them. Snow in the window? Yes. A little movie in the corner? Yes. One more glass?
Also yes. That one is probably unrelated._

This repository is **Club Code**, an after-hours fork of
[Cafe Code](https://github.com/cafeai/cafe-code), which began as a fork of
[T3 Code](https://github.com/pingdotgg/t3code). The app still uses Cafe Code
package, command, environment-variable, protocol, and data-directory names for
compatibility. New sign outside; dependable regulars behind the bar.

The conversation remains the operational center while observatories, media,
telemetry, automation, profiles, and collaboration expand what operators can see
and control. Read-only surfaces stay read-only unless a capability explicitly
declares, authorizes, and audits a mutation.

<p align="center">
  <img src="./docs/images/cafe-code-character.png" alt="Club Code character" width="360" />
</p>

## Complete Current-Source Differences From Cafe Code

The two current-build guides above are the authoritative current-source
inventory of differences from Cafe Code. They do not by themselves prove that a
particular installer or pull request has been published. This README mirrors
that inventory at feature level:

- **Branding and compatibility:** Club Code is the visible product identity,
  while compatibility-sensitive `cafe-code`, `@cafecode/*`, `CAFE_CODE_*`,
  protocol, and data-directory identifiers remain. The product stays agent-first
  while expanding operator-controlled visibility, presentation, automation, and
  collaboration.
- **Provider runtimes:** Codex, Claude, and OpenCode remain available. On
  Windows, Codex and Claude may use either the operator's system CLI/path or a
  Club Code-managed Node/provider installation. The managed choice isolates the
  executable location, simplifies first-install/update/login discovery, and
  avoids depending on a mutable global `PATH`; it does not include provider
  credentials or free usage, and provider updates still require supply-chain
  trust. System CLI remains the portable, operator-controlled default.
- **LM Studio Local:** A separate provider creates a normal Codex OSS/LM Studio
  instance for loopback or a trusted private LAN. It is not OpenCode and is not
  the narrow Atmosphere Console model fallback.
- **Prompt workflow:** Exact-thread draft recovery, visible durable FIFO
  follow-ups, provider-aware **Steer**, image attachments, bounded visible
  `.txt` import, and camera capture with preview, retake, mobile front/rear
  selection, and system-camera fallback where the browser permits it.
- **Auto Nudge:** Default-off, exact-thread, completion-event-driven standing
  orders with editable text, **Steady Progress** and **Hardcore Fanout**
  starting prompts, per-thread caps, minimized controls, foreground or opt-in
  background continuation, durable completed-turn dedupe, normal-history
  messages, per-thread Stop, and a known-thread emergency barrier. A timer,
  countdown, elapsed-time cap, or periodic cadence cannot authorize a nudge.
- **Idle Thread Guard:** A separate, default-off, exact-thread silence
  safeguard for an already-running turn. It accepts 1–720 whole hours, defaults
  to two hours, resets on projected activity, sends at most one visible status
  request per idle episode, and fails closed until newer activity re-arms it.
  It never grants Auto Nudge authority.
- **Atmosphere effects:** Optional pointer-transparent snow, rain, and Matrix
  layers with Roman/Japanese/2ch/live-work vocabulary, fixed/rainbow/per-stream
  rainbow/music-reactive colors, independent shimmer speed, density through
  `10`, and Flat, Forward, Reverse, Warp, Walk Forward, and Walk Reverse modes.
- **Matrix depth and performance:** Walk modes use full-viewport randomized
  spawn, bounded travel/fade, adjustable 1–144 px endpoints, collision-aware
  spacing, readable uncompressed filenames, center-outward wind, depth-scaled
  glyph routes, and a higher-density 640-stream pool. A synchronized WebGL2
  instanced glyph atlas provides true GPU glyph rasterization when supported;
  Canvas2D remains the automatic fallback and owns snow, rain, and verified
  activity connectors.
- **Verified activity:** Provider-observed network, database, build, and agent
  delegation events may draw bounded Matrix-colored routes, packets, pulses,
  trails, and safe filenames. Prompt text, commands, SQL, secrets, and invented
  activity are excluded.
- **Atmosphere Console:** A transparent, movable, resizable control surface uses
  a zero-token deterministic parser first, then may use a narrow LM Studio,
  Codex, or Claude structured fallback with lightweight models prioritized.
  Only a small safe command vocabulary can change presentation settings.
- **Ambient images and media:** A persistent image/GIF or bounded image
  directory can be cycled manually or on a timer in floating, custom, or
  Theater geometry with visible move/resize handles. YouTube and Spotify
  embeds, direct local media, desktop VLC queues, Cinema layouts, adaptive glow,
  Spectrum, and 395 bundled MilkDrop/Butterchurn presets are also available.
- **YouTube queues:** Japanese, EDM, and K-pop one-click examples are bundled.
  EDM initializes a fresh, otherwise unchosen session without starting
  playback. Local `.txt` import can replace the same-named browser list or add a
  new list; unavailable/non-embeddable entries are skipped within a bounded
  pass.
- **Mobile presentation:** A touch-sized **Mobile optimized / Desktop** control
  beside the composer can force existing compact layout branches on a wide
  renderer. Mobile enables Matrix without replacing its saved appearance;
  returning to Desktop removes only the layout override.
- **World clock and weather:** A transparent, movable, resizable, collapsible
  one-to-six-city clock provides rainbow shimmer, amber nixie, analog, and
  old-school LED styles. Weather is a separate default-off renderer-local
  Open-Meteo consent, excluded from settings profiles and other clients.
- **Project Resources:** A transparent movable/resizable overlay graphs measured
  host CPU, RAM, network, project disk, stable per-adapter GPU/VRAM, and
  hardware temperatures. Diagnostics distinguish missing sensor providers from
  providers with no usable temperature sensors. **Hide unavailable graphs**
  removes the entire unavailable sensor card instead of leaving a blank chart.
- **Observatories:** Workflow keeps its accessible list and adds an optional
  provider-parent graph. Workspace Observatory offers read-only bounded project
  tree, text, SQLite, verified file focus, capped changes, and up to eight
  panes; it does not silently edit or add viewed content to model context.
- **Supervised browser:** A temporary sandboxed desktop browser supports native
  per-action approval and explicit origin/thread/provider-bound Codex or Claude
  grants. Sensitive fields stay out of prompts and routine logs.
- **Profiles and privacy:** Up to 32 local named presentation profiles use an
  allowlisted field policy, confirmed sequential writes, rollback on partial
  failure, and overlap locking. Credentials, provider authority, Auto Nudge,
  live assets, and weather consent are excluded. Meeting Privacy hides selected
  work from presentation surfaces without claiming to stop or secure it.
- **Usage and completion:** Provider-reported usage and paid state, advisory
  Model Pacing, separate cache/compaction counters, Ultra Caching handoffs, and
  privacy-safe completion sounds or fixed English/Japanese speech are exposed
  without inventing billing estimates.
- **Connections and desktop workflow:** The LAN Web UI and saved direct
  connections scope projects, threads, providers, and subscriptions to the
  selected reachable server. Thread movement, recycle/restore/permanent delete,
  external editor/path opening, and separate source/package update checks are
  included. Club Code does not create firewall rules, certificates, VPNs, or
  tunnels.
- **Secure coworking foundation — partial:** Central project authorization and
  a durable, project-scoped, idempotent, hash-chained admitted-event journal are
  implemented. The remote relay, shared operator room/chat, transcript merge,
  cross-network file synchronization, and multi-agent coordination requested
  for the complete coworking suite are not yet production capabilities.
- **RGB synchronization foundation — partial:** A default-off, provider-neutral,
  bounded and rate-limited RGB-frame boundary exists, but there is no production
  OpenRGB adapter, direct HID/SMBus access, device-control UI, or claim that
  keyboards, RAM, or case lighting currently synchronize.

Details and boundaries matter—especially for Auto Nudge costs, LM Studio network
security, camera secure-context requirements, YouTube embedding policy,
weather network consent, per-adapter GPU reporting, temperature sensor
availability, and what persists.
Read the [English guide](./docs/club-code-current-build-guide.md) or the
[日本語ガイド](./docs/club-code-current-build-guide.ja.md) before relying on
those features.

Clock and weather details:

- [English clock/weather guide](./docs/world-clock-weather.md)
- [世界時計＆お天気ガイド 🌃🕰️✨](./docs/world-clock-weather.ja.md)

### Optional Service Setup

For server-side public YouTube search, set these before starting the server. The
API key stays server-side:

```bash
CAFE_CODE_YOUTUBE_PUBLIC_DISCOVERY_ENABLED=true
CAFE_CODE_YOUTUBE_API_KEY=your_server_only_key
```

For desktop-only discovery of playlists owned by the signed-in user:

```bash
CAFE_CODE_YOUTUBE_ACCOUNT_CONNECTION_ENABLED=true
CAFE_CODE_YOUTUBE_OAUTH_DESKTOP_CLIENT_ID=your-desktop-client.apps.googleusercontent.com
```

Configure the YouTube Data API and consent screen with a **Desktop** OAuth client
ID. The callback is Google's desktop-app loopback form,
`http://127.0.0.1:<Club Code backend port>`, with no extra path. The grant is
held in the owner session; Club Code does not persist the refresh token, and the
remote Web UI does not expose this account connection.

For LM Studio, start its OpenAI-compatible API server and load a chat model, then
use **Settings > Providers > LM Studio Local**. The default endpoint is
`http://127.0.0.1:1234/v1`; a literal private IP or HTTPS endpoint is accepted
for a trusted LAN. The current Codex LM Studio route has no bearer-token hook, so
Club Code cannot connect while LM Studio's **Require Authentication** option is
enabled. Never expose an unauthenticated LM Studio endpoint to the public
internet. See the current-build guide for the full endpoint and security rules.

VLC playback requires VLC to be installed. Native completion speech requires
compatible operating-system voices.

## Why Club Code?

Club Code turns a strong coding-agent core into an operator-owned environment
for sustained work: expressive enough to feel personal, observable enough to
understand, and connected enough to support collaboration across devices and,
as secure coworking matures, across people. It should feel like a late-night
control room where the operator can see what agents are doing, shape how the
workspace looks and sounds, and keep authority over local files, credentials,
provider spending, and context.

This fork is not governed by tiny-window minimalism. Atmosphere and media,
workflow and workspace observatories, profiles, telemetry, provider choice,
supervised automation, mobile/LAN access, and secure coworking are part of the
product direction. Feature breadth is welcome when each capability is optional,
composable, reversible, truthfully labeled, and bounded in CPU, memory, network,
storage, and token cost.

New work should pass two tests: operator value and operator safety.

- **Operator intent outranks automation.** Manual work, visible queues, approvals,
  Stop controls, and explicit authority come first.
- **Evidence outranks theater.** Report what providers, sensors, files, and
  runtimes actually prove; show unavailable, partial, and planned states honestly.
- **Power does not require surrender.** Credentials and private context stay
  least-privilege; shared work stays sandboxed, attributable, recoverable, and
  unable to erase another operator's local ownership.
- **Personalization stays optional.** A rich workspace may be vivid, quiet,
  transparent, musical, information-dense, or stripped back without forcing the
  same presentation on every operator or device.
- **Long-running work remains disciplined.** Performance, accessibility,
  privacy, reliability, bounded resource use, and token-efficient context are
  release requirements, not reasons to forbid ambitious features.

The Club Code test is therefore not “does this make the window smaller?” It is:
does this make operators more capable, aware, expressive, or able to collaborate
without hiding cost, state, risk, or authority? If yes—and it can be delivered
with honest boundaries—it belongs in the conversation.

## Compatibility and Product Shape

Club Code retains the upstream `@cafecode/*`, `cafe-code`, `CAFE_CODE_*`,
`.cafe-code`, protocol, and data identifiers where changing them would break
compatibility. Those internal identifiers do not define the product vision.
Club Code remains agent-first while extending beyond a chat window into
operator-controlled observability, media, automation, profiles, telemetry, and
secure collaboration. Documentation must distinguish implemented, partial, and
planned capabilities instead of presenting intention as shipped behavior.

## Run From Source

For this fork, the dependable install path documented here is a source checkout.
There is currently no Club Code npm, AUR, pacman, or Debian package documented
here. The upstream `@cafeai/cafe-code` npm package and compatibility-named
`cafe-code` package recipes install or package Cafe Code, not Club Code. Build
support is not the same as a signed, notarized, publisher-authenticated artifact.
Verify the provenance and product identity of any packaged build before
installing it.

Install Node.js 24.13.1 and Corepack, then run Club Code from a checkout. The
repository pins the exact Yarn release through Corepack:

The current verified combined-build branch is `release/local-20260728` (observed
at `457be1418541bfb0ab08ae5bf9aac8a729ead23f`). `main` contains published
documentation and merged repository work, but it is not yet the full local-build
parity target. Agents should report the actual branch head they install in case
the release branch has advanced.

```bash
git clone --branch release/local-20260728 --single-branch https://github.com/John-Ryan21337/club-code.git
cd club-code
corepack enable
corepack yarn install --immutable
corepack yarn build:desktop
corepack yarn start:desktop
```

### Let Codex or Claude Code set it up

The easiest source installation is to open either **Codex CLI** or **Claude
Code** in the directory that should contain the checkout and give it the setup
instruction below. The agent must inspect the machine first, explain every
administrator-level change, preserve existing Club/Cafe settings and provider
credentials, and verify the resulting app instead of merely reporting that a
command exited successfully.

Start an interactive agent with `codex` or `claude`, then paste:

```text
Install Club Code from https://github.com/John-Ryan21337/club-code.git on this machine. First detect the exact OS/version, CPU architecture, shell, available disk space, and whether a graphical desktop session is available. Supported setup targets for this guide are macOS on Apple Silicon or Intel, Windows 10/11 on x64 or ARM64, Arch Linux on x64 or ARM64, and Raspberry Pi 5 running a 64-bit ARM64 desktop OS. Use a fresh source checkout of release/local-20260728, currently verified at 457be1418541bfb0ab08ae5bf9aac8a729ead23f; report the actual head if the branch has advanced. Do not install @cafeai/cafe-code, the cafe-code npm package, or compatibility-named Cafe Code AUR/pacman recipes. Ask before using sudo, administrator elevation, changing PATH, installing system packages, opening firewall ports, or replacing an existing checkout. Preserve existing .cafe-code data, settings, projects, and provider credentials. Install or select the repository-validated Node.js 24.13.1 runtime and Corepack, verify the host is using Node 24 rather than an unsupported newer major, enable the repository-pinned Yarn 4.17.1, clone the selected release branch, run corepack yarn install --immutable, run corepack yarn build:desktop, and start it with corepack yarn start:desktop. On Raspberry Pi 5, require a 64-bit OS and native ARM64 Node, treat the installation as experimental source-only, and do not claim that the x64 Linux release AppImage supports the Pi. Install native build or Electron runtime dependencies only when the detected platform actually needs them. Do not enable LAN access or change firewall rules unless I explicitly request remote access. If I want Codex or Claude as a Club Code provider, verify the already-authorized CLI with codex login or claude auth login without printing credentials. Finally verify by effect: confirm the Club Code desktop window launches from this checkout, report the exact git commit, Node/Yarn versions, platform/architecture, commands used, provider health, and any unsupported or deferred capability. Do not call the installation complete if the window did not launch.
```

Platform expectations for the agent:

| Platform       | Required handling                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS          | Support current Intel and Apple Silicon machines. Install Xcode Command Line Tools only if native dependency compilation requires them. Use an ARM64 Node runtime on Apple Silicon and x64 Node on Intel. A locally built DMG is optional; source launch remains the documented path, and signing/notarization must not be implied.                                  |
| Windows 10/11  | Use PowerShell and native Windows Git/Node. Match Node architecture to Windows, install Visual Studio C++ Build Tools only if a native module actually needs compilation, and do not require Developer Mode or global provider installation. A source launch should use the system Codex/Claude CLI unless a separately built packaged managed runtime is available. |
| Arch Linux     | Use a native Node 24 runtime even if the rolling repository has moved to a newer unsupported major. Install only the missing native build/runtime packages through `pacman` after approval. There is no published Club Code AUR package; compatibility-named package helpers still identify Cafe Code.                                                               |
| Raspberry Pi 5 | Require a 64-bit ARM64 OS with a graphical desktop, native ARM64 Node 24, adequate free storage, and the platform's Chromium/Electron runtime libraries. This is an experimental source build: published Linux releases are x64-only, and the agent must report native-module, Electron, GPU, or memory limitations instead of masking them.                         |

Agent verification checklist:

- `node --version` reports the validated `v24.13.1` target (or the agent clearly
  reports why another compatible Node 24 patch was necessary), and
  `corepack yarn --version` reports `4.17.1`.
- The clone's `origin` is `John-Ryan21337/club-code`, and the agent reports its
  exact checked-out commit.
- Immutable dependency installation and `build:desktop` complete, then a real
  Club Code window launches from that checkout.
- Existing `.cafe-code` state is not erased or silently migrated, credentials
  are not printed, and provider login is performed only when requested.
- LAN exposure, firewall changes, packaging, signing, and auto-start remain
  opt-in follow-up work.

Debug mode:

```bash
corepack yarn start:desktop:debug
```

### Browser Web UI Firewall Ports

To open the Club Code Web UI from another device on your LAN, first enable
network/LAN access in Club Code, then allow the desktop backend ports through
your firewall. The default desktop ports are:

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
Code or Club Code servers using a pairing URL or a host plus pairing code. Club
Code scopes projects, threads, providers, and live subscriptions to the selected
server.

Club Code does not create SSH or Tailscale tunnels. Configure the network,
certificate, firewall, or reverse proxy separately, then use the server's
pairing details. Desktop credentials are encrypted with Electron safe storage;
browser credentials are retained only for the current browser session.

Club Code supports these provider integrations:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run
  `codex login`.
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run
  `claude auth login`.
- OpenCode: install [OpenCode](https://opencode.ai/docs/) and configure an
  upstream provider, or configure an existing OpenCode server URL.
- LM Studio Local: install and start LM Studio's OpenAI-compatible server, then
  configure the separate **LM Studio Local** row in Settings. Cloud login is not
  required for this instance; the network-safety restrictions above still
  apply.

## Local Development

Run the app from a checkout:

```bash
corepack yarn install --immutable
corepack yarn start:desktop
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

### Club Code Package Status

No Club Code npm, AUR, pacman, or Debian package is currently published or
documented as an installation path. Compatibility-named Cafe Code packaging
helpers remain in the source tree for upstream compatibility and development,
but they are not Club Code install or publishing instructions. Use the source
checkout workflow above until Club Code-specific artifacts and package metadata
are published and verified.

## 日本語でも、もう一杯。え、まだ飲むのぉ？🍾

current source の全機能と Cafe Code との差分は
[日本語ガイド](./docs/club-code-current-build-guide.ja.md) が正本です。この README でも、
英語欄と同じ feature-level の内容をぜんぶ並べます。はい伝票長い、でも「だいたい同じ」は
請求と security では通らないから、もう一杯いきながら正確にね👇

- **Branding と compatibility：** 見える product 名は Club Code。ただし互換性に必要な
  `cafe-code`、`@cafecode/*`、`CAFE_CODE_*`、protocol、data-directory 名は維持します。
  agent-first のまま、operator-controlled visibility、presentation、automation、
  collaboration へ広げます。看板も floor も育てるけど、常連さんのボトル名は勝手に
  替えないの、えらい〜🍾
- **Provider runtime：** Codex、Claude、OpenCode を利用可能。Windows の Codex/Claude は、
  operator の system CLI/path または Club Code 管理の Node/provider install を選べます。
  managed は executable の場所を分離し、first install・update・login の発見を揃え、変わりやすい
  global `PATH` への依存を減らします。credential や無料利用枠は同梱せず、provider update の
  supply-chain trust も必要。system CLI が portable で operator 管理の初期値です。無料ボトルは
  入ってません、そこだけ急に現実〜🥃
- **LM Studio Local：** loopback または信頼できる private LAN 用に、通常の Codex OSS /
  LM Studio instance を別 provider として作成。OpenCode でも、Atmosphere Console の狭い
  model fallback でもありません。三人を同じ源氏名で呼ばないでね🤖
- **Prompt workflow：** exact-thread draft recovery、可視で durable な FIFO follow-up、
  provider-aware **Steer**、画像、bounded で内容が見える `.txt` import、camera preview、
  retake、対応 mobile の front/rear 切替、system-camera fallback。server が受理した operator
  queue が Auto Nudge より先です📸
- **Auto Nudge：** 初期状態 off、exact thread、completion event だけで動く standing order。
  編集できる text、**Steady Progress** と **Hardcore Fanout** の開始 prompt、thread ごとの cap、
  minimize、foreground または opt-in background、completed-turn の durable dedupe、通常 history
  に残る message、thread Stop、既知 thread 向け emergency barrier を持ちます。timer、
  countdown、elapsed-time cap、periodic cadence は nudge authority になりません。時計に
  シャンパン飲ませる実装は撤去済み、でも実 request の請求は本物です⚠️
- **Idle Thread Guard：** Auto Nudge と別の、初期状態 off の exact-thread silence safeguard。
  すでに running の turn だけを対象に、1〜720 whole hours、初期値2時間。projected activity で
  deadline を resetし、一つの idle episode につき可視 status request は最大一回。新しい
  activity まで fail closed で、Auto Nudge authority は作りません。無音の長考中に呼び鈴を
  押すかもしれないので、長め設定が美人です🔔
- **Atmosphere effect：** pointer-transparent な snow、rain、Matrix。Roman/Japanese/2ch/
  live-work vocabulary、fixed/rainbow/per-stream rainbow/music-reactive color、独立 shimmer
  speed、density `10` まで、Flat、Forward、Reverse、Warp、Walk Forward、Walk Reverse。
  夜景は盛れるだけ盛る、ただし pointer は奪わない✨
- **Matrix depth と performance：** Walk は full-viewport random spawn、bounded travel/fade、
  1〜144 px endpoint、collision-aware spacing、横につぶれない readable filename、
  center-outward wind、depth-scaled glyph route、高密度 640-stream pool。対応時は同期した
  WebGL2 instanced glyph atlas が true GPU glyph rasterization を担当し、未対応・context loss・
  frame failure は Canvas2D fallback。snow、rain、verified connector は Canvas2D 所有です。
  GPU に働いてもらって、あたしは座る。役割分担〜💅
- **Verified activity：** provider が観測した network、database、build、agent delegation
  event だけを、bounded な Matrix 色 route、packet、pulse、trail、安全な filename で表示。
  prompt、command、SQL、secret、架空 traffic は除外。噂話を telemetry にしない店です🧾
- **Atmosphere Console：** transparent、move、resize 可能。最初は zero-token deterministic
  parser、必要時だけ狭い LM Studio/Codex/Claude structured fallback を使い、lightweight model
  を優先。小さい safe command vocabulary だけ presentation setting を変更できます。
  酔った自由詩を root command に変換する機能はないから安心して😂
- **Ambient image と media：** persistent image/GIF または bounded image directory を、
  manual/timer cycle、floating/custom/Theater geometry、見える move/resize handle で表示。
  YouTube/Spotify embed、direct local media、desktop VLC queue、Cinema、adaptive glow、
  Spectrum、395 bundled MilkDrop/Butterchurn preset も利用可能。店内演出だけ急にフェス級🎬
- **YouTube queue：** Japanese、EDM、K-pop の one-click example を同梱。local `.txt` import は
  fresh で未選択の session を EDM で初期化しますが、playback は自動開始しません。local
  `.txt` import は同名 browser list を replace、別名なら追加。unavailable/non-embeddable
  item は bounded pass 内で skip。一曲入店できなくても全員帰らせません🎧
- **Mobile presentation：** composer 横の touch-sized **Mobile optimized / Desktop** が、
  wide renderer でも既存 compact layout を選べます。Mobile は保存済み Matrix appearance を
  上書きせず Matrix を enable。Desktop に戻す時は layout override だけ外します。衣装だけ
  戻して照明は消さない、アフター仕様📱👗
- **世界時計と weather：** transparent、move/resize/collapse 可能な1〜6都市 clock。
  rainbow shimmer、amber nixie、analog、old-school LED。weather は別の default-off、
  renderer-local Open-Meteo consent で、settings profile と他 client から除外。別席の
  profile load で勝手に傘を配りません🕰️🌦️
- **Project Resources：** transparent move/resize overlay が measured host CPU、RAM、
  network、project disk、stable per-adapter GPU/VRAM、hardware temperature を graph 表示。
  diagnostics は sensor provider 不在と、provider はあるが usable temperature sensor がない
  状態を区別。**Hide unavailable graphs** は blank chart だけでなく unavailable sensor card
  全体を消します。体温は推測しない、空席は片づける、はい完璧📈
- **Observatory：** Workflow は accessible list を保ち、optional provider-parent graph を追加。
  Workspace は read-only の bounded project tree、text、SQLite、verified file focus、
  capped change、最大八 pane。見た内容を勝手に edit したり model context に入れません。
  見る専のお客様、指名料なし👀
- **Supervised browser：** temporary sandboxed desktop browser、native per-action approval、
  exact origin/thread/provider に縛る Codex/Claude grant。sensitive field は prompt と routine
  log から除外。入口の身分確認は酔ってても厳しいです🔐
- **Profile と privacy：** 最大32 local named presentation profile。allowlisted field policy、
  confirmed sequential write、partial failure rollback、overlap lock。credential、provider
  authority、Auto Nudge、live asset、weather consent は除外。Meeting Privacy は選択 work を
  presentation surface から隠すだけで、stop や access control とは主張しません。ドレスと
  金庫の鍵を同じバッグに入れない、大人〜👜
- **Usage と completion：** provider-reported usage/paid state、advisory Model Pacing、
  別々の cache/compaction counter、Ultra Caching handoff、privacy-safe completion sound、
  固定の英日 speech。架空 billing estimate は作りません。伝票マジック禁止💸
- **Connection と desktop workflow：** LAN Web UI と saved direct connection は、選択した
  reachable server ごとに project/thread/provider/subscription を scope。thread move、
  recycle/restore/permanent delete、external editor/path open、source/package update check。
  firewall rule、certificate、VPN、tunnel は Club Code が自動作成しません。戸締まりは
  operator 担当です📱🔐
- **Secure coworking foundation — partial：** central project authorization と、durable、
  project-scoped、idempotent、hash-chained admitted-event journal は実装済み。完全版に必要な
  remote relay、shared operator room/chat、transcript merge、cross-network file sync、
  multi-agent coordination はまだ production capability ではありません。相席予約帳はある、
  128人宴会はまだ受付前です🤝
- **RGB synchronization foundation — partial：** default-off、provider-neutral、bounded、
  rate-limited RGB-frame boundary は存在。ただし production OpenRGB adapter、direct
  HID/SMBus、device-control UI、keyboard/RAM/case lighting の同期保証はありません。
  看板だけ虹色で「全館連動です」は言わない、正直営業🌈

Auto Nudge と Idle Thread Guard の費用、LM Studio の LAN security、mobile camera の HTTPS、
YouTube embed の制限、GPU ごとの個別表示、weather consent、temperature sensor の条件、
保存範囲は [日本語ガイド](./docs/club-code-current-build-guide.ja.md) にさらに詳しく書いて
あります。「たぶん平気」は乾杯の回数だけにして、仕様と請求はちゃんと確認しよ🥂

### Club Code を作る理由と product shape

Club Code は、強い coding-agent core を、長い仕事を一緒に走れる operator-owned environment
へ育てるための fork です。自分の場所だと思えるくらい expressive、何が起きているか追える
くらい observable、device をまたいで、secure coworking が育ったら人とも一緒に働けるくらい
connected。夜更けの control room みたいに、agent の動きが見えて、workspace の見た目と音を
自分で作れて、local file、credential、provider 料金、context の authority は operator が
握ったまま。はい、鍵と伝票は店側に勝手に渡しませ〜ん🔑🥃

この fork は tiny-window minimalism を doctrine にしません。atmosphere と media、
Workflow/Workspace Observatory、profile、telemetry、provider choice、supervised automation、
mobile/LAN access、secure coworking は余計な飾りではなく product direction です。feature が
多くても、それぞれ optional、composable、reversible、truthfully labeled で、CPU、memory、
network、storage、token cost が bounded なら歓迎。ボトルは多くても会計と出口は見える店ね🍾

新しい work は operator value と operator safety の二つで判断します。

- **Operator intent は automation より上。** manual work、見える queue、approval、Stop control、
  explicit authority が先です。
- **Evidence は演出より上。** provider、sensor、file、runtime が本当に証明したことだけを表示し、
  unavailable、partial、planned を正直に分けます。盛るのはラメだけ✨
- **Power の代わりに ownership を渡さない。** credential と private context は
  least-privilege。shared work は sandboxed、attributable、recoverable で、別 operator の
  local ownership を消せません。
- **Personalization は optional。** vivid、quiet、transparent、musical、information-dense、
  stripped-back のどれでもよく、全 operator・全 device に同じ presentation を強制しません。
- **長時間 work ほど discipline。** performance、accessibility、privacy、reliability、
  bounded resource use、token-efficient context は release requirement。ambitious feature を
  最初から追い返す理由ではありません。

だから Club Code test は「window が小さくなる？」ではなく、「cost、state、risk、authority を
隠さず、operator をもっと capable、aware、expressive、collaborative にする？」です。yes で、
honest boundary を守って届けられるなら、一緒に席へどうぞ〜🥂

互換性を壊す場所では `@cafecode/*`、`cafe-code`、`CAFE_CODE_*`、`.cafe-code`、protocol、
data identifier を維持します。ただし internal identifier は product vision ではありません。
Club Code は agent-first のまま、operator-controlled observability、media、automation、
profile、telemetry、secure collaboration まで chat window の外へ広がります。documentation は
implemented、partial、planned を分け、予定を実装済みとして見せません。

### 任意サービスの設定

YouTube のアプリ内公開検索を使う server は、起動前にこれ。API key は browser に渡しません。

```bash
CAFE_CODE_YOUTUBE_PUBLIC_DISCOVERY_ENABLED=true
CAFE_CODE_YOUTUBE_API_KEY=your_server_only_key
```

自分の YouTube playlist を見る desktop-only の接続は、これも local backend の起動前に設定。

```bash
CAFE_CODE_YOUTUBE_ACCOUNT_CONNECTION_ENABLED=true
CAFE_CODE_YOUTUBE_OAUTH_DESKTOP_CLIENT_ID=your-desktop-client.apps.googleusercontent.com
```

YouTube Data API と consent screen を設定して、Desktop OAuth client ID を使ってね。callback は
`http://127.0.0.1:<Club Code backend port>`、余計な path はなし。grant は owner session の
memory だけで、refresh token は保存しません。remote Web UI にもこの接続は出しません。

LM Studio は OpenAI-compatible API server を起動して chat model を load し、
**Settings > Providers > LM Studio Local** を使います。default は
`http://127.0.0.1:1234/v1`。信頼できる LAN なら literal private IP または HTTPS endpoint。
今の Codex route は bearer token を渡せないので、LM Studio の **Require Authentication** が
on だと接続できません。unauthenticated endpoint を public internet に出すのは禁止。
伝票より先に firewall を確認、これ大人の順番です🔒

VLC lane には VLC、native completion speech には対応 OS voice の install が必要です。

### ソースから動かす

この fork で案内する install path は source checkout です。現在、Club Code の npm、AUR、
pacman、Debian package は install path として案内していません。upstream の
`@cafeai/cafe-code` npm package と compatibility 名の `cafe-code` package recipe が
install/package するのは Cafe Code であり、Club Code ではありません。build できることと、
署名・notarize 済みの publisher-authenticated artifact は同じ意味ではありません。packaged
build は provenance と product identity を確認してから使ってください。

Node.js 24.13.1 と Corepack を先に入れます。Yarn は repository 側で固定済み。

現在の verified combined-build branch は `release/local-20260728`（確認済み head は
`457be1418541bfb0ab08ae5bf9aac8a729ead23f`）。`main` は公開 document と merge 済み repository
work を持つけど、まだ full local-build parity target じゃないの。release branch が進んだ場合に
備えて、agent は実際に install した branch head を報告してね。酔ってても commit は指差し確認よぉ。

```bash
git clone --branch release/local-20260728 --single-branch https://github.com/John-Ryan21337/club-code.git
cd club-code
corepack enable
corepack yarn install --immutable
corepack yarn build:desktop
corepack yarn start:desktop
```

### Codex / Claude Code に丸投げして入れるの、ほら乾杯っ🍾

ねえ常連さん、terminal と朝までにらめっこしなくていいのよぉ。install 先の親 directory で
**Codex CLI** か **Claude Code** を `codex` または `claude` で起動して、下の伝票をそのまま
渡してね。ただし `sudo`、administrator、`PATH`、firewall は勝手に触らせないの。酔ってても
鍵と credential は守る、歌舞伎町の hostess にもそこは譲れないんだからぁ🔐

```text
この machine に https://github.com/John-Ryan21337/club-code.git から Club Code を install してください。最初に OS と version、CPU architecture、shell、空き disk、graphical desktop session の有無を正確に検出してください。この guide の対象は Apple Silicon/Intel macOS、x64/ARM64 Windows 10/11、x64/ARM64 Arch Linux、64-bit ARM64 desktop OS の Raspberry Pi 5 です。現在 457be1418541bfb0ab08ae5bf9aac8a729ead23f で検証済みの release/local-20260728 を fresh source checkout として使い、branch が進んでいたら実際の head を報告してください。@cafeai/cafe-code、cafe-code npm package、Cafe Code 名の compatibility AUR/pacman recipe は install しないでください。sudo、administrator elevation、PATH 変更、system package install、firewall port 開放、既存 checkout の置換を行う前に必ず確認を取ってください。既存の .cafe-code data、settings、projects、provider credentials を保存してください。repository で検証済みの Node.js 24.13.1 と Corepack を install または選択し、unsupported な新しい major ではなく Node 24 が実際に使われていることを確認し、repository が固定した Yarn 4.17.1 を有効化してください。選択した release branch を clone し、corepack yarn install --immutable、corepack yarn build:desktop、corepack yarn start:desktop の順で実行してください。Raspberry Pi 5 は 64-bit OS と native ARM64 Node を必須にし、experimental な source-only setup として扱い、x64 Linux release AppImage が Pi 対応だとは絶対に書かないでください。native build dependency と Electron runtime library は検出した platform で本当に必要なものだけ入れてください。私が remote access を明示的に頼まない限り LAN access と firewall rule は変更しないでください。Club Code provider として Codex または Claude を使う場合、credential を表示せず codex login または claude auth login で authorized CLI を確認してください。最後は exit code ではなく effect を確認し、この checkout から Club Code desktop window が実際に起動したこと、exact git commit、Node/Yarn version、platform/architecture、実行 command、provider health、unsupported/deferred capability を報告してください。window が起動していない場合は install 完了と報告しないでください。
```

お店じゃ席ごとに bottle が違うみたいに、machine ごとの扱いも違うの。ここ、酔っぱらいの
冗談じゃなくて実務表だから agent は守ってねぇ：

| Platform       | agent が守ること                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS          | Intel と Apple Silicon を対象にし、native dependency の compile が必要な場合だけ Xcode Command Line Tools を入れます。Apple Silicon は ARM64 Node、Intel は x64 Node。local DMG build は optional で、source launch が正本。署名/notarization 済みとは言わないこと。                                                                                  |
| Windows 10/11  | PowerShell と native Windows Git/Node を使い、Node architecture を Windows に合わせます。Visual Studio C++ Build Tools は native module が実際に compile を要求した場合だけ。Developer Mode と global provider install は必須にしません。source launch は、別途 packaged managed runtime を build 済みでない限り system Codex/Claude CLI を使います。 |
| Arch Linux     | rolling repository が unsupported な新 major に進んでいても native Node 24 を選びます。不足する build/runtime package だけ、承認後に `pacman` で入れます。公開済み Club Code AUR package はなく、compatibility package helper の identity は Cafe Code のままです。                                                                                   |
| Raspberry Pi 5 | graphical desktop のある 64-bit ARM64 OS、native ARM64 Node 24、十分な空き storage、platform 用 Chromium/Electron runtime library が必須。experimental source build で、公開 Linux release は x64-only。native module、Electron、GPU、memory の limitation は隠さず報告します。                                                                       |

最後の会計、じゃなくて verification はこれ。全部そろうまで「できたぁ」は禁止よ：

- `node --version` は検証 target の `v24.13.1`。別の compatible Node 24 patch が必要なら理由を
  明記し、`corepack yarn --version` は `4.17.1`。
- clone の `origin` は `John-Ryan21337/club-code`。checked-out exact commit を報告。
- immutable dependency install と `build:desktop` のあと、その checkout から本物の Club Code
  window が起動。
- 既存 `.cafe-code` state を消去・無断 migration せず、credential を表示せず、provider login
  は依頼された場合だけ。
- LAN exposure、firewall、packaging、signing、auto-start は全部 opt-in の follow-up。

ほら、これなら agent に任せてる間に一杯飲めるでしょぉ？ でも Raspberry Pi に x64 AppImage
を着せて「似合う似合う」はだめ。サイズ違いの dress は、あたしでも見抜くんだからねぇ💋

debug mode:

```bash
corepack yarn start:desktop:debug
```

LAN の別 device から Web UI を開くなら、Club Code で LAN access を enable にして、
firewall で表示された port を許可します。packaged default:

- HTTPS/WSS Web UI: `3775/tcp`
- HTTP/WS fallback と certificate bootstrap: `3773/tcp`

`ufw`:

```bash
sudo ufw allow 3775/tcp comment 'Club Code HTTPS'
sudo ufw allow 3773/tcp comment 'Club Code HTTP'
```

`corepack yarn dev:desktop` の default:

```bash
sudo ufw allow 13775/tcp comment 'Club Code dev HTTPS'
sudo ufw allow 13773/tcp comment 'Club Code dev backend'
sudo ufw allow 5733/tcp comment 'Club Code dev Vite'
```

`CAFE_CODE_PORT`、`CAFE_CODE_HTTPS_PORT`、`CAFE_CODE_DEV_INSTANCE`、
`CAFE_CODE_PORT_OFFSET` を使う場合は、Club Code が表示した port を許可してね。

### 保存した remote server

Connections settings は、pairing URL または host と pairing code を使い、到達可能な Cafe
Code/Club Code server への direct connection を保存できます。project、thread、provider、
live subscription は選択した server ごとに分離されます。

Club Code は SSH/Tailscale tunnel を作成しません。network、certificate、firewall、
reverse proxy を別途設定してから pairing details を使用してください。desktop credential は
Electron safe storage で暗号化し、browser credential は現在の browser session だけ保持。
「接続ボタン押したら世界中どこでも安全」は魔法すぎるので、そこは各自で戸締まりね🔐

Codex は `codex login`、Claude は `claude auth login` が必要。OpenCode は upstream provider
または existing server URL を設定。LM Studio Local は外部 server を先に起動し、Settings の
専用 row で設定します。

### Local development

checkout から app を動かす基本 command:

```bash
corepack yarn install --immutable
corepack yarn start:desktop
```

debug mode:

```bash
corepack yarn start:desktop:debug
```

app は startup 時に localhost-only debug URL を表示します。development check:

```bash
corepack yarn fmt
corepack yarn lint
corepack yarn typecheck
corepack yarn test
```

### Club Code package の状態

現在、Club Code の npm、AUR、pacman、Debian package は公開済み install path として案内して
いません。source tree には upstream compatibility と development 用の Cafe Code 名
packaging helper が残っていますが、Club Code の install/publish 手順ではありません。
Club Code 専用 artifact と package metadata が公開・検証されるまでは、上の source checkout
手順を使ってください。

## License

Club Code is AGPL-3.0-or-later.

The fork keeps the upstream attribution story intact; see the license and notice
files for details.

Club Code の license は AGPL-3.0-or-later です。この fork は upstream attribution を維持します。
詳細は license file と notice file を確認してください。
