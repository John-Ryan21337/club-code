/**
 * Root Codex CLI arguments for an LM Studio (Codex OSS) provider instance.
 *
 * Every Codex launch for an OSS instance (`app-server` sessions, the
 * `app-server` model/status client, and `exec` text generation) must place
 * these arguments before the subcommand.
 *
 * Why both forms are required (verified against Codex CLI 0.167.0):
 *
 * - `--oss --local-provider lmstudio` are flags of the interactive TUI CLI.
 *   `codex-rs/cli/src/main.rs` hands the `app-server` subcommand only the
 *   root `-c` config overrides, so those flags are silently dropped there and
 *   the server keeps its configured provider (normally `openai`). A Club
 *   session then sends the LM Studio model id to `api.openai.com` and fails
 *   with HTTP 401, because an OSS home has no OpenAI credentials.
 * - `exec` does inherit `--oss` and starts its thread under `lmstudio`, but
 *   its embedded app-server still runs with the configured `openai`
 *   provider, so `turn/start` fails with `modelProviderMismatch`.
 *
 * The root override `-c model_provider="lmstudio"` selects Codex's built-in
 * LM Studio provider for the whole process in both cases. That provider reads
 * its endpoint from the instance-scoped `CODEX_OSS_BASE_URL` child
 * environment and sends no credentials. `--oss --local-provider lmstudio` is
 * kept so `exec` stays on its OSS path and never opens the local-provider
 * picker or chooses Ollama.
 */
export const CODEX_LMSTUDIO_ROOT_ARGS: ReadonlyArray<string> = [
  "--oss",
  "--local-provider",
  "lmstudio",
  "-c",
  'model_provider="lmstudio"',
];
