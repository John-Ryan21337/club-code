import type {
  ClaudeSettings,
  ProviderInstanceId,
  ServerProviderAccessResult,
} from "@cafecode/contracts";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";

type AccessStatus = ServerProviderAccessResult["status"];
type ProbeQuery = AsyncIterable<SDKMessage> & { close(): void };
export type ClaudeAccessQueryFactory = (input: Parameters<typeof query>[0]) => ProbeQuery;

/** Classify structured provider fields only. Raw provider output never crosses this boundary. */
function classifyFailure(record: Record<string, unknown>): AccessStatus | undefined {
  const status = record.api_error_status ?? record.error_status;
  if (status === 401 || record.error === "authentication_failed") return "authentication-required";
  if (status === 403 || record.error === "account_on_hold") return "account-restricted";
  if (status === 429 || record.error === "rate_limit") return "rate-limited";
  return undefined;
}

export function classifyClaudeAccessMessage(
  message: unknown,
  expectedResponse: string,
  priorFailure?: AccessStatus,
): AccessStatus | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const record = message as Record<string, unknown>;
  if (record.type !== "result") return undefined;
  const usage = record.usage as { output_tokens?: unknown } | undefined;
  if (record.subtype === "success" && record.is_error === false) {
    return record.result === expectedResponse &&
      typeof usage?.output_tokens === "number" &&
      Number.isFinite(usage.output_tokens) &&
      usage.output_tokens > 0
      ? "verified"
      : "unverified";
  }
  return classifyFailure(record) ?? priorFailure ?? "unverified";
}

export function withAccessProbeOutputLimit(
  environment: NodeJS.ProcessEnv,
  platform = process.platform,
): NodeJS.ProcessEnv {
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if ((platform === "win32" ? key.toUpperCase() : key) === "CLAUDE_CODE_MAX_OUTPUT_TOKENS")
      delete env[key];
  }
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "32";
  return env;
}

export const probeClaudeAccess = (
  settings: ClaudeSettings,
  model: string,
  environment: NodeJS.ProcessEnv,
  queryFactory: ClaudeAccessQueryFactory = query,
  timeoutMs = 30_000,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "cafe-access-check-" });
    const env = yield* makeClaudeEnvironment(settings, environment);
    const expectedResponse = `ACCESS_OK_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const abort = new AbortController();
    let probe: ProbeQuery | undefined;
    return yield* Effect.tryPromise(async () => {
      probe = queryFactory({
        prompt: `Reply exactly with ${expectedResponse}`,
        options: {
          pathToClaudeCodeExecutable: settings.binaryPath,
          env: withAccessProbeOutputLimit(env),
          cwd,
          model,
          systemPrompt: "This is a connection check. Return only the exact text requested.",
          tools: [],
          allowedTools: [],
          disallowedTools: ["*"],
          skills: [],
          mcpServers: {},
          strictMcpConfig: true,
          plugins: [],
          // Preserve user-level authentication helpers, but never load project files or hooks.
          settingSources: ["user"],
          settings: { disableAllHooks: true, autoMemoryEnabled: false },
          permissionMode: "dontAsk",
          canUseTool: async () => ({
            behavior: "deny",
            message: "Tools are disabled for access checks.",
          }),
          persistSession: false,
          maxTurns: 1,
          maxBudgetUsd: 0.1,
          thinking: { type: "disabled" },
          abortController: abort,
          stderr: () => {},
        },
      });
      let messages = 0;
      let priorFailure: AccessStatus | undefined;
      for await (const message of probe) {
        if (++messages > 64) return "unverified" as const;
        const status = classifyClaudeAccessMessage(message, expectedResponse, priorFailure);
        if (status) return status;
        priorFailure =
          classifyFailure(message as unknown as Record<string, unknown>) ?? priorFailure;
      }
      return "unverified" as const;
    }).pipe(
      Effect.timeoutOption(timeoutMs),
      Effect.map(Option.getOrElse((): AccessStatus => "unverified")),
      Effect.catchCause(() => Effect.succeed("unverified" as const)),
      Effect.ensuring(
        Effect.sync(() => {
          abort.abort();
          probe?.close();
        }),
      ),
    );
  }).pipe(
    Effect.scoped,
    Effect.catchCause(() => Effect.succeed("unverified" as const)),
  );

export function makeClaudeAccessChecker(input: {
  instanceId: ProviderInstanceId;
  probe: (model: string) => Effect.Effect<AccessStatus>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  let busy = false;
  let nextAllowedAt = 0;
  return (model: string): Effect.Effect<ServerProviderAccessResult> =>
    Effect.gen(function* () {
      const result = (status: AccessStatus): ServerProviderAccessResult => ({
        instanceId: input.instanceId,
        model,
        status,
        checkedAt: new Date(now()).toISOString(),
      });
      if (busy || now() < nextAllowedAt) return result("busy");
      busy = true;
      return yield* input.probe(model).pipe(
        Effect.map(result),
        Effect.ensuring(
          Effect.sync(() => {
            busy = false;
            nextAllowedAt = now() + 60_000;
          }),
        ),
      );
    });
}
