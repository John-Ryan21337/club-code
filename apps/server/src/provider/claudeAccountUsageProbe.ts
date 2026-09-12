import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSettings, ServerProvider, ServerProviderAuth } from "@cafecode/contracts";
import { compareSemverVersions, parseSemver } from "@cafecode/shared/semver";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as NodePath from "node:path";
import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";
import { parseClaudeAccountUsage } from "./claudeAccountUsage.ts";
import {
  isClaudeSubscriptionPlanType,
  normalizeClaudeSubscriptionType,
} from "./claudeSubscription.ts";

// This port requires the current CLI generation that supports skipBehaviors.
export const CLAUDE_ACCOUNT_USAGE_MINIMUM_VERSION = "2.1.266";
export const CLAUDE_ACCOUNT_USAGE_TIMEOUT_MS = 12_000;
export function supportsClaudeAccountUsage(
  snapshot: Pick<ServerProvider, "auth" | "version">,
): boolean {
  return (
    snapshot.auth.status === "authenticated" &&
    Boolean(snapshot.auth.email?.trim()) &&
    isClaudeSubscriptionPlanType(snapshot.auth.type) &&
    snapshot.version !== null &&
    parseSemver(snapshot.version) !== null &&
    compareSemverVersions(snapshot.version, CLAUDE_ACCOUNT_USAGE_MINIMUM_VERSION) >= 0
  );
}

type UsageQuery = {
  initializationResult(): Promise<unknown>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(options: {
    skipBehaviors: true;
  }): Promise<unknown>;
  close(): void;
};
export type ClaudeUsageQueryFactory = (input: Parameters<typeof query>[0]) => UsageQuery;
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function accountMatches(expected: ServerProviderAuth, initialization: unknown): boolean {
  const account = record(record(initialization)?.account);
  const email = account?.email;
  const actualPlan =
    typeof account?.subscriptionType === "string"
      ? normalizeClaudeSubscriptionType(account.subscriptionType)
      : undefined;
  const expectedPlan = normalizeClaudeSubscriptionType(expected.type);
  const tokenSource =
    typeof account?.tokenSource === "string"
      ? account.tokenSource.toLowerCase().replace(/[\s_-]+/g, "")
      : "";
  if (["apikey", "anthropicapikey", "anthropicauthtoken"].includes(tokenSource)) return false;
  return (
    expected.status === "authenticated" &&
    Boolean(expected.email?.trim()) &&
    typeof email === "string" &&
    expected.email!.trim().toLowerCase() === email.trim().toLowerCase() &&
    expectedPlan !== undefined &&
    isClaudeSubscriptionPlanType(expectedPlan) &&
    actualPlan === expectedPlan
  );
}
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** Disposable control query: no model turn, tool invocation, or transcript scan. */
export function probeClaudeAccountUsage(
  settings: ClaudeSettings,
  expectedAuth: ServerProviderAuth,
  environment: NodeJS.ProcessEnv,
  queryFactory: ClaudeUsageQueryFactory = query,
) {
  return Effect.suspend(() => {
    const abort = new AbortController();
    let active: UsageQuery | undefined;
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "cafe-claude-usage-" });
      const env = { ...(yield* makeClaudeEnvironment(settings, environment)) };
      // Bind relative search directories before moving the subprocess to an empty cwd.
      for (const key of Object.keys(env)) {
        if (
          (process.platform === "win32" ? key.toUpperCase() : key) === "PATH" &&
          typeof env[key] === "string"
        )
          env[key] = env[key]!.split(NodePath.delimiter)
            .map((entry) => NodePath.resolve(entry))
            .join(NodePath.delimiter);
      }
      const binaryPath = /[\\/]/.test(settings.binaryPath)
        ? NodePath.resolve(settings.binaryPath)
        : settings.binaryPath;
      const raw = yield* Effect.tryPromise(async () => {
        active = queryFactory({
          // oxlint-disable-next-line require-yield
          prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
            await untilAborted(abort.signal);
          })(),
          options: {
            pathToClaudeCodeExecutable: binaryPath,
            env,
            cwd,
            persistSession: false,
            settingSources: ["user"],
            settings: { disableAllHooks: true, autoMemoryEnabled: false },
            tools: [],
            allowedTools: [],
            disallowedTools: ["*"],
            skills: [],
            plugins: [],
            mcpServers: {},
            strictMcpConfig: true,
            permissionMode: "dontAsk",
            canUseTool: async () => ({
              behavior: "deny",
              message: "Tools are disabled for usage checks.",
            }),
            abortController: abort,
            stderr: () => {},
          },
        });
        const initialization = await active.initializationResult();
        if (!accountMatches(expectedAuth, initialization) || abort.signal.aborted) return undefined;
        return active.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true,
        });
      });
      return parseClaudeAccountUsage(raw, DateTime.formatIso(yield* DateTime.now));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          abort.abort();
          try {
            active?.close();
          } catch {
            /* Cleanup must not expose provider output. */
          }
        }),
      ),
      Effect.timeoutOption(CLAUDE_ACCOUNT_USAGE_TIMEOUT_MS),
      Effect.map((result) => (Option.isSome(result) ? result.value : undefined)),
      Effect.scoped,
      Effect.catchCause(() => Effect.succeed(undefined)),
    );
  });
}
