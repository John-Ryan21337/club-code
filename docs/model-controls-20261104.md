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

References:

- [Claude context configuration](https://code.claude.com/docs/en/model-config#turn-off-1m-context)
- [Claude environment variables](https://code.claude.com/docs/en/env-vars)
- [Codex speed and account access](https://learn.chatgpt.com/docs/agent-configuration/speed)
- [Codex Ultra Fast service tier](https://developers.openai.com/api/docs/guides/ultrafast-mode)

Source, tests, build, publication, and activation are verified separately. A successful build does
not mean the running provider daemon has loaded these changes.
