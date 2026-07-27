import { ClaudeSettings } from "@cafecode/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { probeClaudeAccountUsage } from "./ClaudeProvider.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

describe("probeClaudeAccountUsage", () => {
  it("uses a disposable no-prompt query and aborts it after a successful control response", async () => {
    let captured: Parameters<typeof claudeQuery>[0] | undefined;
    const callOrder: string[] = [];

    const result = await Effect.runPromise(
      probeClaudeAccountUsage(
        decodeClaudeSettings({ binaryPath: "claude" }),
        { status: "authenticated", email: "operator@example.com", type: "max" },
        { ...process.env },
        (input) => {
          captured = input;
          return {
            initializationResult: async () => {
              callOrder.push("initialized");
              return {
                account: {
                  email: "operator@example.com",
                  subscriptionType: "max",
                },
              };
            },
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
              callOrder.push("usage");
              return {
                subscription_type: "max",
                rate_limits_available: true,
                rate_limits: {
                  five_hour: {
                    utilization: 25,
                    resets_at: "2026-07-27T10:00:00.000Z",
                  },
                },
              };
            },
          };
        },
      ).pipe(Effect.provide(NodeServices.layer)),
    );

    expect(callOrder).toEqual(["initialized", "usage"]);
    expect(result?.rateLimits.primary).toEqual({
      usedPercent: 25,
      windowDurationMins: 300,
      resetsAt: 1_785_146_400,
      checkedAt: expect.any(String),
    });
    expect(captured?.options?.persistSession).toBe(false);
    expect(captured?.options?.allowedTools).toEqual([]);
    expect(captured?.options?.settingSources).toEqual([]);
    expect(captured?.options?.abortController?.signal.aborted).toBe(true);
    expect(typeof captured?.prompt).not.toBe("string");

    const prompt = captured?.prompt;
    if (!prompt || typeof prompt === "string") {
      throw new Error("Expected an async no-prompt iterable.");
    }
    await expect(prompt[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("fails closed and still aborts the disposable query when the control method rejects", async () => {
    let abortController: AbortController | undefined;
    const result = await Effect.runPromise(
      probeClaudeAccountUsage(
        decodeClaudeSettings({ binaryPath: "claude" }),
        { status: "authenticated", email: "operator@example.com", type: "max" },
        { ...process.env },
        (input) => {
          abortController = input.options?.abortController;
          return {
            initializationResult: async () => ({
              account: {
                email: "operator@example.com",
                subscriptionType: "max",
              },
            }),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
              throw new Error("unsupported get_usage control request");
            },
          };
        },
      ).pipe(Effect.provide(NodeServices.layer)),
    );

    expect(result).toBeUndefined();
    expect(abortController?.signal.aborted).toBe(true);
  });

  it("rejects usage when initialization belongs to a different or unbound account", async () => {
    let usageCalls = 0;
    const runProbe = (expectedAuth: {
      readonly status: "authenticated";
      readonly email?: string;
      readonly type?: string;
    }) =>
      Effect.runPromise(
        probeClaudeAccountUsage(
          decodeClaudeSettings({ binaryPath: "claude" }),
          expectedAuth,
          { ...process.env },
          () => ({
            initializationResult: async () => ({
              account: {
                email: "second@example.com",
                subscriptionType: "max",
              },
            }),
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
              usageCalls += 1;
              return {
                subscription_type: "max",
                rate_limits_available: false,
              };
            },
          }),
        ).pipe(Effect.provide(NodeServices.layer)),
      );

    await expect(
      runProbe({
        status: "authenticated",
        email: "first@example.com",
        type: "max",
      }),
    ).resolves.toBeUndefined();
    await expect(runProbe({ status: "authenticated" })).resolves.toBeUndefined();
    await expect(runProbe({ status: "authenticated", type: "max" })).resolves.toBeUndefined();
    expect(usageCalls).toBe(0);
  });
});
