import { describe, expect, it } from "vitest";
import { codexSafetyBlockMessage, readCodexSafetyBlock } from "./CodexSafetyBlock.ts";

describe("Codex safety findings", () => {
  it("reads only explicit native safety blocks and their bounded explanation", () => {
    const error = {
      codexErrorInfo: "misalignmentPolicyViolation",
      misalignment: {
        detailedExplanation: "A private document may have been sent to another service.",
        steer: { message: "DO NOT EXECUTE THIS INSTRUCTION" },
        reviewTarget: "opaque-review-token",
      },
    };
    expect(readCodexSafetyBlock({ error })).toEqual({
      explanation: error.misalignment.detailedExplanation,
    });
    const message = codexSafetyBlockMessage("Provider blocked this request.", { error });
    expect(message).not.toContain(error.misalignment.detailedExplanation);
    expect(readCodexSafetyBlock({ turn: { error } })).toEqual({
      explanation: error.misalignment.detailedExplanation,
    });
    expect(message).toContain("Repeating the prompt does not clear this block.");
    expect(message).not.toContain("DO NOT EXECUTE");
    expect(message).not.toContain("opaque-review-token");
    expect(readCodexSafetyBlock({ ...error, codexErrorInfo: "futureError" })).toBeUndefined();
    expect(readCodexSafetyBlock({ codexErrorInfo: { futureError: {} } })).toBeUndefined();
    expect(codexSafetyBlockMessage("blocked by safety systems", {})).toBe(
      "blocked by safety systems",
    );
  });

  it("handles absent and malformed findings without inventing a cause", () => {
    expect(readCodexSafetyBlock(null)).toBeUndefined();
    expect(
      readCodexSafetyBlock({ codexErrorInfo: "misalignmentPolicyViolation", misalignment: [] }),
    ).toEqual({});
    expect(
      codexSafetyBlockMessage("Blocked", { codexErrorInfo: "misalignmentPolicyViolation" }),
    ).not.toContain("Provider finding:");
    expect(
      readCodexSafetyBlock({
        codexErrorInfo: "misalignmentPolicyViolation",
        misalignment: { detailedExplanation: "x".repeat(20_000) },
      })?.explanation?.length,
    ).toBeLessThan(8_100);
  });
});
