import { ClaudeSettings } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { it as effectIt } from "@effect/vitest";
import { existsSync } from "node:fs";
import * as NodePath from "node:path";
import { expect, it } from "vitest";
import {
  probeClaudeAccountUsage,
  supportsClaudeAccountUsage,
  type ClaudeUsageQueryFactory,
} from "./claudeAccountUsageProbe.ts";

const settings = Schema.decodeUnknownSync(ClaudeSettings)({
  binaryPath: "./synthetic-claude",
  homePath: NodePath.resolve("synthetic-home"),
});
const auth = {
  status: "authenticated",
  email: "synthetic@example.invalid",
  type: "Claude Max 20x Subscription",
} as const;
const initialization = {
  account: { email: auth.email, subscriptionType: "max", tokenSource: "oauth" },
};
const usage = {
  subscription_type: "max",
  rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 25, resets_at: "2026-09-13T00:00:00Z" } },
  session: { private: "discard this" },
  behaviors: { private: "discard this too" },
};
const run = (factory: ClaudeUsageQueryFactory) =>
  Effect.runPromise(
    probeClaudeAccountUsage(
      settings,
      auth,
      { PATH: "relative-bin", SYNTHETIC_SETTING: "preserved" },
      factory,
    ).pipe(Effect.provide(NodeServices.layer)),
  );

it("binds the exact account and paths in an empty disposable query, skips transcript scans, and cleans up", async () => {
  let captured: Parameters<ClaudeUsageQueryFactory>[0] | undefined;
  let closed = false;
  const result = await run((input) => {
    captured = input;
    expect(existsSync(input.options!.cwd!)).toBe(true);
    return {
      initializationResult: async () => initialization,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (options) => {
        expect(options).toEqual({ skipBehaviors: true });
        return usage;
      },
      close: () => {
        closed = true;
      },
    };
  });
  expect(result?.rateLimits.primary?.usedPercent).toBe(25);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(captured?.options?.pathToClaudeCodeExecutable).toBe(NodePath.resolve("synthetic-claude"));
  expect(captured?.options?.env?.PATH).toBe(NodePath.resolve("relative-bin"));
  expect(captured?.options?.env?.SYNTHETIC_SETTING).toBe("preserved");
  expect(captured?.options?.tools).toEqual([]);
  expect(captured?.options?.mcpServers).toEqual({});
  expect(captured?.options?.strictMcpConfig).toBe(true);
  expect(captured?.options?.settings).toMatchObject({
    disableAllHooks: true,
    autoMemoryEnabled: false,
  });
  expect(captured?.options?.settingSources).toEqual(["user"]);
  expect(captured?.options?.persistSession).toBe(false);
  expect(captured?.options?.abortController?.signal.aborted).toBe(true);
  expect(closed).toBe(true);
  expect(existsSync(captured!.options!.cwd!)).toBe(false);
  const prompt = captured!.prompt;
  if (typeof prompt === "string") throw new Error("Expected a no-prompt iterable");
  expect(await prompt[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
});

it.each([
  { account: { email: "other@example.invalid", subscriptionType: "max" } },
  { account: { subscriptionType: "max" } },
  { account: { email: auth.email, subscriptionType: "team" } },
  { account: { email: auth.email, subscriptionType: "max", tokenSource: "ANTHROPIC_API_KEY" } },
])("rejects mismatched or unbound accounts without reading usage: %j", async (initialized) => {
  let usageCalls = 0;
  const result = await run(() => ({
    initializationResult: async () => initialized,
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
      usageCalls++;
      return usage;
    },
    close: () => {},
  }));
  expect(result).toBeUndefined();
  expect(usageCalls).toBe(0);
});

it("contains unsupported control errors and closes the query", async () => {
  let closed = false;
  const result = await run(() => ({
    initializationResult: async () => initialization,
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
      throw new Error("synthetic private provider output");
    },
    close: () => {
      closed = true;
    },
  }));
  expect(result).toBeUndefined();
  expect(closed).toBe(true);
});

it("advertises only supported CLI generations with bound subscription auth", () => {
  expect(supportsClaudeAccountUsage({ auth, version: "2.1.266" })).toBe(true);
  expect(supportsClaudeAccountUsage({ auth, version: "2.1.259" })).toBe(false);
  expect(
    supportsClaudeAccountUsage({
      auth: { status: "authenticated", type: "apiKey", email: auth.email },
      version: "2.1.266",
    }),
  ).toBe(false);
  expect(
    supportsClaudeAccountUsage({
      auth: { status: "authenticated", type: "max" },
      version: "2.1.266",
    }),
  ).toBe(false);
});

effectIt.effect(
  "aborts a stalled initialization at the fixed deadline and removes its temporary directory",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let captured: Parameters<ClaudeUsageQueryFactory>[0] | undefined;
      let closed = false;
      const fiber = yield* probeClaudeAccountUsage(settings, auth, {}, (input) => {
        captured = input;
        Effect.runSync(Deferred.succeed(started, undefined));
        return {
          initializationResult: () => new Promise(() => {}),
          usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
            throw new Error("must not read usage");
          },
          close: () => {
            closed = true;
          },
        };
      }).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("12 seconds");
      expect(yield* Fiber.join(fiber)).toBeUndefined();
      expect(captured?.options?.abortController?.signal.aborted).toBe(true);
      expect(closed).toBe(true);
      expect(existsSync(captured!.options!.cwd!)).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
);
