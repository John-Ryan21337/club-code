# Check access before external CLI fan-out

Run the check with the same model and CLI environment that the work will use:

```sh
corepack yarn providers:check-access --claude-model claude-opus-5
```

Use `--claude-binary` and `--claude-home` with absolute paths when the work uses a
specific executable or `CLAUDE_CONFIG_DIR`. Otherwise the check inherits the
shell's environment and resolves the CLI on PATH. The app's managed runtime can
use a different account or executable; this command does not check app settings.

The command sends a small synthetic live request from an empty temporary
directory. It may use provider quota. Required CLI controls disable tools,
hooks, session persistence, and project settings while preserving user-level
authentication helpers. Unsupported CLI controls produce an unverified result.
The help probe has a 15-second deadline; the request has a 60-second deadline.
Captured output is capped at 128 KiB, and the temporary directory is removed.

The JSON report contains fixed statuses, check times, executable basename, and
whether a home override was selected. It does not print raw provider output,
credentials, full executable paths, or home paths. Exit status is zero only when
every selected model is verified by a successful terminal response with the
exact synthetic text. Timeouts, output truncation, conflicting failure signals,
and unsupported controls cannot verify access.

| Status                  | Meaning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| verified                | The request succeeded at the recorded time.                  |
| authentication-required | The failed request requires authentication.                  |
| account-restricted      | The failed request reported an account or model restriction. |
| rate-limited            | The failed request reported a usage limit.                   |
| unverified              | The command did not prove access. Inspect the fixed reason.  |

`--codex-model`, `--codex-binary`, and `--codex-home` can identify a required Codex
lane. It remains **unverified** and makes the command exit nonzero. A reliable
empty-tool check that preserves Codex's authentication configuration has not been
established. This result does not imply an expired Codex login.

Run the check before expensive work. It does not intercept unrelated CLI commands
or guarantee that access and quota will last for a complete run. Other providers
and GitHub, Notion, or Linear connections are outside its scope.
