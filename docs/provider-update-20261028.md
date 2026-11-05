# Provider update: 2026-10-28

Club Code now pins Codex CLI `0.165.0`, Claude Code `2.1.312`, and Claude Agent
SDK `0.3.312`. The Codex protocol is generated from release commit
`360319d8dee62d87e2d59fc0c21805d79519cfed`.

The operator removed the 24-hour release quarantine. Yarn uses
`npmMinimalAgeGate: 0`; future provider updates do not require age exceptions.
Exact version pins, compatibility review, and the required checks remain in place.
Historical release-age holds do not override this decision.

## Available changes

| Change                       | Club Code behavior                                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPT-6.1 Terra                | Available through native model discovery. The fallback catalog includes it only when the detected CLI is at least 0.165.0. Its six effort levels and Fast capability follow upstream metadata.                                                                                                                 |
| Current Codex model families | The fallback catalog includes the 6 and 6.1 families. A successful native `model/list` response remains authoritative for this account. Saved model selections are preserved.                                                                                                                                  |
| Google Cloud Vertex AI       | Select **Google Cloud Vertex AI** in the Codex provider's **Cloud provider** setting. Session startup, model discovery, and Git text generation use native `model_provider="gcp"`. Configure credentials and the Google Cloud project through Codex first. Local LM Studio mode takes precedence when enabled. |
| Vertex AI transport          | Native GCP authentication and its HTTPS transport remain in use. The OpenAI HTTP fallback cannot replace a selected GCP provider. OpenAI sessions retain the existing transport policy.                                                                                                                        |
| Thread memory summary        | Enable the optional experimental Codex controls, then select **Read thread memory**. Only the active provider thread is queried. The display is limited to 65,536 characters, rendered as plain text, and cleared when the thread or provider changes. Late responses from another thread are discarded.       |
| Account labels               | Google Cloud Vertex AI and the Sci / Sci Plus academic plans have explicit status labels.                                                                                                                                                                                                                      |
| Image generation protocol    | Decodes both file-ID-only images and legacy result strings, including optional input-image metadata. This is wire compatibility, not a new image-file download interface.                                                                                                                                      |
| Claude reliability           | The CLI and SDK updates supply native transcript-ordering, interrupted MCP, compaction, gateway, hook, and telemetry fixes. Already-cancelled Club question requests are denied immediately; settled requests remove their abort listeners.                                                                    |

No new Claude model family was found in this release delta. A no-prompt probe
using CLI `2.1.312` and SDK `0.3.312` returned 13 model entries and 55 commands;
the current families remain Opus 5.5, Fable 5.1, Sonnet 5.5, and Haiku 5.5.
All four advertise adaptive thinking and low through max effort; only Opus
advertises Fast mode. Existing catalog gates and explicit model selections remain.

## Native features and integration limits

Protocol generation includes native network review domains, MCP metadata,
model-request hooks, application storage fields, and the open error enum's
`modelNotFound` case. Native provider settings and managed policy remain
authoritative. Claude Monitor/plugin tool output uses the existing generic tool
event path. Cache creation TTL counters are subsets of the total and must not be
added to that total again.

Claude's new unanswered-question annotations require the
`ask_user_question_unanswered_v1` capability. Club returns actual submitted
answers or denies a cancelled request; it does not infer answers from unrelated
chat text or send unsupported annotations to older hosts. Gateway OIDC, managed
plugins, MCP mounts, and hook policy remain native configuration rather than
duplicated Club settings.

Codex's dedicated next-prompt endpoint still returns method-not-found in
`0.165.0`. Suggestions remain unavailable for Codex, as the operator requested.
Neither Claude nor ordinary `codex exec` is used as a substitute. Experimental
`thread/sample` is a separate API and does not establish the required boundary.

The generated stable `feedback/save` endpoint can export private diagnostics;
Club does not export them automatically. Attached forks remain experimental and
have source-deletion restrictions, so they are not adopted as Club's durable
thread lifecycle. Terminal preset slots, repository filters, directory grouping,
and terminal image previews belong to the native TUI. Generated types alone do
not mean that every native endpoint has a Club user interface.

The worker-limit mapping remains N workers and N+1 total threads. The native
thread unload default remains 1,800 seconds. Built-in OpenAI override and retry
semantics remain unchanged, so the scoped OpenAI fallback remains necessary.

## Verification

The exact release protocol was regenerated. Focused tests cover model version
gates, GCP routing, account labels, image decoding, cancellation, and memory
privacy boundaries. Browser tests cover explicit memory opt-in, thread changes,
and stale responses. Live metadata probes sent no prompts and created no turns.
They verify model discovery, not model-call entitlement or Google Cloud access.

The maintenance evidence directory is
`M:/Cafe-Code/.maintenance/conformance-20261027`. The final gate and activation
record is stored there after verification. This source checkout also contains
unrelated pre-existing changes; this update does not publish or stage them.

Final checks: formatting, lint, all nine typecheck tasks, all nine repository test
tasks (4,754 passed; three existing skips), desktop build, and source conformity
passed. Installed, approved, and upstream CLI versions match. A fresh independent
security review found no in-scope defect and passed 265 focused server tests.
The built server, renderer, SDK version, and copied client assets were checked.

Browser verification covered all 502 cases across runs: the complete serial run
passed 501, and the remaining Canvas heartbeat case passed in its six-test suite
after the server tests stopped. The broad parallel runs exposed shared-viewport
and timing interference. No browser test or timeout was changed; this is not a
claim that one complete browser invocation passed. The ten affected experimental
control tests pass, including memory opt-in and stale-thread response handling.

After the operator's restart, live verification on 2026-10-29 at 02:41 UTC
confirmed the new provider-runtime hash, matching served renderer asset, HTTP 200,
and SDK 0.3.312. Desktop, backend, and daemon process identities remained stable
across checks more than one minute apart. No further restart is needed. The
earlier automatic helper's unsuccessful health check is preserved separately in
the maintenance evidence; it does not describe the later verified app state.

## Sources

- [Codex 0.165.0 release](https://github.com/openai/codex/releases/tag/rust-v0.165.0)
- [Codex 0.164.0 release](https://github.com/openai/codex/releases/tag/rust-v0.164.0)
- [Pinned Codex protocol](https://github.com/openai/codex/tree/360319d8dee62d87e2d59fc0c21805d79519cfed/codex-rs/app-server-protocol)
- [Codex app-server documentation](https://developers.openai.com/codex/app-server)
- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

## 日本語

Codex CLI 0.165.0、Claude Code 2.1.312、Agent SDK 0.3.312 に更新しました。
利用者の指示により、公開から24時間の待機規則を削除しました。固定バージョン、
互換性の確認、テストは継続します。GPT-6.1 Terra、Vertex AI の選択、任意の
スレッドメモリ表示に対応します。Codex の次のプロンプト提案は公式実装を待ちます。
