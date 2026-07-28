import { describe, expect, it } from "vitest";

import { isClaudeUsageLimitResult } from "./claudeUsageLimitResult.ts";

describe("isClaudeUsageLimitResult", () => {
  it("classifies a genuine session-limit rejection via the structured api_error_status", () => {
    // Observed shape: subtype "success" with is_error true and api_error_status 429.
    expect(
      isClaudeUsageLimitResult({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 429,
        result: "You've hit your session limit, resets 11:30am (America/Los_Angeles)",
      }),
    ).toBe(true);
  });

  it("falls back to a known usage-limit prefix when the numeric status is absent", () => {
    expect(
      isClaudeUsageLimitResult({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "You're out of usage credits for this billing period.",
      }),
    ).toBe(true);
    expect(
      isClaudeUsageLimitResult({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Your org is out of usage · add funds to continue"],
      }),
    ).toBe(true);
  });

  it("does not classify an auth failure or a generic execution error as a usage-limit rejection", () => {
    expect(
      isClaudeUsageLimitResult({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 401,
        result: "Invalid authentication credentials",
      }),
    ).toBe(false);
    expect(
      isClaudeUsageLimitResult({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        num_turns: 0,
        errors: ["Something else went wrong"],
      }),
    ).toBe(false);
  });

  it("lets a structured non-429 status outrank a conflicting usage-limit prefix", () => {
    for (const apiErrorStatus of [401, 529]) {
      expect(
        isClaudeUsageLimitResult({
          type: "result",
          subtype: "success",
          is_error: true,
          api_error_status: apiErrorStatus,
          result: "You've hit your session limit, resets 11:30am (America/Los_Angeles)",
        }),
      ).toBe(false);
    }
  });

  it("does not classify a successful, non-error result", () => {
    expect(
      isClaudeUsageLimitResult({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done",
      }),
    ).toBe(false);
  });

  it("does not classify an overloaded server error as a usage-limit rejection", () => {
    expect(
      isClaudeUsageLimitResult({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 529,
        result: "Overloaded",
      }),
    ).toBe(false);
  });

  it("is defensive against non-result and malformed input", () => {
    expect(isClaudeUsageLimitResult(null)).toBe(false);
    expect(isClaudeUsageLimitResult(undefined)).toBe(false);
    expect(isClaudeUsageLimitResult("nope")).toBe(false);
    expect(isClaudeUsageLimitResult({})).toBe(false);
    expect(isClaudeUsageLimitResult({ type: "assistant", is_error: true })).toBe(false);
  });
});
