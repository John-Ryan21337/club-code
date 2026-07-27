/**
 * ProviderAccountRateLimitsReactor — feeds Claude's event-sourced usage windows into
 * provider snapshots.
 *
 * Claude Code emits `rate_limit_event` (5h / weekly window reset + utilization) on its
 * normal session stream; the Claude adapter re-emits it as the `account.rate-limits.updated`
 * runtime event. We consume that authoritative live-turn update here and merge its dated
 * window into the instance's `accountRateLimits` via the registry. The separate, explicit
 * Provider Usage poll may supply a fuller snapshot while the widget is enabled; this event
 * path neither invokes that poll nor touches its disposable Query. From here the merged
 * snapshot reaches the UI through the existing snapshot change pipeline.
 *
 * This is a self-starting daemon layer: building it forks a scoped consumer of
 * `ProviderService.streamEvents` (a fresh PubSub subscription, independent of the other
 * consumers) for the lifetime of the runtime.
 *
 * @module ProviderAccountRateLimitsReactor
 */
import { ProviderDriverKind, type ProviderRuntimeEvent } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { parseClaudeRateLimitUpdate } from "../claudeRateLimits.ts";
import { ProviderRegistry } from "../Services/ProviderRegistry.ts";
import { ProviderService } from "../Services/ProviderService.ts";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");

export const ProviderAccountRateLimitsReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const registry = yield* ProviderRegistry;

    const handleEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (event.type !== "account.rate-limits.updated") return;
        // Codex populates `accountRateLimits` from its authoritative probe; only Claude
        // is event-sourced. Leaving Codex on its probe path avoids parsing its differently
        // shaped notification here.
        if (event.provider !== CLAUDE_DRIVER) return;
        if (event.providerInstanceId === undefined) return;

        const update = parseClaudeRateLimitUpdate(event.payload.rateLimits);
        if (update === null) return;

        const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
        yield* registry.updateProviderAccountRateLimits({
          instanceId: event.providerInstanceId,
          slot: update.slot,
          window: update.window,
          checkedAt,
        });
      });

    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) =>
        handleEvent(event).pipe(Effect.ignoreCause({ log: true })),
      ),
    );
  }),
);
