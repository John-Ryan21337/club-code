import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@cafecode/contracts";
import { canSuggestNextPrompt, nextPromptContext, suggestNextPrompt } from "./PromptSuggestions.ts";
import type { TextGenerationShape } from "./TextGeneration.ts";
import { buildNextPrompt } from "./NextPrompt.ts";

const turnId = TurnId.make("turn-1");
const threadId = ThreadId.make("thread-1");
function fixture() {
  const shell = {
    id: threadId,
    latestTurn: { turnId, state: "completed" },
    modelSelection: { instanceId: ProviderInstanceId.make("codex-work"), model: "test-model" },
    archivedAt: null,
    deletedAt: null,
    interactionMode: "default",
    manualFollowUpCount: 0,
    autoNudge: { mode: "off" },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    session: { status: "ready", activeTurnId: null },
  } as OrchestrationThreadShell;
  const detail = {
    ...shell,
    manualFollowUps: [],
    messages: [
      { role: "user", text: "Review the change", turnId },
      {
        role: "assistant",
        text: "Review complete. A regression test would help.",
        turnId,
        streaming: false,
      },
    ],
  } as unknown as OrchestrationThread;
  let enabled = true;
  let calls = 0;
  let afterGenerate = () => {};
  const textGeneration = {
    generateNextPrompt: () =>
      Effect.sync(() => {
        calls++;
        afterGenerate();
        return { suggestion: "Add a regression test." };
      }),
  } as unknown as TextGenerationShape;
  const run = () =>
    Effect.runPromise(
      suggestNextPrompt({
        threadId,
        turnId,
        cwd: "unused",
        textGeneration,
        enabled: Effect.sync(() => enabled),
        readShell: () => Effect.succeed(Option.some(shell)),
        readThread: () => Effect.succeed(Option.some(detail)),
      }),
    );
  return {
    shell,
    detail,
    run,
    calls: () => calls,
    disable: () => {
      enabled = false;
    },
    after: (fn: () => void) => {
      afterGenerate = fn;
    },
  };
}

describe("prompt suggestions", () => {
  it("does no work when disabled and shares one result across repeated requests", async () => {
    const off = fixture();
    off.disable();
    expect(await off.run()).toEqual({ suggestion: null });
    expect(off.calls()).toBe(0);
    const on = fixture();
    expect(await on.run()).toEqual({ suggestion: "Add a regression test." });
    expect(await on.run()).toEqual({ suggestion: "Add a regression test." });
    expect(on.calls()).toBe(1);
  });
  it("rejects stale, failed, running, plan, queued, and approval states", () => {
    const { shell } = fixture();
    expect(canSuggestNextPrompt(shell, turnId)).toBe(true);
    expect(canSuggestNextPrompt(shell, TurnId.make("other"))).toBe(false);
    for (const patch of [
      { latestTurn: { ...shell.latestTurn!, state: "error" as const } },
      { latestTurn: { ...shell.latestTurn!, state: "running" as const } },
      { interactionMode: "plan" as const },
      { manualFollowUpCount: 1 },
      { hasPendingApprovals: true },
      { hasPendingUserInput: true },
      { autoNudge: { ...shell.autoNudge, mode: "steady-progress" as const } },
    ])
      expect(canSuggestNextPrompt({ ...shell, ...patch }, turnId)).toBe(false);
  });
  it("discards a delayed result when disabled or a newer turn starts", async () => {
    const disabled = fixture();
    disabled.after(disabled.disable);
    expect(await disabled.run()).toEqual({ suggestion: null });
    const newer = fixture();
    newer.after(() => {
      Object.assign(newer.shell, { latestTurn: { turnId: TurnId.make("new"), state: "running" } });
    });
    expect(await newer.run()).toEqual({ suggestion: null });
  });
  it("does not send stale detail or active-goal context to a provider", async () => {
    const stale = fixture();
    Object.assign(stale.detail, { latestTurn: { turnId: TurnId.make("new"), state: "running" } });
    expect(await stale.run()).toEqual({ suggestion: null });
    expect(stale.calls()).toBe(0);
    const goal = fixture();
    Object.assign(goal.detail, { goal: { status: "active" } });
    expect(await goal.run()).toEqual({ suggestion: null });
    expect(goal.calls()).toBe(0);
  });
  it("hides cached results when a goal starts and discards changed transcript output", async () => {
    const cached = fixture();
    await cached.run();
    Object.assign(cached.detail, { goal: { status: "active" } });
    expect(await cached.run()).toEqual({ suggestion: null });
    expect(cached.calls()).toBe(1);
    const changed = fixture();
    changed.after(() => Object.assign(changed.detail.messages[1]!, { text: "New final answer" }));
    expect(await changed.run()).toEqual({ suggestion: null });
  });
  it("bounds transcript data and excludes system text, streaming and trailing user messages", () => {
    const { detail } = fixture();
    const huge = {
      ...detail,
      messages: [
        { ...detail.messages[0]!, role: "system" as const, text: "private-system-instructions" },
        ...Array.from({ length: 20 }, () => ({ ...detail.messages[1]!, text: "a".repeat(10_000) })),
      ],
    };
    const context = nextPromptContext(huge)!;
    expect(context.length).toBeLessThan(13_000);
    expect(context).not.toContain("private-system-instructions");
    expect(JSON.parse(context)).toHaveLength(6);
    expect(
      nextPromptContext({ ...detail, messages: [...detail.messages, detail.messages[0]!] }),
    ).toBeNull();
    expect(
      nextPromptContext({ ...detail, messages: [{ ...detail.messages[1]!, streaming: true }] }),
    ).toBeNull();
    expect(buildNextPrompt(context).prompt).toContain("Do not carry out the suggestion");
  });
});
