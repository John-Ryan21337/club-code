import { describe, expect, it } from "vitest";

import { EnvironmentId, ThreadId } from "@cafecode/contracts";

import {
  IDLE_THREAD_GUARD_DEFAULT_PROMPT,
  IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL,
  IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE,
  idleThreadGuardAcknowledgedBarrier,
  idleThreadGuardDefaultPromptForLanguage,
  isIdleThreadGuardDue,
  latestIdleActivityAt,
  migrateStoredIdleThreadGuardBuiltInPrompt,
  normalizeIdleThreadGuardBuiltInPrompt,
  readIdleThreadGuardConfig,
} from "./idleThreadGuard";

describe("Idle Thread Guard language-aware built-in prompts", () => {
  it("provides English, Japanese, and authored bilingual defaults", () => {
    expect(idleThreadGuardDefaultPromptForLanguage("en")).toBe(IDLE_THREAD_GUARD_DEFAULT_PROMPT);
    expect(idleThreadGuardDefaultPromptForLanguage("ja")).toBe(
      IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE,
    );
    expect(idleThreadGuardDefaultPromptForLanguage("dual")).toBe(
      IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL,
    );
    expect(IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL).toContain(IDLE_THREAD_GUARD_DEFAULT_PROMPT);
    expect(IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL).toContain(
      IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE,
    );
  });

  it("migrates all built-ins without changing custom operator text", () => {
    for (const source of [
      IDLE_THREAD_GUARD_DEFAULT_PROMPT,
      IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE,
      IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL,
    ]) {
      expect(migrateStoredIdleThreadGuardBuiltInPrompt(source, "ja")).toBe(
        IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE,
      );
    }
    expect(normalizeIdleThreadGuardBuiltInPrompt("   ", "dual")).toBe(
      IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL,
    );

    const custom = "  Check only after my nightly import — 夜間処理後のみ  ";
    expect(migrateStoredIdleThreadGuardBuiltInPrompt(custom, "dual")).toBe(custom);
    expect(normalizeIdleThreadGuardBuiltInPrompt(custom, "ja")).toBe(custom);
  });
});

describe("Idle Thread Guard safety timing", () => {
  it("has no enabled configuration by default", () => {
    expect(
      readIdleThreadGuardConfig({
        environmentId: EnvironmentId.make("environment-default-off"),
        threadId: ThreadId.make("thread-default-off"),
      }),
    ).toBeNull();
  });

  it("uses the newest transcript, tool, session, or arming activity", () => {
    expect(
      latestIdleActivityAt([
        "2026-07-30T01:00:00.000Z",
        "2026-07-30T03:00:00.000Z",
        null,
        "2026-07-30T02:00:00.000Z",
      ]),
    ).toBe("2026-07-30T03:00:00.000Z");
  });

  it("never accepts a sub-hour deadline even from malformed persisted state", () => {
    expect(
      isIdleThreadGuardDue({
        nowMs: Date.parse("2026-07-30T01:59:59.000Z"),
        latestActivityAt: "2026-07-30T01:00:00.000Z",
        armedAt: "2026-07-30T01:00:00.000Z",
        idleHours: 0.01,
      }),
    ).toBe(false);
    expect(
      isIdleThreadGuardDue({
        nowMs: Date.parse("2026-07-30T02:00:00.000Z"),
        latestActivityAt: "2026-07-30T01:00:00.000Z",
        armedAt: "2026-07-30T01:00:00.000Z",
        idleHours: 0.01,
      }),
    ).toBe(true);
  });

  it("starts a newly enabled guard from arming time instead of immediately firing on old silence", () => {
    expect(
      isIdleThreadGuardDue({
        nowMs: Date.parse("2026-07-30T06:00:00.000Z"),
        latestActivityAt: "2026-07-30T01:00:00.000Z",
        armedAt: "2026-07-30T05:30:00.000Z",
        idleHours: 1,
      }),
    ).toBe(false);
  });

  it("moves the one-shot barrier past the acknowledged dispatch without reviving stale attempts", () => {
    const dispatchedAt = "2026-07-30T05:00:00.000Z";
    const acknowledgedAt = "2026-07-30T05:00:01.000Z";

    expect(
      idleThreadGuardAcknowledgedBarrier({
        currentAwaitingActivityAfterDispatchAt: dispatchedAt,
        dispatchAttemptAt: dispatchedAt,
        acknowledgedAt,
      }),
    ).toBe(acknowledgedAt);
    expect(
      idleThreadGuardAcknowledgedBarrier({
        currentAwaitingActivityAfterDispatchAt: "2026-07-30T05:00:00.500Z",
        dispatchAttemptAt: dispatchedAt,
        acknowledgedAt,
      }),
    ).toBeNull();
    expect(
      idleThreadGuardAcknowledgedBarrier({
        currentAwaitingActivityAfterDispatchAt: dispatchedAt,
        dispatchAttemptAt: dispatchedAt,
        acknowledgedAt: "2026-07-30T04:59:59.000Z",
      }),
    ).toBe(dispatchedAt);
  });
});
