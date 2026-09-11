#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalConsole:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalTimers:off
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProviderInvocation,
  resolvePathCommand,
  type CommandInvocation,
} from "./provider-conformity.ts";
import { resolveWindowsSystemExecutable } from "./windows-system-path.ts";

export type AccessStatus =
  | "verified"
  | "authentication-required"
  | "account-restricted"
  | "rate-limited"
  | "unverified";
export interface AccessSelection {
  readonly provider: "claude" | "codex";
  readonly model: string;
  readonly binary?: string;
  readonly home?: string;
}
export interface AccessResult {
  readonly provider: AccessSelection["provider"];
  readonly model: string;
  readonly status: AccessStatus;
  readonly reason: string;
  readonly startedAt: string;
  readonly checkedAt: string;
  readonly executable: string | null;
  readonly homeSource: "override" | "inherited";
}
export interface ProbeOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly failure?: "timeout" | "output-limit" | "spawn-failed" | "interrupted";
}
export interface ProbeInput {
  readonly invocation: CommandInvocation;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}
const MAX_OUTPUT_BYTES = 128 * 1_024;
const HELP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;

export function parseAccessSelections(args: readonly string[]): AccessSelection[] {
  const values = new Map<string, string>();
  const flags = new Set([
    "--claude-model",
    "--codex-model",
    "--claude-binary",
    "--codex-binary",
    "--claude-home",
    "--codex-home",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !key ||
      !flags.has(key) ||
      values.has(key) ||
      !value ||
      value.startsWith("--") ||
      [...value].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    ) {
      throw new Error("Select models with unique model, binary, and home options.");
    }
    values.set(key, value);
  }
  const selections: AccessSelection[] = [];
  for (const provider of ["claude", "codex"] as const) {
    const model = values.get(`--${provider}-model`);
    const binary = values.get(`--${provider}-binary`);
    const home = values.get(`--${provider}-home`);
    if (!model) {
      if (binary || home) throw new Error("Binary and home options require a model selection.");
      continue;
    }
    if (
      !/^[a-z0-9][a-z0-9._:/-]{0,127}$/iu.test(model) ||
      /^(?:sk-|ghp_|github_pat_)/iu.test(model)
    )
      throw new Error("Invalid model identifier.");
    if ((binary && !isAbsolute(binary)) || (home && !isAbsolute(home)))
      throw new Error("Binary and home overrides must be absolute paths.");
    selections.push({ provider, model, ...(binary ? { binary } : {}), ...(home ? { home } : {}) });
  }
  if (selections.length === 0) throw new Error("Select at least one provider model.");
  return selections;
}

export function accessEnvironment(
  selection: AccessSelection,
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  const overrides: Record<string, string> = {};
  if (selection.home) {
    const key = selection.provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
    overrides[key] = selection.home;
  }
  if (selection.provider === "claude") overrides.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "32";
  for (const [key, value] of Object.entries(overrides)) {
    for (const existing of Object.keys(env))
      if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
    env[key] = value;
  }
  return env;
}

async function terminateProbeTree(child: ChildProcess, env: NodeJS.ProcessEnv): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      await new Promise<void>((resolve) => {
        const killer = spawn(
          resolveWindowsSystemExecutable("taskkill.exe", env),
          ["/PID", String(child.pid), "/T", "/F"],
          { shell: false, windowsHide: true, stdio: "ignore" },
        );
        const timer = setTimeout(() => {
          killer.kill();
          resolve();
        }, 3_000);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        killer.once("error", done);
        killer.once("close", done);
      });
    } catch {
      /* Always attempt the direct child as a fallback. */
    }
    child.kill();
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

// Output stays in bounded memory and is never included in public results or errors.
export async function runAccessProbe(input: ProbeInput): Promise<ProbeOutput> {
  return await new Promise((resolve) => {
    const [executable, ...args] = input.invocation.argv;
    if (!executable) {
      resolve({ stdout: "", stderr: "", exitCode: null, failure: "spawn-failed" });
      return;
    }
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    let size = 0;
    let settled = false;
    let stopping = false;
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        windowsVerbatimArguments: input.invocation.windowsVerbatimArguments ?? false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({ stdout: "", stderr: "", exitCode: null, failure: "spawn-failed" });
      return;
    }
    const finish = (exitCode: number | null, failure?: ProbeOutput["failure"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("SIGINT", interrupted);
      process.off("SIGTERM", interrupted);
      resolve({
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        exitCode,
        ...(failure ? { failure } : {}),
      });
    };
    const stop = (failure: NonNullable<ProbeOutput["failure"]>) => {
      if (stopping || settled) return;
      stopping = true;
      void terminateProbeTree(child, input.env).finally(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(null, failure);
      });
    };
    const interrupted = () => stop("interrupted");
    const timer = setTimeout(() => stop("timeout"), input.timeoutMs);
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream]?.on("data", (chunk: Buffer) => {
        if (stopping || settled) return;
        if (size + chunk.length > MAX_OUTPUT_BYTES) {
          stop("output-limit");
          return;
        }
        chunks[stream].push(Buffer.from(chunk));
        size += chunk.length;
      });
    }
    child.once("error", () => {
      if (!stopping) finish(null, "spawn-failed");
    });
    child.once("close", (code) => {
      if (!stopping) finish(code);
    });
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function failureStatus(detail: string): AccessStatus {
  if (
    /\b(?:401|unauthorized|authentication_error|invalid_api_key)\b|oauth.*(?:expired|refresh)|not logged in|failed to authenticate|please (?:log|sign) in/iu.test(
      detail,
    )
  )
    return "authentication-required";
  if (
    /\b(?:403|permission_denied|access_denied)\b|account.*(?:disabled|suspended)|(?:model|subscription|plan).*(?:not supported|not available|access denied)|insufficient_quota|credit balance/iu.test(
      detail,
    )
  )
    return "account-restricted";
  if (
    /\b(?:429|rate_limit_error|rate_limit_exceeded)\b|rate limit|usage limit|too many requests/iu.test(
      detail,
    )
  )
    return "rate-limited";
  return "unverified";
}

export function classifyAccessOutput(
  provider: AccessSelection["provider"],
  output: ProbeOutput,
  expected: string,
): { status: AccessStatus; reason: string } {
  if (provider === "codex") return { status: "unverified", reason: "tool-isolation-unavailable" };
  if (output.failure) return { status: "unverified", reason: output.failure };
  let events: Record<string, unknown>[];
  try {
    events = output.stdout
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .map((line) => {
        const item = record(JSON.parse(line));
        if (!item) throw new Error();
        return item;
      });
  } catch {
    return { status: "unverified", reason: "invalid-structured-output" };
  }
  if (provider === "claude") {
    const terminals = events.filter((event) => event.type === "result");
    const terminal = terminals.length === 1 ? terminals[0] : undefined;
    if (!terminal) return { status: "unverified", reason: "missing-terminal-result" };
    if (terminal.is_error === true || terminal.subtype !== "success") {
      const detail = [terminal.result, ...(Array.isArray(terminal.errors) ? terminal.errors : [])]
        .filter((value) => typeof value === "string")
        .join("\n");
      return { status: failureStatus(detail), reason: "provider-rejected-request" };
    }
    const toolUse = events.some((event) => {
      const message = record(event.message);
      return (
        Array.isArray(message?.content) &&
        message.content.some((item) => record(item)?.type === "tool_use")
      );
    });
    if (
      output.exitCode === 0 &&
      terminal.is_error === false &&
      terminal.result === expected &&
      !toolUse &&
      events.at(-1) === terminal
    )
      return { status: "verified", reason: "live-response-confirmed" };
  }
  return { status: "unverified", reason: "response-not-confirmed" };
}

export function buildAccessArgs(selection: AccessSelection, expected: string): string[] {
  if (selection.provider !== "claude") throw new Error("Tool isolation is unavailable.");
  const prompt = `Reply with exactly ${expected}. Do not use tools or read files.`;
  return [
    "--print",
    "--safe-mode",
    "--tools",
    "",
    "--strict-mcp-config",
    "--disallowedTools",
    "*",
    "--no-session-persistence",
    "--max-turns",
    "1",
    "--max-budget-usd",
    "0.1",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    selection.model,
    "--",
    prompt,
  ];
}

export async function checkProviderAccess(
  selection: AccessSelection,
  dependencies: { env?: NodeJS.ProcessEnv; run?: typeof runAccessProbe } = {},
): Promise<AccessResult> {
  const startedAt = new Date().toISOString();
  const env = accessEnvironment(selection, dependencies.env ?? process.env);
  const run = dependencies.run ?? runAccessProbe;
  const binary = selection.binary ?? resolvePathCommand(selection.provider, env);
  const result = (status: AccessStatus, reason: string): AccessResult => ({
    provider: selection.provider,
    model: selection.model,
    status,
    reason,
    startedAt,
    checkedAt: new Date().toISOString(),
    executable: binary ? basename(binary) : null,
    homeSource: selection.home ? "override" : "inherited",
  });
  if (!binary) return result("unverified", "executable-not-found");
  let cwd: string | undefined;
  const temporaryParent = realpathSync(tmpdir());
  const probe = async (): Promise<AccessResult> => {
    cwd = await mkdtemp(join(temporaryParent, "provider-access-"));
    const invoke = (args: readonly string[], timeoutMs: number) =>
      run({ invocation: buildProviderInvocation(binary, args), cwd: cwd!, env, timeoutMs });
    const help = await invoke(
      selection.provider === "claude" ? ["--help"] : ["exec", "--help"],
      HELP_TIMEOUT_MS,
    );
    const required =
      selection.provider === "claude"
        ? [
            "--safe-mode",
            "--tools",
            "--strict-mcp-config",
            "--disallowedTools",
            "--no-session-persistence",
            "--max-budget-usd",
            "--output-format",
          ]
        : ["--ephemeral", "--json"];
    if (
      help.failure ||
      help.exitCode !== 0 ||
      !required.every((flag) => help.stdout.includes(flag))
    )
      return result("unverified", "required-cli-controls-unavailable");
    // Codex's CLI does not yet provide an equivalent documented empty-tool switch.
    if (selection.provider === "codex") return result("unverified", "tool-isolation-unavailable");
    const expected = `ACCESS_OK_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const output = await invoke(buildAccessArgs(selection, expected), REQUEST_TIMEOUT_MS);
    const classified = classifyAccessOutput(selection.provider, output, expected);
    return result(classified.status, classified.reason);
  };
  const outcome = await probe().catch(() => result("unverified", "probe-could-not-complete"));
  if (cwd) {
    try {
      const resolved = realpathSync(cwd);
      const childName = relative(temporaryParent, resolved);
      if (!childName.startsWith("provider-access-") || basename(childName) !== childName)
        throw new Error("Unexpected temporary directory.");
      await rm(resolved, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      return result("unverified", "temporary-cleanup-failed");
    }
  }
  return outcome;
}

export async function accessPreflightMain(
  args: readonly string[],
  check = checkProviderAccess,
): Promise<number> {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log(
      "Usage: yarn providers:check-access [--claude-model <model>] [--codex-model <model>] [--claude-binary <absolute-path>] [--claude-home <absolute-path>] [--codex-binary <absolute-path>] [--codex-home <absolute-path>]. Select at least one model. Codex remains unverified until tool isolation is supported.",
    );
    return 0;
  }
  try {
    const selections = parseAccessSelections(args);
    const results: AccessResult[] = [];
    for (const selection of selections) {
      const outcome = await check(selection);
      results.push(outcome);
      if (outcome.reason === "interrupted") break;
    }
    const verified = results.every((entry) => entry.status === "verified");
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        context: "external-cli",
        checkedAt: new Date().toISOString(),
        verified,
        results,
      }),
    );
    return verified ? 0 : 1;
  } catch {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        context: "external-cli",
        checkedAt: new Date().toISOString(),
        verified: false,
        status: "unverified",
        reason: "invalid-options",
      }),
    );
    return 1;
  }
}

function isMain(): boolean {
  try {
    return Boolean(
      process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)),
    );
  } catch {
    return false;
  }
}
if (isMain()) {
  process.exitCode = await accessPreflightMain(process.argv.slice(2));
}
