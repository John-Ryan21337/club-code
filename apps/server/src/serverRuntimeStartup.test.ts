import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type AmbientImageAsset,
  CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET,
  DEFAULT_MODEL,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  AmbientImageError,
  AmbientImageStore,
  AmbientImageStoreLive,
  type AmbientImageStoreShape,
} from "./ambientMedia/AmbientImageStore.ts";
import { ServerConfig } from "./config.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  getAutoBootstrapDefaultModelSelection,
  makeCommandGate,
  resolveAutoBootstrapWelcomeTargets,
  resolveWelcomeBase,
  seedDefaultAmbientImage,
  ServerRuntimeStartupError,
} from "./serverRuntimeStartup.ts";
import { ServerClientSettingsService } from "./serverClientSettings.ts";

const alternateAmbientImageId = `sha256-${"a".repeat(64)}.gif` as AmbientImageAsset["id"];
const alternateAmbientImageAsset: AmbientImageAsset = {
  ...CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET,
  id: alternateAmbientImageId,
  url: `/api/ambient-media/image/${alternateAmbientImageId}`,
};

const ambientImageNotFound = () =>
  new AmbientImageError({
    code: "not-found",
    status: 404,
    message: "Ambient image was not found.",
  });

it("uses the canonical Codex default for auto-bootstrapped model selection", () => {
  assert.deepStrictEqual(getAutoBootstrapDefaultModelSelection(), {
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  });
});

it.effect("enqueueCommand waits for readiness and then drains queued work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const executionCount = yield* Ref.make(0);
      const commandGate = yield* makeCommandGate;

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Ref.updateAndGet(executionCount, (count) => count + 1))
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      assert.equal(yield* Ref.get(executionCount), 0);

      yield* commandGate.signalCommandReady;

      const result = yield* Fiber.join(queuedCommandFiber);
      assert.equal(result, 1);
      assert.equal(yield* Ref.get(executionCount), 1);
    }),
  ),
);

it.effect("enqueueCommand fails queued work when readiness fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commandGate = yield* makeCommandGate;
      const failure = yield* Deferred.make<void, never>();

      const queuedCommandFiber = yield* commandGate
        .enqueueCommand(Deferred.await(failure).pipe(Effect.as("should-not-run")))
        .pipe(Effect.forkScoped);

      yield* commandGate.failCommandReady(
        new ServerRuntimeStartupError({
          message: "startup failed",
        }),
      );

      const error = yield* Effect.flip(Fiber.join(queuedCommandFiber));
      assert.equal(error.message, "startup failed");
    }),
  ),
);

it.effect("seeds the bundled first-run ambiance image into the user media store", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const clientSettings = yield* ServerClientSettingsService;
    const ambientImages = yield* AmbientImageStore;
    const staticDir = path.resolve(import.meta.dirname, "../../web/public");

    yield* seedDefaultAmbientImage(clientSettings, ambientImages, staticDir);

    const stored = yield* ambientImages.resolveStoredImage(
      CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET.id,
    );
    const bytes = yield* fs.readFile(stored.filePath);
    const validated = yield* ambientImages.storeUploadedImage({ bytes });

    assert.equal(stored.id, CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET.id);
    assert.equal(stored.mimeType, CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET.mimeType);
    assert.equal(bytes.byteLength, CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET.sizeBytes);
    assert.deepStrictEqual(validated, CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerClientSettingsService.layerTest({
          ambientImageEnabled: true,
          ambientImageAsset: CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET,
        }),
        AmbientImageStoreLive.pipe(
          Layer.provideMerge(
            Layer.fresh(
              ServerConfig.layerTest(process.cwd(), {
                prefix: "club-code-default-ambient-image-test-",
              }),
            ),
          ),
        ),
      ),
    ),
    Effect.provide(NodeServices.layer),
  ),
);

it.effect("does not repoint settings when bundled ambiance metadata is unexpected", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const clientSettings = yield* ServerClientSettingsService;
    const staticDir = path.resolve(import.meta.dirname, "../../web/public");
    const ambientImages: AmbientImageStoreShape = {
      resolveStoredImage: () => Effect.fail(ambientImageNotFound()),
      storeUploadedImage: () => Effect.succeed(alternateAmbientImageAsset),
      removeStoredImage: () => Effect.die("unused"),
      sweepUnreferencedImages: () => Effect.die("unused"),
    };

    yield* seedDefaultAmbientImage(clientSettings, ambientImages, staticDir);

    const settings = yield* clientSettings.getSettings;
    assert.deepStrictEqual(settings.ambientImageAsset, CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET);
  }).pipe(
    Effect.provide(
      ServerClientSettingsService.layerTest({
        ambientImageEnabled: true,
        ambientImageAsset: CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET,
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
);

it.effect("preserves an existing user's selected ambiance image", () =>
  Effect.gen(function* () {
    const clientSettings = yield* ServerClientSettingsService;
    const storeCalls = yield* Ref.make(0);
    const unexpectedStoreCall = <A>() =>
      Ref.update(storeCalls, (count) => count + 1).pipe(
        Effect.flatMap(() => Effect.die("ambient image store must not be called")),
      ) as Effect.Effect<A, never>;
    const ambientImages: AmbientImageStoreShape = {
      resolveStoredImage: () => unexpectedStoreCall(),
      storeUploadedImage: () => unexpectedStoreCall(),
      removeStoredImage: () => unexpectedStoreCall(),
      sweepUnreferencedImages: () => unexpectedStoreCall(),
    };

    yield* seedDefaultAmbientImage(clientSettings, ambientImages, undefined);

    assert.equal(yield* Ref.get(storeCalls), 0);
    assert.deepStrictEqual(
      (yield* clientSettings.getSettings).ambientImageAsset,
      alternateAmbientImageAsset,
    );
  }).pipe(
    Effect.provide(
      ServerClientSettingsService.layerTest({
        ambientImageEnabled: true,
        ambientImageAsset: alternateAmbientImageAsset,
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
);

it.effect("propagates ambient storage failures instead of treating them as a cache miss", () =>
  Effect.gen(function* () {
    const clientSettings = yield* ServerClientSettingsService;
    const storeCalls = yield* Ref.make(0);
    const storageFailure = new AmbientImageError({
      code: "storage-failed",
      status: 500,
      message: "Ambient image storage is unavailable.",
    });
    const ambientImages: AmbientImageStoreShape = {
      resolveStoredImage: () => Effect.fail(storageFailure),
      storeUploadedImage: () =>
        Ref.update(storeCalls, (count) => count + 1).pipe(
          Effect.as(CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET),
        ),
      removeStoredImage: () => Effect.die("unused"),
      sweepUnreferencedImages: () => Effect.die("unused"),
    };

    const result = yield* Effect.exit(
      seedDefaultAmbientImage(clientSettings, ambientImages, undefined),
    );

    assert.equal(result._tag, "Failure");
    assert.equal(yield* Ref.get(storeCalls), 0);
  }).pipe(
    Effect.provide(
      ServerClientSettingsService.layerTest({
        ambientImageEnabled: true,
        ambientImageAsset: CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET,
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
);

it.effect("resolveWelcomeBase derives cwd and project name from server config", () =>
  Effect.gen(function* () {
    const welcome = yield* resolveWelcomeBase.pipe(
      Effect.provideService(ServerConfig, {
        cwd: "/tmp/startup-project",
      } as never),
    );

    assert.deepStrictEqual(welcome, {
      cwd: "/tmp/startup-project",
      projectName: "startup-project",
    });
  }),
);

it.effect("resolveAutoBootstrapWelcomeTargets returns existing project and thread ids", () => {
  const bootstrapProjectId = ProjectId.make("project-startup-bootstrap");
  const bootstrapThreadId = ThreadId.make("thread-startup-bootstrap");

  return Effect.gen(function* () {
    const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);
    const targets = yield* resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provideService(ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery, {
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getDeletedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () =>
          Effect.succeed(
            Option.some({
              id: bootstrapProjectId,
              title: "Startup Project",
              workspaceRoot: "/tmp/startup-project",
              defaultModelSelection: getAutoBootstrapDefaultModelSelection(),
              scripts: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            }),
          ),
        getProjectShellById: () => Effect.die("unused"),
        getProjectWorkspaceRootById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.some(bootstrapThreadId)),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getThreadShellById: () => Effect.die("unused"),
        getPostTerminalStaleSteerCandidateThreadIds: () => Effect.die("unused"),
        getThreadTurnActivityPage: () => Effect.die("unused"),
        getThreadTurnWorkLogPresence: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshotById: () => Effect.die("unused"),
      }),
      Effect.provideService(OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        diagnosticsSnapshot: Effect.succeed({
          commandQueueDepth: 0,
          acceptedCommandCount: 0,
          rejectedCommandCount: 0,
          failedCommandCount: 0,
          commandReadModelSequence: 0,
        }),
        streamDomainEvents: Stream.empty,
      } satisfies OrchestrationEngineShape),
      Effect.provide(NodeServices.layer),
    );

    assert.deepStrictEqual(targets, {
      bootstrapProjectId,
      bootstrapThreadId,
    });
    assert.deepStrictEqual(yield* Ref.get(dispatchCalls), []);
  });
});

it.effect("resolveAutoBootstrapWelcomeTargets creates a project and thread when missing", () =>
  Effect.gen(function* () {
    const dispatchCalls = yield* Ref.make<ReadonlyArray<string>>([]);
    const targets = yield* resolveAutoBootstrapWelcomeTargets.pipe(
      Effect.provideService(ServerConfig, {
        cwd: "/tmp/startup-project",
        autoBootstrapProjectFromCwd: true,
      } as never),
      Effect.provideService(ProjectionSnapshotQuery, {
        getCommandReadModel: () => Effect.die("unused"),
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getArchivedShellSnapshot: () => Effect.die("unused"),
        getDeletedShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
        getProjectShellById: () => Effect.die("unused"),
        getProjectWorkspaceRootById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
        getThreadCheckpointContext: () => Effect.succeed(Option.none()),
        getThreadShellById: () => Effect.die("unused"),
        getPostTerminalStaleSteerCandidateThreadIds: () => Effect.die("unused"),
        getThreadTurnActivityPage: () => Effect.die("unused"),
        getThreadTurnWorkLogPresence: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
        getThreadDetailSnapshotById: () => Effect.die("unused"),
      }),
      Effect.provideService(OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch: (command) =>
          Ref.update(dispatchCalls, (calls) => [...calls, command.type]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        diagnosticsSnapshot: Effect.succeed({
          commandQueueDepth: 0,
          acceptedCommandCount: 0,
          rejectedCommandCount: 0,
          failedCommandCount: 0,
          commandReadModelSequence: 0,
        }),
        streamDomainEvents: Stream.empty,
      } satisfies OrchestrationEngineShape),
      Effect.provide(NodeServices.layer),
    );

    assert.equal(typeof targets.bootstrapProjectId, "string");
    assert.equal(typeof targets.bootstrapThreadId, "string");
    assert.deepStrictEqual(yield* Ref.get(dispatchCalls), ["project.create", "thread.create"]);
  }),
);
