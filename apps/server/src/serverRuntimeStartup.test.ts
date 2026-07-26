import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ClientSettingsError,
  DEFAULT_MODEL,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { DEFAULT_CLIENT_SETTINGS, type AmbientImageAsset } from "@cafecode/contracts/settings";

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
  ServerRuntimeStartupError,
  sweepAmbientImagesAfterClientSettingsReady,
} from "./serverRuntimeStartup.ts";

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

it.effect(
  "startup ambient image maintenance preserves referenced assets under the settings lock",
  () =>
    Effect.gen(function* () {
      const referencedAsset = {
        id: `sha256-${"a".repeat(64)}.png`,
        url: `/api/ambient-media/image/sha256-${"a".repeat(64)}.png`,
        mimeType: "image/png",
        width: 32,
        height: 32,
        sizeBytes: 128,
      } as AmbientImageAsset;
      const lockEntries = yield* Ref.make(0);
      const referenceResults = yield* Ref.make<ReadonlyArray<boolean>>([]);

      yield* sweepAmbientImagesAfterClientSettingsReady({
        clientSettings: {
          ready: Effect.void,
          getSettings: Effect.succeed({
            ...DEFAULT_CLIENT_SETTINGS,
            ambientImageAsset: referencedAsset,
          }),
          withExclusiveAccess: (effect) =>
            Ref.update(lockEntries, (count) => count + 1).pipe(Effect.andThen(effect)),
        },
        ambientImages: {
          sweepUnreferencedImages: ({ isReferenced }) =>
            isReferenced(referencedAsset.id).pipe(
              Effect.tap((referenced) =>
                Ref.update(referenceResults, (values) => [...values, referenced]),
              ),
              Effect.as({ eligible: 1, removed: 0 }),
            ),
        },
      });

      assert.equal(yield* Ref.get(lockEntries), 1);
      assert.deepStrictEqual(yield* Ref.get(referenceResults), [true]);
    }),
);

it.effect("startup ambient image maintenance fails closed when references cannot be read", () =>
  Effect.gen(function* () {
    const candidateId = `sha256-${"b".repeat(64)}.gif` as AmbientImageAsset["id"];
    const referenceResults = yield* Ref.make<ReadonlyArray<boolean>>([]);

    yield* sweepAmbientImagesAfterClientSettingsReady({
      clientSettings: {
        ready: Effect.void,
        getSettings: Effect.fail(
          new ClientSettingsError({
            settingsPath: "<test>",
            detail: "settings unavailable",
          }),
        ),
        withExclusiveAccess: (effect) => effect,
      },
      ambientImages: {
        sweepUnreferencedImages: ({ isReferenced }) =>
          isReferenced(candidateId).pipe(
            Effect.tap((referenced) =>
              Ref.update(referenceResults, (values) => [...values, referenced]),
            ),
            Effect.as({ eligible: 1, removed: 0 }),
          ),
      },
    });

    assert.deepStrictEqual(yield* Ref.get(referenceResults), [true]);
  }),
);
