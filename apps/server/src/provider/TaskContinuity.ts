const TASK_CONTINUITY_GUIDANCE = `<club-code-task-continuity>
Keep the current unfinished task and accepted additions in scope when a new message arrives.
Treat additions and corrections as updates, not as replacement tasks.
Answer status questions and quick questions briefly. Answer substantive questions as requested, then resume unfinished work.
An explicit redirect, replacement, pause, or cancellation controls the affected work. Honor Stop.
For independent additions, use native subagents only when the task and current delegation settings permit them.
Reuse idle workers or free worker slots. Preserve running worker assignments unless explicitly redirected.
Share the existing worker capacity across the original task and all steers.
Keep any configured worker limit and native provider limit.
Do not create a new worker allowance for each message. Keep dependent work with the coordinator.
Give each worker a distinct, bounded task. Avoid conflicting edits. Wait for and verify required results before reporting completion.
If delegation is unavailable or not permitted, retain the addition and complete it without abandoning the current task.
Keep all existing tool, approval, and sandbox restrictions. Do not restart or interrupt active work merely to handle a message.
</club-code-task-continuity>`;

/** Append guidance only after the original user request has passed validation. */
export function withTaskContinuityGuidance(input: string | undefined): string {
  return input === undefined ? TASK_CONTINUITY_GUIDANCE : `${input}\n\n${TASK_CONTINUITY_GUIDANCE}`;
}
