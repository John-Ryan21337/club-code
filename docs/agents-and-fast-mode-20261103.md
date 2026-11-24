# Codex worker control and Fast mode

The composer now shows `16 Auto` for the default Codex worker control. The number is the maximum concurrent worker count, excluding the coordinator. Select the control to change capacity or turn automatic delegation off for this thread. Active work is not interrupted.

Capacity alone did not request delegation in current Codex. Club now includes an explicit request with each Codex turn: delegate useful independent work, choose a suitable number, avoid duplicate work and conflicting edits, collect and verify results, and close finished workers. Simple tasks can use one agent. Specific task instructions and existing permission restrictions still apply. Native disabled agent tools stay disabled. Manual mode asks for direct work unless the task explicitly requests agents. This control governs Codex; Claude does not receive a claimed native 16-worker cap.

Trait changes previously discarded the saved worker ceiling. Trait updates now preserve both thread controls. These controls stay out of sticky model defaults. An idle legacy Codex session with unrecorded capacity reconnects before the next turn so the selected ceiling reaches its CLI process.

The composer also shows `Fast` beside model traits when the selected model advertises support. Fast defaults to Off. An unset preference requests standard speed instead of following the CLI default. Select the control to request Fast or standard speed on the next send. Saved Fast On choices stay On. The existing traits menu remains available. Unsupported models do not show the button, and no model switch is made to obtain Fast.

Codex Fast uses more allowance or credits. Claude Fast uses paid usage credits outside the included limits of subscription plans. Account eligibility and native policy still apply; the provider can fall back to standard speed. Explicit Claude Off now sends `fastMode: false`, so a saved CLI preference cannot override that choice. Settings remain scoped to the selected provider instance.

Official references: [Codex speed](https://learn.chatgpt.com/docs/agent-configuration/speed), [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and [Claude Fast mode](https://code.claude.com/docs/en/fast-mode).

No-prompt metadata verification against installed Codex 0.166.0 resolved 16 workers and 17 total threads. Eight advertised models support Fast, including the current GPT-6 models. The existing Claude 2.1.317 capability probe advertises Fast for Opus 5.5. No model prompt or tool work was sent to verify these capabilities.

Evidence, source backups, native metadata, test/build results, and review allowance are under `M:/Cafe-Code/.maintenance/agents-fast-20261103`. Activation is recorded separately from source and build verification. The previously built native custom-guidance and safe Claude query-retirement improvements are included in this checkout.
