# Model controls

Reasoning effort, context window, and response speed are separate controls.

## Reasoning effort

Club Code selects **High** when the model supports it. Saved effort choices remain in effect.
The effort menu shows concrete supported levels. It does not show a CLI-default choice.
A context value such as 1M is not an effort level.

Codex and Claude receive the chosen effort explicitly. OpenCode uses the supported High variant
from its model inventory. Models without a High level keep their supported choices.

## Context window

Current hosted Codex and Claude models default to a **200K-token budget**. The context menu shows
the supported alternatives. A saved explicit context choice remains in effect.

Claude offers 200K and 1M on its compatible models. Each query receives its own
`CLAUDE_CODE_DISABLE_1M_CONTEXT` setting. Club Code does not change the global CLI configuration.
The 200K choice sets this flag to `1`; the 1M choice sets it to `0`.

A resumed Claude conversation can outgrow the selected window. Claude Code then refuses the
prompt locally with "Prompt is too long" and does not call the API. Club Code hides that
synthetic reply and keeps the turn active. It adds a work-log warning, runs `/compact` once, and
then resends the original prompt once. Only the refused prompt is resent, and only when the
refusal proves that the API did not receive it. An explicit Stop cancels the recovery. If
compaction fails or Claude refuses the prompt again, the turn fails with this message: select the
1M context window or start a new thread.

Known hosted Codex models use the pinned native catalog to expose supported context budgets.
These are configurable budgets within the model's capacity. They are not separate model tiers.
Club Code does not label an 872K input capacity as 1M. Context changes take effect through the
existing idle session restart and resume path. Active work is not interrupted.

The context meter uses native usage information. A 200K Codex budget can compact at 180K tokens
or earlier if the provider has a lower compaction threshold.

LM Studio keeps the context of its loaded local model. Club Code does not reload the model or
invent unsupported context options. OpenCode exposes the controls available through its native
model inventory and request API.

## Response speed

Standard speed is the default. Existing explicit Fast choices remain supported.

Codex models that advertise Ultra Fast show a speed menu with the supported choices. The native
CLI controls account access and model availability. Models that advertise Fast alone show Ultra
Fast as unavailable. Claude retains its supported Fast control.

Fast and Ultra Fast can consume more allowance or paid credits. Selecting a speed does not
change reasoning effort or context. Unsupported saved speed choices return to Standard.

### Allow paid usage

Each Codex and Claude provider instance has an **Allow paid usage** switch in Settings →
Providers. It is Off by default. While it is Off, Club Code sends every request at the standard
service tier (Codex) or with Fast mode off (Claude), including Git text generation, even when a
thread's saved speed choice is Fast or Ultra Fast. The composer shows a Standard chip that
explains the block, and the speed controls are hidden until the switch is On. Turning the switch
On restores the saved speed choice without changing it. The switch only controls which routes
Club Code requests; it does not change account billing settings at OpenAI or Anthropic, and the
provider's own paid-usage status still appears separately in the usage widget.

References:

- [Claude context configuration](https://code.claude.com/docs/en/model-config#turn-off-1m-context)
- [Claude environment variables](https://code.claude.com/docs/en/env-vars)
- [Codex speed and account access](https://learn.chatgpt.com/docs/agent-configuration/speed)
- [Codex Ultra Fast service tier](https://developers.openai.com/api/docs/guides/ultrafast-mode)

Source, tests, build, publication, and activation are verified separately. A successful build does
not mean the running provider daemon has loaded these changes.
