# Follow-ups preserve unfinished work

Club Code adds task-continuity guidance to provider-bound chat input. Added requests extend unfinished work unless the user explicitly changes direction. A status question should receive a brief answer, followed by continued work. A correction changes the affected part of the task. An explicit redirect, replacement, pause, or cancellation takes precedence for the affected work.

Independent additions can use native agents when the task and current delegation settings allow them. Reuse available workers and share the existing worker capacity across follow-ups. Dependent work stays with the coordinator. Do not create a worker for every message. Collect and verify delegated results before reporting completion.

The shared provider service adds this guidance after input validation, immediately before adapter delivery. This covers native steers, ordinary turns, queued follow-ups, and recovered next turns. Stored user text, attachments, request IDs, and native system instructions retain their existing meaning. The service does not classify intent from keywords or fork a provider session.

Codex uses its native steer path. Claude queues input in the active SDK session. OpenCode follow-ups retain their existing safe turn-boundary queue. LM Studio uses the Codex OSS adapter. Provider tools and delegation controls remain authoritative; this guidance does not add agent tools or a worker setting to a provider that lacks them.

Explicit Stop, provider safety blocks, approvals, sandbox rules, and tool restrictions remain authoritative. A steer cannot bypass these boundaries. Compaction and review waits retain the existing queue and recovery behavior.

This change guides model behavior. It does not guarantee that every model will follow the guidance. Deterministic tests verify delivery and routing; they do not measure model compliance. Activation requires the updated provider runtime. Building this change does not restart the running app.
