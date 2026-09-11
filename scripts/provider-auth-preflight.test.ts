import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accessEnvironment,
  accessPreflightMain,
  buildAccessArgs,
  checkProviderAccess,
  classifyAccessOutput,
  parseAccessSelections,
  runAccessProbe,
  type ProbeInput,
  type ProbeOutput,
  type AccessResult,
} from "./provider-auth-preflight.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const expected = "ACCESS_OK_synthetic_fixture";
const output = (events: unknown[], exitCode = 0): ProbeOutput => ({
  stdout: events.map((event) => JSON.stringify(event)).join("\n"),
  stderr: "",
  exitCode,
});
const success = { type: "result", subtype: "success", is_error: false, result: expected };
const binary = join(tmpdir(), "fixture-provider.exe");

describe("external CLI access preflight", () => {
  it("requires explicit models, unique known options, and absolute overrides", () => {
    expect(
      parseAccessSelections([
        "--claude-model",
        "claude-opus-5",
        "--claude-binary",
        binary,
        "--codex-model",
        "gpt-fixture",
      ]),
    ).toEqual([
      { provider: "claude", model: "claude-opus-5", binary },
      { provider: "codex", model: "gpt-fixture" },
    ]);
    for (const args of [
      [],
      ["--claude-home", tmpdir()],
      ["--claude-model"],
      ["--claude-model", "a", "--claude-model", "b"],
      ["--claude-model", "a", "--unknown", "b"],
      ["--claude-model", "a", "--claude-binary", "relative"],
      ["--claude-model", "a\nsecret"],
      ["--claude-model", "sk-fixture"],
    ])
      expect(() => parseAccessSelections(args)).toThrow();
  });

  it("preserves inherited auth routing with an explicit home override and a bounded output cap", () => {
    const env = {
      ANTHROPIC_API_KEY: "synthetic-value",
      ANTHROPIC_BASE_URL: "https://fixture.invalid",
      PATH: "fixture-path",
      HOME: "fixture-user-home",
      CLAUDE_CONFIG_DIR: "old",
      claude_config_dir: "old",
      CODEX_HOME: "codex-home",
    };
    expect(accessEnvironment({ provider: "codex", model: "fixture" }, env)).toEqual(env);
    expect(
      accessEnvironment(
        { provider: "claude", model: "fixture" },
        { ...env, claude_code_max_output_tokens: "99999" },
      ),
    ).toEqual({ ...env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32" });
    expect(
      accessEnvironment({ provider: "claude", model: "fixture", home: "selected" }, env),
    ).toEqual({
      ANTHROPIC_API_KEY: "synthetic-value",
      ANTHROPIC_BASE_URL: "https://fixture.invalid",
      PATH: "fixture-path",
      HOME: "fixture-user-home",
      CLAUDE_CONFIG_DIR: "selected",
      CODEX_HOME: "codex-home",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32",
    });
    expect(env.CLAUDE_CONFIG_DIR).toBe("old");
  });

  it("uses Claude safe mode without bare mode or session persistence", () => {
    const args = buildAccessArgs({ provider: "claude", model: "claude-opus-5" }, expected);
    expect(args).toContain("--safe-mode");
    expect(args).not.toContain("--bare");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5");
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe("*");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("1");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("0.1");
    expect(() => buildAccessArgs({ provider: "codex", model: "fixture" }, expected)).toThrow();
  });

  it("requires terminal success, an exact live challenge response, and successful process completion", () => {
    expect(classifyAccessOutput("claude", output([success]), expected).status).toBe("verified");
    for (const candidate of [
      output([], 0),
      output([{ type: "system", subtype: "init" }]),
      output([success], 1),
      output([{ ...success, result: "" }]),
      output([{ ...success, result: "another response" }]),
      output([{ ...success, is_error: undefined }]),
      output([success, success]),
      output([success, { type: "error" }]),
      { ...output([success]), failure: "output-limit" as const },
      { stdout: "not json", stderr: "", exitCode: 0 },
    ])
      expect(classifyAccessOutput("claude", candidate, expected).status).toBe("unverified");
    const withTool = output([
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } },
      success,
    ]);
    expect(classifyAccessOutput("claude", withTool, expected).status).toBe("unverified");
  });

  it.each([
    [
      "Failed to authenticate: OAuth session expired and could not be refreshed",
      "authentication-required",
    ],
    ["401 authentication_error", "authentication-required"],
    ["403 permission_denied", "account-restricted"],
    ["The model is not available for this subscription", "account-restricted"],
    ["429 rate_limit_error", "rate-limited"],
    ["API Error: 401", "authentication-required"],
    ["HTTP status 403", "account-restricted"],
    ["HTTP/1.1 401", "authentication-required"],
    ["status code: 429", "rate-limited"],
    ["Request failed; trace reference 429", "unverified"],
    ["Request failed; reference numbers 401 and 403", "unverified"],
    ["429 rate_limit_exceeded: please sign in again to refresh oauth", "unverified"],
    ["HTTP 401; HTTP 429", "unverified"],
    ["Network connection failed", "unverified"],
  ])("classifies an actual failed terminal result: %s", (message, status) => {
    expect(
      classifyAccessOutput(
        "claude",
        output([{ ...success, is_error: true, result: message }]),
        expected,
      ),
    ).toEqual({ status, reason: "provider-rejected-request" });
  });

  it("does not turn incidental rate-limit text into a failed access check", () => {
    const candidate = {
      ...output([{ type: "system", message: "rate limit warning" }, success]),
      stderr: "usage limit and 429 appeared in a help example",
    };
    expect(classifyAccessOutput("claude", candidate, expected).status).toBe("verified");
    expect(
      classifyAccessOutput("claude", output([{ ...success, result: "rate limit" }]), expected)
        .status,
    ).toBe("unverified");
  });

  it("rejects an empty challenge even when a successful terminal result is also empty", () => {
    expect(classifyAccessOutput("claude", output([{ ...success, result: "" }]), "")).toEqual({
      status: "unverified",
      reason: "invalid-expected-token",
    });
    expect(classifyAccessOutput("claude", output([{ ...success, result: " " }]), " ").status).toBe(
      "unverified",
    );
  });

  it("keeps Codex unverified without starting a live request that cannot disable every tool", async () => {
    const run = vi.fn(
      async (): Promise<ProbeOutput> => ({ stdout: "--ephemeral --json", stderr: "", exitCode: 0 }),
    );
    const result = await checkProviderAccess(
      { provider: "codex", model: "gpt-fixture", binary },
      { run },
    );
    expect(result.status).toBe("unverified");
    expect(result.reason).toBe("tool-isolation-unavailable");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toBeDefined();
  });

  it("checks exact binary and environment in an isolated directory and removes the directory", async () => {
    const calls: ProbeInput[] = [];
    const env = { ...process.env, SYNTHETIC_PREFLIGHT_MARKER: "must-stay-in-child" };
    const run = vi.fn(async (input: ProbeInput): Promise<ProbeOutput> => {
      calls.push(input);
      if (calls.length === 1)
        return {
          stdout:
            "--safe-mode --tools --strict-mcp-config --disallowedTools --no-session-persistence --max-budget-usd --output-format",
          stderr: "",
          exitCode: 0,
        };
      const prompt = input.invocation.argv.at(-1)!;
      const nonce = /ACCESS_OK_[a-f0-9]+/u.exec(prompt)?.[0];
      return output([{ ...success, result: nonce }]);
    });
    const result = await checkProviderAccess(
      { provider: "claude", model: "claude-opus-5", binary, home: tmpdir() },
      { run, env },
    );
    expect(result.status).toBe("verified");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.invocation.argv[0]).toBe(binary);
      expect(call.env).toEqual({
        ...env,
        CLAUDE_CONFIG_DIR: tmpdir(),
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32",
      });
      expect(call.cwd).not.toBe(process.cwd());
      expect(call.timeoutMs).toBeGreaterThan(0);
    }
    await expect(access(calls[0]!.cwd)).rejects.toThrow();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("must-stay-in-child");
    expect(serialized).not.toContain(calls[0]!.cwd);
    expect(serialized).not.toContain("ACCESS_OK_");
    expect(Date.parse(result.checkedAt)).toBeGreaterThanOrEqual(Date.parse(result.startedAt));
  });

  it("never attempts a live request when help cannot establish the safety controls", async () => {
    const run = vi.fn(
      async (): Promise<ProbeOutput> => ({
        stdout: "--bare --tools",
        stderr: "synthetic private error",
        exitCode: 0,
      }),
    );
    const result = await checkProviderAccess(
      { provider: "claude", model: "fixture", binary },
      { run },
    );
    expect(result.reason).toBe("required-cli-controls-unavailable");
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("synthetic private error");
  });

  it("fails the command unless every selected provider passes and sanitizes invalid options", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const check = vi.fn<typeof checkProviderAccess>(
      async (selection): Promise<AccessResult> => ({
        ...selection,
        startedAt: "2026-01-01T00:00:00Z",
        checkedAt: "2026-01-01T00:00:01Z",
        executable: null,
        homeSource: "inherited",
        status: selection.provider === "claude" ? "verified" : "unverified",
        reason: "fixture",
      }),
    );
    expect(await accessPreflightMain(["--claude-model", "fixture"], check)).toBe(0);
    expect(
      await accessPreflightMain(["--claude-model", "fixture", "--codex-model", "fixture"], check),
    ).toBe(1);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).results).toHaveLength(2);
    expect(await accessPreflightMain(["--unknown-secret-fixture"], check)).toBe(1);
    expect(String(log.mock.calls.at(-1)?.[0])).not.toContain("unknown-secret-fixture");
  });
});

function childFixture(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid: 12345678,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as unknown as ChildProcess;
}

describe("bounded access subprocess", () => {
  const input: ProbeInput = {
    invocation: { argv: [binary, "--help"] },
    cwd: tmpdir(),
    env: { FIXTURE_AUTH: "preserved" },
    timeoutMs: 100,
  };
  it("closes stdin, preserves environment, disables the shell, and waits for close to drain output", async () => {
    const child = childFixture();
    vi.mocked(spawn).mockReturnValue(child);
    const result = runAccessProbe(input);
    expect(spawn).toHaveBeenCalledWith(
      binary,
      ["--help"],
      expect.objectContaining({
        env: input.env,
        cwd: input.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    child.emit("exit", 0);
    child.stdout!.emit("data", Buffer.from("late output"));
    child.emit("close", 0);
    expect(await result).toEqual({ stdout: "late output", stderr: "", exitCode: 0 });
  });

  it.each(["timeout", "output-limit"] as const)(
    "fails closed and reaps the process tree on %s",
    async (failure) => {
      vi.useFakeTimers();
      const child = childFixture();
      const killer = childFixture();
      vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValue(killer);
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      const result = runAccessProbe(input);
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(100);
      else child.stdout!.emit("data", Buffer.alloc(128 * 1_024 + 1));
      if (process.platform === "win32") {
        expect(spawn).toHaveBeenLastCalledWith(
          expect.stringMatching(/taskkill\.exe$/u),
          ["/PID", "12345678", "/T", "/F"],
          expect.objectContaining({ stdio: "ignore", shell: false }),
        );
        killer.emit("close", 0);
      } else expect(kill).toHaveBeenCalledWith(-12345678, "SIGKILL");
      expect(await result).toMatchObject({ exitCode: null, failure });
    },
  );
});
