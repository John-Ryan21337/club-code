# Club Code

### The original Cafe Code, after hours — with the Club Code sign lit

![Club Code desktop screenshot](./docs/images/cafe-code-desktop.png)

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

Current-build end-user documentation:

- [English guide](./docs/club-code-current-build-guide.md)
- [日本語ガイド 🍾✨](./docs/club-code-current-build-guide.ja.md)

_Heeey, darling. Come in, come in. Closer. I am not shouting; the room is just
very far away. Club Code is the late-night fork of Cafe Code: chat goes in, work
comes back, and nobody drags a fake IDE onto my dance floor. Snow in the window?
Yes. A little movie in the corner? Yes. One more glass? Also yes. That one is
probably unrelated._

This repository is **Club Code**, an after-hours fork of
[Cafe Code](https://github.com/cafeai/cafe-code), which began as a fork of
[T3 Code](https://github.com/pingdotgg/t3code). The app still uses Cafe Code
package, command, environment-variable, protocol, and data-directory names for
compatibility. New sign outside; dependable regulars behind the bar.

It stays chat-centered. There is no in-app terminal drawer and no editor
pretending to be VS Code. The observatories are read-only windows into work that
is already happening; they do not become another agent or silently edit files.

<p align="center">
  <img src="./docs/images/cafe-code-character.png" alt="Club Code character" width="360" />
</p>

## Current Club Code Build Overview

The two current-build guides above are the authoritative current-source
inventory of differences from Cafe Code. They do not by themselves prove that
an installer or pull request has been published. In short, the current source
implements:

- Codex, Claude, and OpenCode, plus a distinct **LM Studio Local** provider for
  loopback or trusted private-LAN OpenAI-compatible endpoints. OpenCode and LM
  Studio are separate providers.
- Exact-thread drafts and FIFO follow-up queues, provider-aware **Steer**, image
  and bounded `.txt` attachments, and camera capture with mobile front/rear
  selection where the browser permits it.
- Completion-driven, exact-thread **Auto Nudge** with editable per-thread text,
  per-thread caps, minimized controls, foreground or opt-in background
  continuation, priority for server-accepted operator FIFO work, thread stop,
  and a host/browser emergency barrier for known connected threads. Wall-clock
  idleness alone never authorizes a nudge.
- Optional full-window snow, rain, and Matrix effects; Flat, Forward, Reverse,
  Warp, Walk Forward, and Walk Reverse depth modes; whole-pixel Walk font
  endpoints; perspective-scaled activity lines; shimmer; music-reactive colors;
  and locally saved presentation profiles.
- A touch-sized **Mobile optimized / Desktop** presentation toggle beside the
  composer. The renderer-local Mobile choice can force the compact layout on a
  wide screen, enables Matrix without resetting its saved appearance, and
  leaves Matrix on when the user returns to Desktop presentation.
- An optional transparent multi-city world clock with rainbow shimmer, amber
  nixie, analog, and old-school LED styles. Weather is a separate
  renderer-local opt-in with bounded direct Open-Meteo requests and an explicit
  privacy/attribution notice.
- YouTube and Spotify embeds, three bundled one-click YouTube lists, local list
  import/replace, direct media, desktop VLC playback, image/GIF ambience, Cinema
  and Theater layouts, adaptive glow, and Spectrum/MilkDrop visualization.
- A transparent, movable, resizable Project Resources overlay that reserves no
  chat-timeline space; evidence-based Matrix activity routes; Workflow and
  read-only Workspace observatories; a supervised desktop browser;
  provider-reported usage; Model Pacing; and privacy-safe completion alerts.
- A LAN-capable Web UI and saved connections to reachable Club Code/Cafe Code
  servers. Club Code does not create firewall rules, certificates, VPNs, or
  tunnels for you.

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

## Compatibility and Product Shape

Club Code retains the upstream `@cafecode/*`, `cafe-code`, `CAFE_CODE_*`,
`.cafe-code`, protocol, and data identifiers where changing them would break
compatibility. It adds the current-build behavior documented above while
preserving the focused coding-agent chat model. The complete comparison belongs
in the current-source guides, not in a second drifting feature catalog here.

## Run From Source

For this fork, the dependable install path documented here is a source checkout.
Build support is not the same as a signed, notarized,
publisher-authenticated artifact. Verify the provenance of any packaged build
before installing it. The compatibility-named npm package may lag the repository
and is not the fresh-build path documented here.

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

If you want Codex or Claude to perform the source installation, paste this into
the CLI:

```text
Install Club Code from source. Clone https://github.com/John-Ryan21337/club-code.git, install Node.js 24.13.1 and Corepack, run corepack enable, run corepack yarn install --immutable, run corepack yarn build:desktop, then start it with corepack yarn workspace @cafecode/desktop start. Also verify Codex CLI is installed and logged in with codex login, and Claude Code is installed and logged in with claude auth login if I want Claude support.
```

The compatibility npm path remains available but may lag current repository
work:

```bash
npx @cafeai/cafe-code
npm install -g @cafeai/cafe-code
cafe-code
```

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

The compatibility-named `cafe-code` AUR directory is a legacy upstream recipe:
it pins `cafeai/cafe-code` version `0.0.51`, not this Club Code checkout. It is
packaging scaffolding, not a current Club Code artifact. To inspect or build
that pinned recipe on Arch Linux:

```bash
corepack yarn dist:aur:cafe-code
```

The package is written to `packaging/aur/cafe-code/`. Its `PKGBUILD`, generated
`.SRCINFO`, launcher, desktop entry, and packaging license are kept there.

If you intentionally maintain that legacy upstream AUR listing, stage its
metadata with:

```bash
git clone ssh://aur@aur.archlinux.org/cafe-code.git ../aur-cafe-code
cp -a packaging/aur/cafe-code/. ../aur-cafe-code/
cd ../aur-cafe-code
makepkg --printsrcinfo > .SRCINFO
git add .gitignore .SRCINFO LICENSE PKGBUILD cafe-code.desktop cafe-code.sh
git commit -m "Initial cafe-code package"
git push
```

Before treating it as a Club Code package, update and audit the upstream URL,
source commit or tag, checksums, version, description and branding, generated
`.SRCINFO`, installed AppImage, and launcher. Changing only `pkgver` is not
enough.

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

The package is written to `release/`. Install the emitted file with a graphical
package installer or with `sudo apt install ./release/<file>.deb`.

## 日本語でも、もう一杯。え、まだ飲むのぉ？🍾

current source の全機能と Cafe Code との差分は
[日本語ガイド](./docs/club-code-current-build-guide.ja.md) が正本です。ここで同じ長話を
もう一回やると、README が三軒目みたいに迷子になるので、今夜の伝票だけ置いとくね👇

- provider は Codex、Claude、OpenCode、それから別枠の **LM Studio Local**。OpenCode と
  LM Studio を同じ子扱いしない、名前を間違えると店でも Settings でも怒られます🤖
- prompt は thread ごとの draft、FIFO queue、対応時の Steer、画像、`.txt`、camera。
  server が受理した operator queue は Auto Nudge より先。別 device の未送信 draft は
  server から見えないので、受理されるまでは全 renderer 共通の優先権になりません🙌
- Auto Nudge は **exact thread の完了 event** でだけ動く。thread ごとに文面と cap を保存し、
  minimize や opt-in background でも completion と queue を再確認する。時計だけでは送らない。
  でも一通ごとに本物の provider 料金が動くので、上の警告は素面で読んでね⚠️💸
- snow/rain/Matrix、Forward/Reverse/Warp/Walk、whole-pixel の Walk size、perspective line、
  shimmer、music color、YouTube/Spotify/VLC、Cinema、visualizer、settings profile まで
  current source に入ってる。照明は盛る、未実装の夢は盛らない✨
- composer 横の **Mobile optimized / Desktop** は renderer-local。Mobile を明示的に選ぶと
  Matrix も on にするけど見た目の保存値は壊さず、Desktop に戻しても Matrix は残るよ📱👗
- 世界時計は 1〜6 都市、四つの style、move/resize/collapse。weather は default off の
  renderer-local consent で profile から除外。別画面から勝手に API 営業開始しません🕰️🌦️
- Project Resources は透明で move/resize/collapse。CPU/RAM/network/disk と、GPU 1 /
  GPU 2 それぞれの utilization・VRAM・history、host が本当に出した temperature を表示。
  sensor がなければ unavailable。
  体温を占いで作る店ではありません📈
- Workflow/Workspace は read-only、activity line は provider evidence の分だけ。LAN Web UI は
  phone から監視できるけど、certificate、firewall、VPN は自動で生えない。戸締まり大事🔐📱

Auto Nudge の費用、LM Studio の LAN security、mobile camera の HTTPS、YouTube embed の
制限、GPU ごとの個別表示、weather consent、temperature sensor の条件、保存範囲は
[日本語ガイド](./docs/club-code-current-build-guide.ja.md) に正確に書いてあります。
「たぶん平気」は乾杯の回数だけにして、仕様と請求はちゃんと確認しよ🥂

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

この fork で案内する install path は source checkout。build できることと、署名・notarize
済みの publisher-authenticated artifact は同じ意味ではありません。packaged build は
provenance を確認してから使ってね。compatibility 名の npm package は repository より遅れる
場合があり、fresh build の案内ではありません。

Node.js 24.13.1 と Corepack を先に入れます。Yarn は repository 側で固定済み。

```bash
git clone https://github.com/John-Ryan21337/club-code.git
cd club-code
corepack enable
corepack yarn install --immutable
corepack yarn build:desktop
corepack yarn workspace @cafecode/desktop start
```

debug mode:

```bash
corepack yarn workspace @cafecode/desktop start --cafe-debug
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

Codex または Claude に source install を頼むなら、これを渡せます。

```text
Club Code をソースから入れてください。https://github.com/John-Ryan21337/club-code.git を clone して、Node.js 24.13.1 と Corepack を入れ、corepack enable、corepack yarn install --immutable、corepack yarn build:desktop、corepack yarn workspace @cafecode/desktop start まで実行してください。Codex を使うなら codex login、Claude を使うなら claude auth login も確認してください。
```

compatibility npm path:

```bash
npx @cafeai/cafe-code
npm install -g @cafeai/cafe-code
cafe-code
```

Codex は `codex login`、Claude は `claude auth login` が必要。OpenCode は upstream provider
または existing server URL を設定。LM Studio Local は外部 server を先に起動し、Settings の
専用 row で設定します。

development check:

```bash
corepack yarn fmt
corepack yarn lint
corepack yarn typecheck
corepack yarn test
```

Arch/AUR/Debian package の command と現在の注意点は、この README の英語
**Local Development** section が正本です。command は言語で変わらないから、酔って翻訳して
別 option を生やさないのが安全〜🍸

## License

Club Code is AGPL-3.0-or-later.

The fork keeps the upstream attribution story intact; see the license and notice
files for details.
