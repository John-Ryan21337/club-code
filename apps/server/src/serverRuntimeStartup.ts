import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_AMBIENT_IMAGE_ASSET,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@cafecode/contracts";
import { stopStartupCpuProfiler } from "@cafecode/shared/startupProfiler";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Context from "effect/Context";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";

import { resolveStaticDir, ServerConfig } from "./config.ts";
import { Keybindings } from "./keybindings.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { ServerClientSettingsService } from "./serverClientSettings.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { ProviderSessionReaper } from "./provider/Services/ProviderSessionReaper.ts";
import { AmbientImageStore } from "./ambientMedia/AmbientImageStore.ts";
import {
  formatHeadlessServeOutput,
  formatHostForUrl,
  isWildcardHost,
  issueHeadlessServeAccessInfo,
} from "./startupAccess.ts";

const CLIENT_SETTINGS_READY_FOR_MAINTENANCE_TIMEOUT = "5 seconds";

export class ServerRuntimeStartupError extends Data.TaggedError("ServerRuntimeStartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ServerRuntimeStartupShape {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly markHttpListening: Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

export class ServerRuntimeStartup extends Context.Service<
  ServerRuntimeStartup,
  ServerRuntimeStartupShape
>()("cafecode/serverRuntimeStartup") {}

interface QueuedCommand {
  readonly run: Effect.Effect<void, never>;
}

type CommandReadinessState = "pending" | "ready" | ServerRuntimeStartupError;

interface CommandGate {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly signalCommandReady: Effect.Effect<void>;
  readonly failCommandReady: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

const settleQueuedCommand = <A, E>(deferred: Deferred.Deferred<A, E>, exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? Deferred.succeed(deferred, exit.value)
    : Deferred.failCause(deferred, exit.cause);

export const makeCommandGate = Effect.gen(function* () {
  const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
  const commandQueue = yield* Queue.unbounded<QueuedCommand>();
  const commandReadinessState = yield* Ref.make<CommandReadinessState>("pending");

  const commandWorker = Effect.forever(
    Queue.take(commandQueue).pipe(Effect.flatMap((command) => command.run)),
  );
  yield* Effect.forkScoped(commandWorker);

  return {
    awaitCommandReady: Deferred.await(commandReady),
    signalCommandReady: Effect.gen(function* () {
      yield* Ref.set(commandReadinessState, "ready");
      yield* Deferred.succeed(commandReady, undefined).pipe(Effect.orDie);
    }),
    failCommandReady: (error) =>
      Effect.gen(function* () {
        yield* Ref.set(commandReadinessState, error);
        yield* Deferred.fail(commandReady, error).pipe(Effect.orDie);
      }),
    enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const readinessState = yield* Ref.get(commandReadinessState);
        if (readinessState === "ready") {
          return yield* effect;
        }
        if (readinessState !== "pending") {
          return yield* readinessState;
        }

        const result = yield* Deferred.make<A, E | ServerRuntimeStartupError>();
        yield* Queue.offer(commandQueue, {
          run: Deferred.await(commandReady).pipe(
            Effect.flatMap(() => effect),
            Effect.exit,
            Effect.flatMap((exit) => settleQueuedCommand(result, exit)),
          ),
        });
        return yield* Deferred.await(result);
      }),
  } satisfies CommandGate;
});

export const getAutoBootstrapDefaultModelSelection = (): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
});

export const resolveWelcomeBase = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
  const projectName = segments[segments.length - 1] ?? "project";

  return {
    cwd: serverConfig.cwd,
    projectName,
  } as const;
});

export const resolveAutoBootstrapWelcomeTargets = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const path = yield* Path.Path;

  let bootstrapProjectId: ProjectId | undefined;
  let bootstrapThreadId: ThreadId | undefined;

  if (serverConfig.autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const existingProject = yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(
        serverConfig.cwd,
      );
      let nextProjectId: ProjectId;
      let nextProjectDefaultModelSelection: ModelSelection;

      if (Option.isNone(existingProject)) {
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        nextProjectId = ProjectId.make(crypto.randomUUID());
        const bootstrapProjectTitle = path.basename(serverConfig.cwd) || "project";
        nextProjectDefaultModelSelection = getAutoBootstrapDefaultModelSelection();
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(crypto.randomUUID()),
          projectId: nextProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: serverConfig.cwd,
          defaultModelSelection: nextProjectDefaultModelSelection,
          createdAt,
        });
      } else {
        nextProjectId = existingProject.value.id;
        nextProjectDefaultModelSelection =
          existingProject.value.defaultModelSelection ?? getAutoBootstrapDefaultModelSelection();
      }

      const existingThreadId =
        yield* projectionReadModelQuery.getFirstActiveThreadIdByProjectId(nextProjectId);
      if (Option.isNone(existingThreadId)) {
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        const createdThreadId = ThreadId.make(crypto.randomUUID());
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(crypto.randomUUID()),
          threadId: createdThreadId,
          projectId: nextProjectId,
          title: "New thread",
          modelSelection: nextProjectDefaultModelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = createdThreadId;
      } else {
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = existingThreadId.value;
      }
    });
  }

  return {
    ...(bootstrapProjectId ? { bootstrapProjectId } : {}),
    ...(bootstrapThreadId ? { bootstrapThreadId } : {}),
  } as const;
});

const resolveStartupBrowserTarget = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const serverAuth = yield* ServerAuth;
  const localUrl = `http://localhost:${serverConfig.port}`;
  const bindUrl =
    serverConfig.host && !isWildcardHost(serverConfig.host)
      ? `http://${formatHostForUrl(serverConfig.host)}:${serverConfig.port}`
      : localUrl;
  const secureLocalUrl =
    serverConfig.httpsEnabled && serverConfig.httpsPort !== undefined
      ? `https://localhost:${serverConfig.httpsPort}`
      : localUrl;
  const secureBindUrl =
    serverConfig.httpsEnabled && serverConfig.httpsPort !== undefined
      ? serverConfig.host && !isWildcardHost(serverConfig.host)
        ? `https://${formatHostForUrl(serverConfig.host)}:${serverConfig.httpsPort}`
        : secureLocalUrl
      : bindUrl;
  const browserBaseTarget =
    serverConfig.mode === "desktop" ? bindUrl : (serverConfig.devUrl?.toString() ?? secureBindUrl);
  return yield* Effect.succeed(serverConfig.mode === "desktop" ? bindUrl : undefined).pipe(
    Effect.flatMap((target) =>
      target ? Effect.succeed(target) : serverAuth.issueStartupPairingUrl(browserBaseTarget),
    ),
  );
});

const maybeOpenBrowser = (target: string) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    if (serverConfig.noBrowser) {
      return;
    }
    const externalLauncher = yield* ExternalLauncher.ExternalLauncher;

    yield* externalLauncher.launchBrowser(target).pipe(
      Effect.catch(() =>
        Effect.logInfo("browser auto-open unavailable", {
          hint: `Open ${target} in your browser.`,
        }),
      ),
    );
  });

const runStartupPhase = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateSpans({ "startup.phase": phase }),
    Effect.withSpan(`server.startup.${phase}`),
  );

const seedDefaultAmbientImage = Effect.fn(function* (clientSettings: ServerClientSettingsService, ambientImages: AmbientImageStore) {
  const settingsReady = yield* clientSettings.ready.pipe(
    Effect.timeoutOption(CLIENT_SETTINGS_READY_FOR_MAINTENANCE_TIMEOUT),
  );
  if (Option.isNone(settingsReady)) {
    yield* Effect.logWarning("ambient image default seed skipped", {
      reason: "client-settings-not-ready",
    });
    return;
  }

  const settings = yield* clientSettings.getSettings;
  if (
    !settings.ambientImageEnabled ||
    settings.ambientImageAsset?.id !== DEFAULT_AMBIENT_IMAGE_ASSET.id
  ) {
    return;
  }

  const alreadyStored = yield* ambientImages
    .resolveStoredImage(DEFAULT_AMBIENT_IMAGE_ASSET.id)
    .pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
  if (alreadyStored) return;

  const staticDir = yield* resolveStaticDir;
  if (staticDir === undefined) {
    yield* Effect.logWarning("ambient default image seed skipped", {
      reason: "static-dir-unavailable",
      id: DEFAULT_AMBIENT_IMAGE_ASSET.id,
    });
    return;
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sourcePath = path.join(staticDir, "ambient-default.gif");
  const sourceExists = yield* fs.exists(sourcePath).pipe(Effect.orElseSucceed(() => false));
  if (!sourceExists) {
    yield* Effect.logWarning("ambient default image seed skipped", {
      reason: "source-missing",
      sourcePath: sourcePath,
      id: DEFAULT_AMBIENT_IMAGE_ASSET.id,
    });
    return;
  }

  const bytes = yield* fs.readFile(sourcePath);
  const seededImage = yield* ambientImages.storeUploadedImage({ bytes });
  if (seededImage.id !== DEFAULT_AMBIENT_IMAGE_ASSET.id) {
    yield* Effect.logWarning("ambient default image seed id mismatch", {
      expectedId: DEFAULT_AMBIENT_IMAGE_ASSET.id,
      actualId: seededImage.id,
    });
    yield* clientSettings.updateSettings({ ambientImageAsset: seededImage });
    return;
  }

  yield* Effect.logInfo("ambient default image seeded", {
    ambientImageId: seededImage.id,
  });
});

export const makeServerRuntimeStartup = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const keybindings = yield* Keybindings;
  const orchestrationReactor = yield* OrchestrationReactor;
  const providerSessionReaper = yield* ProviderSessionReaper;
  const lifecycleEvents = yield* ServerLifecycleEvents;
  const serverSettings = yield* ServerSettingsService;
  const clientSettings = yield* ServerClientSettingsService;
  const ambientImages = yield* AmbientImageStore;
  const serverEnvironment = yield* ServerEnvironment;

  const commandGate = yield* makeCommandGate;
  const httpListening = yield* Deferred.make<void>();
  const reactorScope = yield* Scope.make("sequential");

  yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));

  const startup = Effect.gen(function* () {
    yield* Effect.logDebug("startup phase: starting keybindings runtime");
    yield* runStartupPhase(
      "keybindings.start",
      keybindings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to start keybindings runtime", {
            path: error.configPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("startup phase: starting server settings runtime");
    yield* runStartupPhase(
      "settings.start",
      serverSettings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to start server settings runtime", {
            path: error.settingsPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("startup phase: starting client settings runtime");
    yield* runStartupPhase(
      "client-settings.start",
      clientSettings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to start client settings runtime", {
            path: error.settingsPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* runStartupPhase(
      "ambient-images.orphan-sweep",
      Effect.gen(function* () {
        const settingsReady = yield* clientSettings.ready.pipe(
          Effect.timeoutOption(CLIENT_SETTINGS_READY_FOR_MAINTENANCE_TIMEOUT),
        );
        if (Option.isNone(settingsReady)) {
          yield* Effect.logWarning("ambient image orphan sweep skipped", {
            cause: "client settings did not become ready before the maintenance deadline",
          });
          return;
        }
        const result = yield* ambientImages.sweepUnreferencedImages({
          isReferenced: (id) =>
            clientSettings.getSettings.pipe(
              Effect.map(
                (settings) =>
                  settings.ambientImageAsset?.id === id ||
                  settings.ambientImageCycleAssets.some((asset) => asset.id === id),
              ),
              // Storage cleanup always fails closed when the current settings
              // reference cannot be confirmed.
              Effect.catch(() => Effect.succeed(true)),
            ),
        });
        yield* Effect.logDebug("ambient image orphan sweep complete", result);
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("ambient image orphan sweep failed", {
            cause,
          }),
        ),
      ),
    );

    yield* runStartupPhase(
      "ambient-images.default-seed",
      seedDefaultAmbientImage(clientSettings, ambientImages).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("ambient image default seed failed", {
            cause,
          }),
        ),
      ),
    );

    yield* Effect.logDebug("startup phase: starting orchestration reactors");
    yield* runStartupPhase(
      "reactors.start",
      Effect.gen(function* () {
        yield* orchestrationReactor.start().pipe(Scope.provide(reactorScope));
        yield* providerSessionReaper.start().pipe(Scope.provide(reactorScope));
      }),
    );

    const welcomeBase = yield* resolveWelcomeBase;
    const environment = yield* serverEnvironment.getDescriptor;
    yield* Effect.logDebug("startup phase: preparing welcome payload");
    yield* Effect.logDebug("startup phase: publishing welcome event", {
      environmentId: environment.environmentId,
      cwd: welcomeBase.cwd,
      projectName: welcomeBase.projectName,
    });
    yield* runStartupPhase(
      "welcome.publish",
      lifecycleEvents.publish({
        version: 1,
        type: "welcome",
        payload: {
          environment,
          ...welcomeBase,
        },
      }),
    );

    if (serverConfig.autoBootstrapProjectFromCwd) {
      yield* Effect.forkScoped(
        runStartupPhase(
          "welcome.autobootstrap",
          Effect.gen(function* () {
            const bootstrapTargets = yield* resolveAutoBootstrapWelcomeTargets;
            if (!bootstrapTargets.bootstrapProjectId && !bootstrapTargets.bootstrapThreadId) {
              return;
            }

            yield* Effect.logDebug("startup phase: publishing bootstrapped welcome event", {
              environmentId: environment.environmentId,
              cwd: welcomeBase.cwd,
              projectName: welcomeBase.projectName,
              bootstrapProjectId: bootstrapTargets.bootstrapProjectId,
              bootstrapThreadId: bootstrapTargets.bootstrapThreadId,
            });
            yield* lifecycleEvents.publish({
              version: 1,
              type: "welcome",
              payload: {
                environment,
                ...welcomeBase,
                ...bootstrapTargets,
              },
            });
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("startup auto-bootstrap welcome failed", {
                cause,
              }),
            ),
          ),
        ),
      );
    }
  }).pipe(
    Effect.annotateSpans({
      "server.mode": serverConfig.mode,
      "server.port": serverConfig.port,
      "server.host": serverConfig.host ?? "default",
    }),
    Effect.withSpan("server.startup", { kind: "server", root: true }),
  );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const startupExit = yield* Effect.exit(startup);
      if (Exit.isFailure(startupExit)) {
        const error = new ServerRuntimeStartupError({
          message: "Server runtime startup failed before command readiness.",
          cause: startupExit.cause,
        });
        yield* Effect.logError("server runtime startup failed", { cause: startupExit.cause });
        yield* commandGate.failCommandReady(error);
        return;
      }

      yield* Effect.logDebug("Accepting commands");
      yield* commandGate.signalCommandReady;
      yield* Effect.logDebug("startup phase: waiting for http listener");
      yield* runStartupPhase("http.wait", Deferred.await(httpListening));
      yield* Effect.logDebug("startup phase: publishing ready event");
      yield* runStartupPhase(
        "ready.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "ready",
          payload: {
            at: DateTime.formatIso(yield* DateTime.now),
            environment: yield* serverEnvironment.getDescriptor,
          },
        }),
      );

      if (serverConfig.startupPresentation === "headless") {
        yield* Effect.logDebug("startup phase: headless access info");
        const accessInfo = yield* issueHeadlessServeAccessInfo();
        yield* runStartupPhase(
          "headless.output",
          Console.log(formatHeadlessServeOutput(accessInfo)),
        );
      } else {
        yield* Effect.logDebug("startup phase: browser open check");
        const startupBrowserTarget = yield* resolveStartupBrowserTarget;
        if (serverConfig.mode !== "desktop") {
          yield* Effect.logInfo(
            "Authentication required. Open Club Code using the pairing URL.",
          ).pipe(Effect.annotateLogs({ pairingUrl: startupBrowserTarget }));
        }
        yield* runStartupPhase("browser.open", maybeOpenBrowser(startupBrowserTarget));
      }
      yield* Effect.logDebug("startup phase: complete");
      yield* Effect.promise(() => stopStartupCpuProfiler("server-startup-complete")).pipe(
        Effect.ignore,
      );
    }),
  );

  return {
    awaitCommandReady: commandGate.awaitCommandReady,
    markHttpListening: Deferred.succeed(httpListening, undefined),
    enqueueCommand: commandGate.enqueueCommand,
  } satisfies ServerRuntimeStartupShape;
});

export const ServerRuntimeStartupLive = Layer.effect(
  ServerRuntimeStartup,
  makeServerRuntimeStartup,
);
