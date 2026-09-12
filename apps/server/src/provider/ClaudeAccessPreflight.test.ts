import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ClaudeSettings, ProviderInstanceId } from "@cafecode/contracts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";

import {
  classifyClaudeAccessMessage as classifyAccessResult,
  withAccessProbeOutputLimit,
  makeClaudeAccessChecker,
  probeClaudeAccess,
  type ClaudeAccessQueryFactory,
} from "./ClaudeAccessPreflight.ts";

const success = {
  type: "result",
  subtype: "success",
  is_error: false,
  usage: { output_tokens: 1 },
  result: "ACCESS_OK_test",
};
const classifyClaudeAccessMessage = (message: unknown) =>
  classifyAccessResult(message, success.result);
const settings = Schema.decodeUnknownSync(ClaudeSettings)({
  binaryPath: "exact-claude",
  homePath: resolve("probe-home"),
});

describe("Claude access preflight", () => {
  it("requires a successful live result with output usage, not initialization or text", () => {
    expect(
      classifyClaudeAccessMessage({
        type: "system",
        subtype: "init",
        account: { email: "test@example.invalid" },
      }),
    ).toBeUndefined();
    expect(classifyClaudeAccessMessage({ ...success, usage: {} })).toBe("unverified");
    expect(classifyClaudeAccessMessage({ ...success, is_error: true })).toBe("unverified");
    expect(
      classifyClaudeAccessMessage({ ...success, result: "rate limit authentication_failed" }),
    ).toBe("unverified");
    expect(
      classifyClaudeAccessMessage({ type: "result", is_error: true, result: "private detail" }),
    ).toBe("unverified");
    for (const [status, expected] of [
      [401, "authentication-required"],
      [403, "account-restricted"],
      [429, "rate-limited"],
    ] as const) {
      expect(
        classifyClaudeAccessMessage({
          type: "result",
          is_error: true,
          error_status: status,
          message: "private detail",
        }),
      ).toBe(expected);
    }
  });

  it("uses the exact home, binary and model in a disposable request with tools and hooks disabled", async () => {
    const close = vi.fn();
    let invocation: Parameters<ClaudeAccessQueryFactory>[0] | undefined;
    const factory: ClaudeAccessQueryFactory = (input) => {
      invocation = input;
      return {
        close,
        async *[Symbol.asyncIterator]() {
          yield {
            ...success,
            result: String(input.prompt).replace("Reply exactly with ", ""),
          } as SDKMessage;
        },
      };
    };
    const status = await Effect.runPromise(
      probeClaudeAccess(
        settings,
        "claude-test-model",
        { CLAUDE_CONFIG_DIR: resolve("account-config"), TEST_INSTANCE: "selected" },
        factory,
      ).pipe(Effect.provide(NodeServices.layer)),
    );
    expect(status).toBe("verified");
    expect(invocation?.options).toMatchObject({
      pathToClaudeCodeExecutable: "exact-claude",
      model: "claude-test-model",
      tools: [],
      allowedTools: [],
      disallowedTools: ["*"],
      skills: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 1,
      permissionMode: "dontAsk",
      settingSources: ["user"],
      settings: { disableAllHooks: true, autoMemoryEnabled: false },
      env: {
        HOME: resolve("probe-home"),
        CLAUDE_CONFIG_DIR: resolve("account-config"),
        TEST_INSTANCE: "selected",
      },
    });
    expect(invocation?.prompt).toMatch(/^Reply exactly with ACCESS_OK_[a-f0-9]{16}$/u);
    expect(invocation?.options?.cwd).not.toBe(process.cwd());
    expect(existsSync(invocation!.options!.cwd!)).toBe(false);
    expect(invocation?.options?.abortController?.signal.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("aborts a stalled request and removes its temporary directory without returning raw errors", async () => {
    const close = vi.fn();
    let invocation: Parameters<ClaudeAccessQueryFactory>[0] | undefined;
    const factory: ClaudeAccessQueryFactory = (input) => {
      invocation = input;
      return {
        close,
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) =>
            input.options!.abortController!.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
          yield success as SDKMessage;
        },
      };
    };
    const result = await Effect.runPromise(
      probeClaudeAccess(settings, "model", {}, factory, 20).pipe(
        Effect.provide(NodeServices.layer),
      ),
    );
    expect(result).toBe("unverified");
    expect(close).toHaveBeenCalledOnce();
    expect(invocation?.options?.abortController?.signal.aborted).toBe(true);
    expect(existsSync(invocation!.options!.cwd!)).toBe(false);
  });

  it("waits for terminal results so recovered retries do not become false failures", async () => {
    for (const [retryStatus, terminalSuccess, expected] of [
      [429, true, "verified"],
      [401, true, "verified"],
      [401, false, "authentication-required"],
    ] as const) {
      const factory: ClaudeAccessQueryFactory = (input) => ({
        close: vi.fn(),
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "api_retry",
            error_status: retryStatus,
          } as unknown as SDKMessage;
          yield {
            ...success,
            is_error: !terminalSuccess,
            result: String(input.prompt).replace("Reply exactly with ", ""),
          } as SDKMessage;
        },
      });
      expect(
        await Effect.runPromise(
          probeClaudeAccess(settings, "model", {}, factory).pipe(
            Effect.provide(NodeServices.layer),
          ),
        ),
      ).toBe(expected);
    }
  });

  it("overrides Windows output-cap aliases without modifying the caller environment", () => {
    const env = { claude_code_max_output_tokens: "99999", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "90000" };
    expect(withAccessProbeOutputLimit(env, "win32")).toEqual({
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32",
    });
    expect(env.claude_code_max_output_tokens).toBe("99999");
  });

  it("blocks overlapping and rapid probes without changing turn authentication state", async () => {
    let now = 100_000;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = vi.fn(() =>
      Effect.promise(async () => {
        await pending;
        return "verified" as const;
      }),
    );
    const check = makeClaudeAccessChecker({
      instanceId: ProviderInstanceId.make("claude-exact"),
      probe,
      now: () => now,
    });
    const first = Effect.runPromise(check("model"));
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());
    expect((await Effect.runPromise(check("model"))).status).toBe("busy");
    release();
    expect((await first).status).toBe("verified");
    expect((await Effect.runPromise(check("model"))).status).toBe("busy");
    now += 60_000;
    expect((await Effect.runPromise(check("model"))).status).toBe("verified");
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
