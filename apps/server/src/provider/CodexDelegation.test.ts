import { describe, expect, it } from "vitest";
import { withCodexDelegationRequest } from "./CodexDelegation.ts";

describe("Codex delegation requests", () => {
  it.each([1, 16, 128])("requests bounded, useful delegation with %i workers", (limit) => {
    const text = withCodexDelegationRequest("Investigate the bug.", true, limit);
    expect(text).toContain("Investigate the bug.");
    expect(text).toContain(`up to ${limit} concurrent workers beside the coordinator`);
    expect(text).toContain("For simple tasks, work directly");
    expect(text).toContain("approval, sandbox, and tool restrictions");
    expect(text).toContain("Collect and verify results");
  });
  it("sends the current off choice after earlier turns requested delegation", () => {
    const text = withCodexDelegationRequest("Continue.", false, 16);
    expect(text).toContain("Automatic delegation is off for this turn");
    expect(text).toContain("unless my task explicitly requests subagents");
  });
});
