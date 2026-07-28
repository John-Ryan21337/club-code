import { describe, expect, it } from "vitest";

import { classifyCodexErrorInfo, isCodexUsageLimitExceeded } from "./codexErrorClassification.ts";

describe("classifyCodexErrorInfo", () => {
  it("classifies a genuine usage/session-limit rejection distinctly from overload", () => {
    expect(classifyCodexErrorInfo("usageLimitExceeded")).toBe("usage_limit");
    expect(classifyCodexErrorInfo("serverOverloaded")).toBe("overloaded");
    expect(classifyCodexErrorInfo("usageLimitExceeded")).not.toBe(
      classifyCodexErrorInfo("serverOverloaded"),
    );
  });

  it("classifies every known literal variant without collapsing distinct categories", () => {
    expect(classifyCodexErrorInfo("contextWindowExceeded")).toBe("context_window");
    expect(classifyCodexErrorInfo("sessionBudgetExceeded")).toBe("session_budget");
    expect(classifyCodexErrorInfo("cyberPolicy")).toBe("cyber_policy");
    expect(classifyCodexErrorInfo("internalServerError")).toBe("internal");
    expect(classifyCodexErrorInfo("unauthorized")).toBe("auth");
    expect(classifyCodexErrorInfo("badRequest")).toBe("bad_request");
    expect(classifyCodexErrorInfo("threadRollbackFailed")).toBe("thread_rollback");
    expect(classifyCodexErrorInfo("sandboxError")).toBe("sandbox");
    expect(classifyCodexErrorInfo("other")).toBe("other");
  });

  it("classifies every object-shaped variant as connection or not-steerable", () => {
    expect(classifyCodexErrorInfo({ httpConnectionFailed: {} })).toBe("connection");
    expect(classifyCodexErrorInfo({ httpConnectionFailed: { httpStatusCode: 503 } })).toBe(
      "connection",
    );
    expect(classifyCodexErrorInfo({ responseStreamConnectionFailed: {} })).toBe("connection");
    expect(classifyCodexErrorInfo({ responseStreamDisconnected: {} })).toBe("connection");
    expect(classifyCodexErrorInfo({ responseTooManyFailedAttempts: {} })).toBe("connection");
    expect(classifyCodexErrorInfo({ activeTurnNotSteerable: { turnKind: "compact" } })).toBe(
      "not_steerable",
    );
  });

  it("is conservatively 'other' for missing or unrecognized future values", () => {
    expect(classifyCodexErrorInfo(null)).toBe("other");
    expect(classifyCodexErrorInfo(undefined)).toBe("other");
    // A future SDK literal this pin predates must not be misclassified as a
    // quota rejection or any other concrete category.
    expect(
      classifyCodexErrorInfo(
        "someFutureCodexErrorLiteral" as unknown as Parameters<typeof classifyCodexErrorInfo>[0],
      ),
    ).toBe("other");
    expect(
      classifyCodexErrorInfo({
        someFutureCodexErrorObject: {},
      } as unknown as Parameters<typeof classifyCodexErrorInfo>[0]),
    ).toBe("other");
  });
});

describe("isCodexUsageLimitExceeded", () => {
  it("is true only for the exact usageLimitExceeded literal", () => {
    expect(isCodexUsageLimitExceeded("usageLimitExceeded")).toBe(true);
    expect(isCodexUsageLimitExceeded("serverOverloaded")).toBe(false);
    expect(isCodexUsageLimitExceeded("contextWindowExceeded")).toBe(false);
    expect(isCodexUsageLimitExceeded({ httpConnectionFailed: {} })).toBe(false);
    expect(isCodexUsageLimitExceeded(null)).toBe(false);
    expect(isCodexUsageLimitExceeded(undefined)).toBe(false);
  });
});
