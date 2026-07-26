import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderPacingAdmission } from "../Services/ProviderPacingAdmission.ts";
import type { ProviderPacingAdmissionShape } from "../Services/ProviderPacingAdmission.ts";
import {
  providerPacingSettings,
  ProviderPacingObservationReactorLive,
} from "./ProviderPacingObservationReactor.ts";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("claude-primary"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", email: "user@example.com" },
  checkedAt: "2026-07-26T17:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

type ServerSettingsWithPacing = ServerSettings & {
  readonly drainFirstPacingEnabled: boolean;
  readonly drainFirstPacingMinimumPauseMinutes: number;
};

const settingsWithPacing = (
  enabled: boolean,
  minimumPauseMinutes: number,
): ServerSettingsWithPacing =>
  ({
    ...DEFAULT_SERVER_SETTINGS,
    drainFirstPacingEnabled: enabled,
    drainFirstPacingMinimumPauseMinutes: minimumPauseMinutes,
  }) as ServerSettingsWithPacing;

it.effect("maps the server-authoritative pacing settings", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(providerPacingSettings(settingsWithPacing(true, 23)), {
      enabled: true,
      minimumPauseMinutes: 23,
    });
  }),
);

it.effect("subscribes before startup reads and serializes provider and settings updates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const providerChanges = yield* PubSub.unbounded<ReadonlyArray<ServerProvider>>();
      const settingsChanges = yield* PubSub.unbounded<ServerSettings>();
      const applications: Array<{
        readonly providerCount: number;
        readonly enabled: boolean;
        readonly minimumPauseMinutes: number;
      }> = [];
      const environmentId = EnvironmentId.make("environment-a");

      const dependencies = Layer.mergeAll(
        Layer.mock(ServerEnvironment)({
          getEnvironmentId: Effect.succeed(environmentId),
        }),
        Layer.mock(ProviderRegistry)({
          getProviders: Effect.succeed([provider]),
          streamChanges: Stream.fromPubSub(providerChanges),
        }),
        Layer.mock(ServerSettingsService)({
          ready: Effect.void,
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
          streamChanges: Stream.fromPubSub(settingsChanges),
        }),
        Layer.succeed(ProviderPacingAdmission, {
          applyProviderSnapshots: (input) => {
            applications.push({
              providerCount: input.providers.length,
              enabled: input.settings.enabled,
              minimumPauseMinutes: input.settings.minimumPauseMinutes,
            });
          },
          nextStaleAtMs: () => null,
          invalidateStaleEvidence: () => undefined,
          submitNewLaunch: () => {
            throw new Error("not used");
          },
          adoptActiveWork: () => {
            throw new Error("not used");
          },
          getSnapshot: () => null,
          getKey: () => {
            throw new Error("not used");
          },
          getCounts: () => ({ active: 0, waiting: 0 }),
          dispose: () => undefined,
        } satisfies ProviderPacingAdmissionShape),
      );
      yield* Layer.build(ProviderPacingObservationReactorLive.pipe(Layer.provide(dependencies)));
      assert.deepStrictEqual(applications, [
        {
          providerCount: 1,
          enabled: false,
          minimumPauseMinutes: 0,
        },
      ]);

      yield* PubSub.publish(settingsChanges, settingsWithPacing(true, 17));
      yield* PubSub.publish(providerChanges, []);
      for (let attempt = 0; attempt < 20 && applications.length < 3; attempt += 1) {
        yield* Effect.yieldNow;
      }

      assert.strictEqual(applications.length, 3);
      assert.deepStrictEqual(applications.at(-1), {
        providerCount: 0,
        enabled: true,
        minimumPauseMinutes: 17,
      });
    }),
  ),
);
