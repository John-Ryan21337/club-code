/**
 * CodexDriver — first concrete `ProviderDriver` in the new per-instance model.
 *
 * A driver is a plain value (not a Context.Service) whose `create()` returns
 * one `ProviderInstance` bundling:
 *   - `snapshot`   — the live `ServerProviderShape` for this instance;
 *   - `adapter`    — the Codex session/turn/approval runtime;
 *   - `textGeneration` — commit/PR/branch/title generation via `codex exec`.
 *
 * Each call to `create()` captures the `codexConfig` argument in closures
 * owned by the returned instance. Two instances created with different
 * `homePath`s (e.g. `codex_personal` + `codex_work`) therefore run with
 * fully independent Codex app-server processes and `CODEX_HOME`
 * environments — no shared mutable state.
 *
 * Resource lifecycle: `create()` runs in a scope handed in by the registry.
 * Closing that scope releases the adapter's child processes, the managed
 * snapshot's refresh fibre, and the text-generation binaries' transient
 * scratch files. The registry uses this to tear down an instance when its
 * `providerInstances` entry disappears or its config changes.
 *
 * @module provider/Drivers/CodexDriver
 */
import {
  CodexSettings,
  normalizeLmStudioBaseUrl,
  ProviderDriverKind,
  ServerProviderRateLimitResetCreditError,
  type ServerProvider,
  type ServerProviderProbePhaseDiagnostics,
} from "@cafecode/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import { approvedProviderCliVersion } from "@cafecode/shared/providerCompatibility";

import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeCodexAdapter } from "../Layers/CodexAdapter.ts";
import {
  checkCodexCliProviderStatus,
  checkCodexProviderStatus,
  consumeCodexRateLimitResetCredit,
  discoverLmStudioModels,
  isCodexCliLoginStatusProbeInconclusive,
  makePendingCodexProvider,
  readCodexAccountRateLimits,
  reconcileLmStudioModelDiscovery,
} from "../Layers/CodexProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import {
  makeManagedServerProvider,
  type ManagedProviderProbePolicy,
} from "../makeManagedServerProvider.ts";
import type { ProviderDriver, ProviderInstance } from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { installBundledAuditAndRepairSkill } from "../BundledAuditAndRepairSkill.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import { resolveProviderRuntimeEnvironment } from "../managedProviderRuntime.ts";
import {
  codexContinuationIdentity,
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
  type CodexShadowHomeAuthSource,
} from "./CodexHomeLayout.ts";
const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const DRIVER_KIND = ProviderDriverKind.make("codex");
// Periodically refresh installation/authentication truth without using the
// heavy app-server metadata path. Full refreshes are single-flight, while
// prompt-triggered usage updates below use only the redacted HTTP request, so
// neither path creates hidden Codex app-server sessions or repeated CLI probe
// queues.
const PERIODIC_SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

/**
 * Probe admission and transient-failure policy for every Codex instance.
 * Exported so the wiring is directly testable without constructing a live
 * instance (which spawns Codex processes and materializes shadow homes).
 */
export const CODEX_PROBE_POLICY = {
  // ProviderRegistry owns bounded initial admission across every configured
  // provider. Avoid a second unbounded startup fiber here.
  initialRefresh: "external",
  // An isolated bounded `codex login status` timeout is not evidence
  // that an already-authenticated session became unhealthy. Retain
  // known-good state twice, then surface the third consecutive timeout
  // so a persistently wedged CLI remains visible and diagnosable.
  isInconclusiveSnapshot: isCodexCliLoginStatusProbeInconclusive,
  inconclusiveFailureThreshold: 3,
} as const satisfies ManagedProviderProbePolicy;

/**
 * Redemption spawns an app-server and makes one network round trip, so it needs
 * far more headroom than the badge probe — but it must still be bounded, since
 * the operator is waiting on a button.
 */
const RATE_LIMIT_RESET_CREDIT_TIMEOUT_MS = 30_000;
const APPROVED_CODEX_VERSION = approvedProviderCliVersion("codex");
const UPDATE_DEFINITION = {
  provider: DRIVER_KIND,
  npmPackageName: "@openai/codex",
  approvedVersion: APPROVED_CODEX_VERSION,
  homebrewFormula: "codex",
  // `codex update` has no exact-version argument. The standardized detached
  // updater may use it only after proving registry latest equals this pin.
  nativeUpdate: null,
} as const;
const UPDATE = makePackageManagedProviderMaintenanceResolver(UPDATE_DEFINITION);
const DEFAULT_SHADOW_HOME_ROOT = "~/.cafe-code/codex-homes";

/**
 * Services the driver needs to materialize an instance. Surfaced as the
 * driver's `R` so the registry layer aggregates these across every
 * registered driver and the runtime satisfies them once.
 */
export type CodexDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig;

/**
 * Stamp instance identity onto a `ServerProvider` snapshot produced by the
 * driver-kind-only codex helpers. Once `buildServerProvider` in
 * `providerSnapshot.ts` is widened to accept `instanceId`/`driver`, this
 * wrapper disappears.
 */
const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
    readonly authActions: ServerProvider["authActions"] | undefined;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.authActions ? { authActions: input.authActions } : {}),
    continuation: { groupKey: input.continuationGroupKey },
    runtimeCapabilities: {
      ...snapshot.runtimeCapabilities,
      liveSteer: "supported",
      accountUsage:
        snapshot.auth.type === "chatgpt" || snapshot.accountRateLimits
          ? "supported"
          : "unsupported",
      // Reset credits are granted against a ChatGPT account. API-key and OSS
      // instances can report usage but can never hold a redeemable credit.
      accountRateLimitResets: snapshot.auth.type === "chatgpt" ? "supported" : "unsupported",
      threadGoals: "supported",
    },
  });

function sanitizeShadowHomeSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  return sanitized.length > 0 ? sanitized : "codex";
}

export function withDefaultCodexShadowHome(input: {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly config: CodexSettings;
}): CodexSettings {
  if (input.config.homePath.trim().length > 0 || input.config.shadowHomePath.trim().length > 0) {
    return input.config;
  }

  return {
    ...input.config,
    shadowHomePath: `${DEFAULT_SHADOW_HOME_ROOT}/${sanitizeShadowHomeSegment(String(input.instanceId))}`,
  };
}

export function resolveCodexAuthActions(input: {
  readonly ossMode: boolean;
  readonly runtimeSource: CodexSettings["runtimeSource"];
  readonly platform: NodeJS.Platform;
}): ServerProvider["authActions"] | undefined {
  return !input.ossMode && input.runtimeSource === "bundled" && input.platform === "win32"
    ? { login: true }
    : undefined;
}

export function resolveCodexShadowHomeAuthSource(
  config: Pick<CodexSettings, "ossMode" | "homePath" | "shadowHomePath">,
): CodexShadowHomeAuthSource {
  if (config.ossMode) return "none";
  return config.homePath.trim().length === 0 && config.shadowHomePath.trim().length > 0
    ? "shadow"
    : "shared";
}

export function resolveCodexRuntimeEnvironment(
  config: Pick<CodexSettings, "ossMode" | "ossBaseUrl">,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!config.ossMode) return environment;
  return {
    ...environment,
    // Codex's built-in `lmstudio` provider reads this process-scoped
    // override. Keeping it on the per-instance environment avoids mutating
    // process.env and lets loopback and LAN instances coexist safely.
    CODEX_OSS_BASE_URL: normalizeLmStudioBaseUrl(config.ossBaseUrl),
  };
}

export const CodexDriver: ProviderDriver<CodexSettings, CodexDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Codex",
    supportsMultipleInstances: true,
  },
  configSchema: CodexSettings,
  defaultConfig: (): CodexSettings => decodeCodexSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const httpClient = yield* HttpClient.HttpClient;
      const eventLoggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const layoutConfig = withDefaultCodexShadowHome({ instanceId, config });
      const homeLayout = yield* resolveCodexHomeLayout(layoutConfig);
      // Cloud instances either refresh from the shared login or preserve an
      // explicitly configured shadow login. OSS instances need neither and
      // must not receive a copy of unrelated cloud credentials.
      const authSource = resolveCodexShadowHomeAuthSource(config);
      const continuationIdentity = codexContinuationIdentity(homeLayout);
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
        authActions: resolveCodexAuthActions({
          ossMode: layoutConfig.ossMode,
          runtimeSource: layoutConfig.runtimeSource,
          platform: process.platform,
        }),
      });
      if (enabled) {
        yield* Effect.tryPromise({
          try: () => installBundledAuditAndRepairSkill(homeLayout.sharedHomePath),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap((result) =>
            Effect.logInfo("codex.skill.audit-and-repair", {
              instanceId,
              result,
              sharedHomePath: homeLayout.sharedHomePath,
            }),
          ),
          Effect.catch((cause) =>
            Effect.logWarning("codex.skill.audit-and-repair.installFailed", {
              instanceId,
              sharedHomePath: homeLayout.sharedHomePath,
              cause: cause instanceof Error ? cause.message : String(cause),
            }),
          ),
        );
        yield* materializeCodexShadowHome(homeLayout, { authSource }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: DRIVER_KIND,
                instanceId,
                detail: cause.message,
                cause,
              }),
          ),
        );
      }
      yield* Effect.logInfo("codex.home.layout", {
        instanceId,
        mode: homeLayout.mode,
        sharedHomePath: homeLayout.sharedHomePath,
        effectiveHomePath: homeLayout.effectiveHomePath ?? null,
        defaultShadowHomeApplied: layoutConfig !== config,
        authSource,
        sqliteState: homeLayout.mode === "authOverlay" ? "shadow-local" : "direct",
      });
      const runtime = resolveProviderRuntimeEnvironment({
        provider: DRIVER_KIND,
        runtimeSource: layoutConfig.runtimeSource,
        systemBinaryPath: layoutConfig.binaryPath,
        packageMaintenance: UPDATE_DEFINITION,
        baseEnv: processEnv,
      });
      const effectiveConfig = {
        ...layoutConfig,
        enabled,
        binaryPath: runtime.binaryPath,
        homePath: homeLayout.effectiveHomePath ?? "",
      } satisfies CodexSettings;
      const effectiveEnvironment = resolveCodexRuntimeEnvironment(effectiveConfig, runtime.env);
      const maintenanceCapabilities =
        effectiveConfig.runtimeSource === "bundled"
          ? runtime.maintenanceCapabilities
          : yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
              binaryPath: effectiveConfig.binaryPath,
              env: effectiveEnvironment,
            });
      const refreshCodexShadowHome = Effect.tryPromise({
        try: () => installBundledAuditAndRepairSkill(homeLayout.sharedHomePath),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("codex.skill.audit-and-repair.refreshFailed", {
            instanceId,
            sharedHomePath: homeLayout.sharedHomePath,
            cause: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
        Effect.andThen(materializeCodexShadowHome(homeLayout, { authSource })),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      // `makeCodexAdapter` and `makeCodexTextGeneration` have `never` error
      // channels at construction time — their failure modes are all on the
      // per-operation closures they return. No `mapError` wrapper is needed
      // here; the registry only has to worry about snapshot-build and
      // spawner-availability failures surfaced from the status probe below.
      const adapter = yield* makeCodexAdapter(effectiveConfig, {
        instanceId,
        environment: effectiveEnvironment,
        prepareRuntimeHome: refreshCodexShadowHome,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const textGeneration = yield* makeCodexTextGeneration(effectiveConfig, effectiveEnvironment);

      // Build a managed snapshot whose settings never change — mutations come
      // in as instance rebuilds from the registry rather than in-place
      // updates. The snapshot health check intentionally mirrors upstream
      // Codex CLI's cheap `codex --version` + `codex login status` path.
      // Starting `codex app-server` just to draw the provider badge can run
      // model/skill metadata requests and block for long enough to show a
      // false "provider unavailable" warning before the user has sent a
      // message. OSS mode is the exception: its app-server probe verifies that
      // Codex can host the local transport, while LM Studio's `/v1/models`
      // response supplies the exact callable inventory. Both deliberately
      // bypass cloud login/account checks and run concurrently on refresh.
      const checkCodexStatus =
        effectiveConfig.ossMode && effectiveConfig.enabled
          ? Effect.all(
              [
                checkCodexProviderStatus(effectiveConfig, undefined, effectiveEnvironment),
                discoverLmStudioModels(effectiveConfig.ossBaseUrl, httpClient),
              ],
              { concurrency: "unbounded" },
            ).pipe(
              Effect.map(([provider, discovery]) =>
                reconcileLmStudioModelDiscovery(provider, discovery),
              ),
            )
          : effectiveConfig.ossMode
            ? checkCodexProviderStatus(effectiveConfig, undefined, effectiveEnvironment)
            : checkCodexCliProviderStatus(effectiveConfig, effectiveEnvironment);
      const checkProvider = Effect.gen(function* () {
        const prepareStartedAtMs = yield* Clock.currentTimeMillis;
        let prepareOutcome: ServerProviderProbePhaseDiagnostics["outcome"] = "success";
        yield* refreshCodexShadowHome.pipe(
          Effect.catch((cause) => {
            prepareOutcome = "error";
            return Effect.logWarning("codex.home.authRefreshBeforeStatusFailed", {
              instanceId,
              detail: cause.message,
            });
          }),
        );
        const prepareFinishedAtMs = yield* Clock.currentTimeMillis;
        const checked = yield* checkCodexStatus;
        return stampIdentity({
          ...checked,
          probePhases: [
            {
              phase: "prepare-runtime-home",
              outcome: prepareOutcome,
              durationMs: Math.max(0, Math.floor(prepareFinishedAtMs - prepareStartedAtMs)),
            },
            ...(checked.probePhases ?? []),
          ],
        });
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      const snapshot = yield* makeManagedServerProvider<CodexSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          makePendingCodexProvider(settings).pipe(Effect.map(stampIdentity)),
        checkProvider,
        // Prompt sends need fresh rate-limit metadata, not another pair of
        // `codex --version` / `codex login status` subprocesses. Upstream
        // Codex obtains this data from BackendClient's account usage request;
        // use the same bounded, redacted HTTP path against the effective
        // shadow home and leave full health/auth checks on the five-minute and
        // explicit manual-refresh paths.
        refreshAccountUsage: ({ settings, snapshot }) => {
          if (snapshot.auth.status !== "authenticated" || snapshot.auth.type !== "chatgpt") {
            return Effect.succeed(undefined);
          }
          return refreshCodexShadowHome.pipe(
            Effect.catch((cause) =>
              Effect.logWarning("codex.home.authRefreshBeforeUsageFailed", {
                instanceId,
                detail: cause.message,
              }),
            ),
            Effect.andThen(DateTime.now),
            Effect.map(DateTime.formatIso),
            Effect.flatMap((checkedAt) =>
              readCodexAccountRateLimits(settings, effectiveEnvironment, checkedAt),
            ),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          );
        },
        // Redeeming a reset credit is an irreversible account mutation, so it
        // takes the versioned app-server request rather than the badge's
        // lightweight HTTP read — see `consumeCodexRateLimitResetCredit`. The
        // operator-initiated RPC is the only caller.
        consumeRateLimitResetCredit: ({ settings, snapshot, attemptId, creditId }) => {
          if (
            settings.ossMode ||
            snapshot.auth.status !== "authenticated" ||
            snapshot.auth.type !== "chatgpt"
          ) {
            return Effect.fail(
              new ServerProviderRateLimitResetCreditError({
                instanceId,
                reason: "Codex must be signed in with ChatGPT to redeem a usage limit reset.",
              }),
            );
          }
          return refreshCodexShadowHome.pipe(
            Effect.catch((cause) =>
              Effect.logWarning("codex.home.authRefreshBeforeResetCreditFailed", {
                instanceId,
                detail: cause.message,
              }),
            ),
            Effect.andThen(
              consumeCodexRateLimitResetCredit({
                binaryPath: settings.binaryPath,
                ...(settings.homePath ? { homePath: settings.homePath } : {}),
                cwd: process.cwd(),
                attemptId,
                ...(creditId !== undefined ? { creditId } : {}),
                environment: effectiveEnvironment,
              }),
            ),
            Effect.scoped,
            Effect.timeoutOption(Duration.millis(RATE_LIMIT_RESET_CREDIT_TIMEOUT_MS)),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
            Effect.flatMap((outcome) =>
              // A timeout is genuinely ambiguous: codex may have redeemed
              // before we stopped waiting. Never report success, and never
              // imply the credit is safe — the refreshed balance decides.
              Option.isSome(outcome)
                ? Effect.succeed(outcome.value)
                : Effect.fail(
                    new ServerProviderRateLimitResetCreditError({
                      instanceId,
                      reason:
                        "Codex did not answer the usage limit reset in time. Refresh usage to see whether the credit was spent.",
                    }),
                  ),
            ),
            Effect.catch((cause) =>
              cause instanceof ServerProviderRateLimitResetCreditError
                ? Effect.fail(cause)
                : Effect.fail(
                    new ServerProviderRateLimitResetCreditError({
                      instanceId,
                      reason: `Codex rejected the usage limit reset: ${cause.message}`,
                      cause,
                    }),
                  ),
            ),
          );
        },
        enrichSnapshot: ({ snapshot, publishSnapshot }) =>
          enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
          ),
        refreshInterval: PERIODIC_SNAPSHOT_REFRESH_INTERVAL,
        probePolicy: CODEX_PROBE_POLICY,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Codex snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
