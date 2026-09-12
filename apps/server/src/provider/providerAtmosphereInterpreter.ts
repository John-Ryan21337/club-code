import type {
  ServerAtmosphereInterpretInput,
  ServerAtmosphereInterpretResult,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService, redactServerSettingsForClient } from "../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "./Layers/ProviderInstanceRegistryHydration.ts";
import { ProviderInstanceRegistry } from "./Services/ProviderInstanceRegistry.ts";

export const interpretProviderAtmosphere = Effect.fn("interpretProviderAtmosphere")(function* (
  input: ServerAtmosphereInterpretInput,
) {
  const result = (
    status: ServerAtmosphereInterpretResult["status"],
    proposal?: string,
  ): ServerAtmosphereInterpretResult => ({
    instanceId: input.instanceId,
    model: input.model,
    status,
    ...(proposal === undefined ? {} : { proposal }),
  });
  const registry = yield* ProviderInstanceRegistry;
  const settings = yield* ServerSettingsService;
  const server = yield* ServerConfig;
  if (!server.ambientExperienceCapabilities.atmosphere) return result("unavailable");
  const saved = yield* settings.getSettings.pipe(Effect.option);
  if (Option.isNone(saved)) return result("unavailable");
  const config = deriveProviderInstanceConfigMap(saved.value)[input.instanceId];
  if (!config) return result("stale");
  const displayedConfig = deriveProviderInstanceConfigMap(
    redactServerSettingsForClient(saved.value),
  )[input.instanceId];
  if (!Equal.equals(displayedConfig, input.expectedConfig)) return result("stale");
  const instance = yield* registry.getInstance(input.instanceId, config);
  if (!instance?.enabled) return result("stale");
  if (!instance.interpretAtmosphere || instance.driverKind !== "claudeAgent")
    return result("unsupported");
  const before = yield* instance.snapshot.getSnapshot;
  if (
    !before.installed ||
    before.auth.status === "unauthenticated" ||
    !Equal.equals(before.auth, input.expectedAuth) ||
    !before.models.some((model) => model.slug === input.model)
  )
    return result("stale");
  const stillCurrent = Effect.gen(function* () {
    const latest = yield* settings.getSettings.pipe(Effect.option);
    return (
      Option.isSome(latest) &&
      Equal.equals(deriveProviderInstanceConfigMap(latest.value)[input.instanceId], config) &&
      (yield* registry.getInstance(input.instanceId, config)) === instance
    );
  });
  if (!(yield* stillCurrent)) return result("stale");
  const outcome = yield* instance
    .interpretAtmosphere(input.request, input.model)
    .pipe(Effect.catchCause(() => Effect.succeed({ status: "unavailable" } as const)));
  const after = yield* instance.snapshot.getSnapshot;
  if (!(yield* stillCurrent) || !Equal.equals(after.auth, before.auth)) return result("stale");
  return result(outcome.status, outcome.status === "completed" ? outcome.proposal : undefined);
});
