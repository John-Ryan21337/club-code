import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ClaudeSettings } from "@cafecode/contracts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { expect, it, vi } from "vitest";
import {
  makeClaudeAtmosphereInterpreter,
  type AtmosphereQueryFactory,
} from "./ClaudeAtmosphereInterpreter.ts";

const settings = Schema.decodeUnknownSync(ClaudeSettings)({
  binaryPath: "selected-claude",
  homePath: resolve("synthetic-home"),
});
const success = {
  type: "result",
  subtype: "success",
  is_error: false,
  usage: { output_tokens: 12 },
  result: '{"commands":[{"kind":"set-effect","effect":"snow"}]}',
};
const run = (factory: AtmosphereQueryFactory, timeout = 1000) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const interpret = yield* makeClaudeAtmosphereInterpreter(
        settings,
        { TEST_ACCOUNT: "selected" },
        factory,
        timeout,
      );
      return yield* interpret("make it winter", "claude-test");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

it("uses the exact instance in a disposable no-tools request and removes its directory", async () => {
  let invocation: Parameters<AtmosphereQueryFactory>[0] | undefined;
  const close = vi.fn();
  const result = await run((input) => {
    invocation = input;
    return {
      close,
      async *[Symbol.asyncIterator]() {
        yield success as SDKMessage;
      },
    };
  });
  expect(result).toEqual({ status: "completed", proposal: success.result });
  expect(invocation).toMatchObject({
    prompt: "make it winter",
    options: {
      model: "claude-test",
      pathToClaudeCodeExecutable: "selected-claude",
      tools: [],
      allowedTools: [],
      disallowedTools: ["*"],
      mcpServers: {},
      strictMcpConfig: true,
      skills: [],
      plugins: [],
      permissionMode: "dontAsk",
      persistSession: false,
      maxTurns: 1,
      maxBudgetUsd: 0.25,
      settings: { disableAllHooks: true, autoMemoryEnabled: false },
      env: {
        TEST_ACCOUNT: "selected",
        HOME: resolve("synthetic-home"),
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "512",
      },
    },
  });
  expect(invocation!.options!.cwd).not.toBe(process.cwd());
  expect(existsSync(invocation!.options!.cwd!)).toBe(false);
  expect(invocation!.options!.abortController!.signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

it.each([
  { ...success, is_error: true },
  { ...success, usage: { output_tokens: 0 } },
  { ...success, usage: { output_tokens: Number.NaN } },
  { ...success, result: "private raw failure" },
  { ...success, result: "x".repeat(4097) },
  { ...success, result: '{"commands":[],"extra":"forbidden"}' },
  { ...success, result: JSON.stringify({ commands: Array(5).fill({}) }) },
])("refuses unsuccessful or unbounded terminal output %#", async (message) => {
  expect(
    await run(() => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        yield message as SDKMessage;
      },
    })),
  ).toEqual({ status: "unavailable" });
});

it("does not accept a later result after a tool attempt or message overflow", async () => {
  for (const prefix of [
    [{ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }],
    Array(65).fill({ type: "system", subtype: "init" }),
  ]) {
    expect(
      await run(() => ({
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const item of [...prefix, success]) yield item as SDKMessage;
        },
      })),
    ).toEqual({ status: "unavailable" });
  }
});

it("bounds a stalled stream, closes it, and cleans its temporary directory", async () => {
  let invocation: Parameters<AtmosphereQueryFactory>[0] | undefined;
  const close = vi.fn();
  expect(
    await run((input) => {
      invocation = input;
      return {
        close,
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((done) =>
            input.options!.abortController!.signal.addEventListener("abort", () => done(), {
              once: true,
            }),
          );
          yield success as SDKMessage;
        },
      };
    }, 15),
  ).toEqual({ status: "unavailable" });
  expect(close).toHaveBeenCalledOnce();
  expect(existsSync(invocation!.options!.cwd!)).toBe(false);
});

it("rejects a second request while the selected instance is busy", async () => {
  let started!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  const held = new Promise<void>((done) => {
    release = done;
  });
  const factory: AtmosphereQueryFactory = () => ({
    close() {},
    async *[Symbol.asyncIterator]() {
      started();
      await held;
      yield success as SDKMessage;
    },
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const interpret = yield* makeClaudeAtmosphereInterpreter(settings, {}, factory);
      const first = yield* Effect.forkChild(interpret("make it winter", "claude-test"));
      yield* Effect.promise(() => ready);
      expect(yield* interpret("make it winter", "claude-test")).toEqual({ status: "busy" });
      release();
      yield* Fiber.join(first);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

it("retains admission after the deadline until the closed iterator actually settles", async () => {
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  let calls = 0;
  const close = vi.fn();
  const factory: AtmosphereQueryFactory = () => {
    calls += 1;
    return {
      close,
      async *[Symbol.asyncIterator]() {
        await held;
        yield success as SDKMessage;
      },
    };
  };
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const interpret = yield* makeClaudeAtmosphereInterpreter(settings, {}, factory, 15);
        expect(yield* interpret("make it winter", "claude-test")).toEqual({
          status: "unavailable",
        });
        expect(close).toHaveBeenCalledOnce();
        expect(yield* interpret("make it winter", "claude-test")).toEqual({ status: "busy" });
        expect(calls).toBe(1);
        release();
        yield* Effect.promise(() => new Promise<void>((done) => setTimeout(done, 0)));
        expect(yield* interpret("make it winter", "claude-test")).toEqual({
          status: "completed",
          proposal: success.result,
        });
        expect(calls).toBe(2);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  } finally {
    release();
  }
});
