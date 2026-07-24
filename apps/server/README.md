# Club Code

A minimal AI chat harness for coding agents.

Club Code is a tiny local UI for Codex and Claude. It is a fork of
[T3 Code](https://github.com/pingdotgg/t3code), trimmed down around one idea:
type a prompt, let the agent work, and keep the interface quiet, fast, and out
of your way.

No terminal drawer. No pretend IDE. No release dashboard. If you want a console,
use a real console. If you want to inspect code, open it in VS Code.

## Run From Source

The npm package exists, but it may lag behind current work until Club Code
stabilizes. The freshest path is a source checkout from GitHub.

Mostly tested on macOS. Windows seems to work. Linux may need some tweaking.

Install Node.js 24.13.1 and Corepack, then run:

```bash
git clone https://github.com/cafeai/cafe-code.git
cd cafe-code
corepack enable
yarn install --immutable
yarn build:desktop
yarn workspace @cafecode/desktop start
```

If you want Codex or Claude to install it for you, paste this:

```text
Install Club Code from source. Clone the Club Code fork, install Node.js 24.13.1 and Corepack, run corepack enable, run yarn install --immutable, run yarn build:desktop, then start it with yarn workspace @cafecode/desktop start. Also verify Codex CLI is installed and logged in with codex login, and Claude Code is installed and logged in with claude auth login if I want Claude support.
```

## npm Path

```bash
npx @cafeai/cafe-code
```

`npx` downloads the package if needed and starts Club Code immediately, but it
may be out of date for now.

If you want a normal command on your machine:

```bash
npm install -g @cafeai/cafe-code
cafe-code
```

Club Code expects providers to already be installed and authenticated:

- Codex: install Codex CLI and run `codex login`
- Claude: install Claude Code and run `claude auth login`

## Notes

The npm package launches the Electron desktop app. Desktop installers are not
published yet.

For server-only use, run:

```bash
cafe-code-server
```

## License

AGPL-3.0-or-later.
