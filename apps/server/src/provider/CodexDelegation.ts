/** Send an explicit user request: native Codex no longer delegates from capacity alone. */
export function withCodexDelegationRequest(
  input: string | undefined,
  autoDelegate: boolean,
  workerLimit: number,
): string {
  const request = autoDelegate
    ? `Use parallel subagents when independent work would materially improve speed or quality. You may use up to ${workerLimit} concurrent workers beside the coordinator. Choose the useful number for this task. Give each worker a bounded, distinct task; avoid duplicate work and conflicting edits. Keep dependent work with the coordinator. Collect and verify results before reporting completion. Close finished workers. For simple tasks, work directly. Follow any more specific delegation instructions in my task. Keep existing approval, sandbox, and tool restrictions.`
    : "Automatic delegation is off for this turn. Work directly unless my task explicitly requests subagents. Keep existing approval, sandbox, and tool restrictions.";
  return `${input ?? ""}\n\n<club-code-delegation>\n${request}\n</club-code-delegation>`;
}
