import type { ServerProviderAccessInput, ServerProviderAccessResult } from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";

import { ProviderInstanceRegistry } from "./Services/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "./Layers/ProviderInstanceRegistryHydration.ts";

export const checkProviderAccess = Effect.fn("checkProviderAccess")(function* (
  input: ServerProviderAccessInput,
) {
  const result = (status: ServerProviderAccessResult["status"]): ServerProviderAccessResult => ({
    ...input,
    status,
    checkedAt: new Date().toISOString(),
  });
  const registry = yield* ProviderInstanceRegistry;
  const settings = yield* ServerSettingsService;
  const saved = yield* settings.getSettings.pipe(Effect.option);
  if (Option.isNone(saved)) return result("unverified");
  const config = deriveProviderInstanceConfigMap(saved.value)[input.instanceId];
  if (!config) return result("unverified");
  const instance = yield* registry.getInstance(input.instanceId, config);
  if (!instance?.enabled) return result("unverified");
  if (!instance.checkAccess) return result("unsupported");
  const snapshot = yield* instance.snapshot.getSnapshot;
  if (!snapshot.models.some((model) => model.slug === input.model)) return result("unverified");
  const outcome = yield* instance
    .checkAccess(input.model)
    .pipe(Effect.catchCause(() => Effect.succeed(result("unverified"))));
  // Do not attach a successful check from an old configuration to its replacement.
  const latest = yield* settings.getSettings.pipe(Effect.option);
  if (
    Option.isNone(latest) ||
    !Equal.equals(deriveProviderInstanceConfigMap(latest.value)[input.instanceId], config) ||
    (yield* registry.getInstance(input.instanceId, config)) !== instance
  )
    return result("unverified");
  return outcome;
});
