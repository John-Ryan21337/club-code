import { describe, expect, it } from "vitest";
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@cafecode/contracts";
import { buildDeepResearchPrompt, DEEP_RESEARCH_INSTRUCTIONS } from "./deepResearch";

describe("deep research dispatch", () => {
  it("leaves ordinary messages unchanged and does not send an empty research request", () => {
    expect(buildDeepResearchPrompt("  Original request\n", false)).toBe("  Original request\n");
    expect(buildDeepResearchPrompt("", true)).toBe("");
    expect(buildDeepResearchPrompt("   ", true)).toBe("   ");
  });

  it("preserves the request and adds clarification and source requirements for this task", () => {
    const request = "Compare public transit options in Tokyo.\nUse sources in Japanese.";
    const result = buildDeepResearchPrompt(request, true)!;
    expect(result.startsWith(request + "\n\n")).toBe(true);
    expect(result).toContain("wait for my answers");
    expect(result).toContain("direct source links");
    expect(result).toContain("not unrelated later requests");
    expect(buildDeepResearchPrompt("", true, true)).toBe(DEEP_RESEARCH_INSTRUCTIONS);
  });

  it("refuses an oversized dispatch without truncating the request or research instructions", () => {
    const limit = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - DEEP_RESEARCH_INSTRUCTIONS.length - 2;
    expect(buildDeepResearchPrompt("x".repeat(limit), true)?.length).toBe(
      PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
    );
    expect(buildDeepResearchPrompt("x".repeat(limit + 1), true)).toBeNull();
  });
});
