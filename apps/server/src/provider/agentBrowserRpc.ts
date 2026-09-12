import {
  AgentBrowserRpcError,
  ClientSettingsError,
  type AgentBrowserCompleteInput,
  type AgentBrowserGrantInput,
  type AgentBrowserRevokeInput,
  type AgentBrowserSessionContext,
  type ClientSettingsPatch,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import type * as Semaphore from "effect/Semaphore";

import type { ServerClientSettingsShape } from "../serverClientSettings.ts";
import { ProviderValidationError } from "./Errors.ts";
import type { ProviderServiceShape } from "./Services/ProviderService.ts";

/** The route owns the shared lock; each authenticated connection owns this facade. */
export function makeAgentBrowserRpc(input: {
  readonly owner: boolean;
  readonly secureTransport: boolean;
  readonly provider: Pick<
    ProviderServiceShape,
    | "grantAgentBrowser"
    | "revokeAgentBrowser"
    | "pollAgentBrowser"
    | "completeAgentBrowser"
    | "listSessions"
  >;
  readonly settings: Pick<ServerClientSettingsShape, "getSettings" | "updateSettings">;
  readonly settingsPath: string;
  readonly semaphore: Semaphore.Semaphore;
}) {
  const requireOwner = Effect.suspend(() =>
    input.owner && input.secureTransport
      ? Effect.void
      : Effect.fail(
          new AgentBrowserRpcError({
            reason: "Agent Browser requires an owner connection over HTTPS or the same machine.",
          }),
        ),
  );
  const unavailable = Effect.fail(
    new ProviderValidationError({
      operation: "AgentBrowser",
      issue: "Agent Browser is unavailable.",
    }),
  );
  const authorize = <A, E>(effect: Effect.Effect<A, E>) =>
    requireOwner.pipe(
      Effect.flatMap(() => effect),
      // Neither provider errors nor schema diagnostics may expose page content.
      Effect.mapError(
        () =>
          new AgentBrowserRpcError({
            reason: "Agent Browser request failed. Check page sharing and thread access.",
          }),
      ),
      input.semaphore.withPermits(1),
    );
  return {
    grant: (grant: AgentBrowserGrantInput) =>
      authorize(
        Effect.gen(function* () {
          const settings = yield* input.settings.getSettings;
          if (settings.agentBrowserDisabledThreadIds.includes(grant.threadId))
            return yield* unavailable;
          const sessions = yield* input.provider.listSessions();
          if (
            !sessions.some(
              (session) =>
                session.threadId === grant.threadId &&
                session.providerInstanceId === grant.providerInstanceId &&
                (session.provider === "codex" || session.provider === "claudeAgent") &&
                session.status !== "closed" &&
                session.status !== "error",
            )
          )
            return yield* unavailable;
          return yield* input.provider.grantAgentBrowser?.(grant) ?? unavailable;
        }),
      ),
    revoke: (revoke: AgentBrowserRevokeInput) =>
      authorize(Effect.suspend(() => input.provider.revokeAgentBrowser?.(revoke) ?? unavailable)),
    poll: (context: AgentBrowserSessionContext) =>
      authorize(
        input.settings.getSettings.pipe(
          Effect.flatMap(
            (settings) =>
              input.provider.pollAgentBrowser?.({
                ...context,
                disabledThreadIds: settings.agentBrowserDisabledThreadIds,
              }) ?? unavailable,
          ),
        ),
      ),
    complete: (completion: AgentBrowserCompleteInput) =>
      authorize(
        Effect.suspend(() => input.provider.completeAgentBrowser?.(completion) ?? unavailable),
      ),
    updateSettings: (patch: ClientSettingsPatch) =>
      Effect.gen(function* () {
        if (patch.agentBrowserDisabledThreadIds !== undefined && !input.owner) {
          return yield* new ClientSettingsError({
            settingsPath: input.settingsPath,
            detail: "Only the Cafe owner can change Agent Browser access.",
          });
        }
        const settings = yield* input.settings.updateSettings(patch);
        if (patch.agentBrowserDisabledThreadIds !== undefined) {
          yield* Effect.forEach(
            settings.agentBrowserDisabledThreadIds,
            (threadId) =>
              input.provider.revokeAgentBrowser?.({ reason: "operator", threadId }).pipe(
                Effect.mapError(
                  () =>
                    new ClientSettingsError({
                      settingsPath: input.settingsPath,
                      detail: "Could not apply the Agent Browser thread access setting.",
                    }),
                ),
              ) ?? Effect.void,
            { discard: true },
          );
        }
        return settings;
      }).pipe(input.semaphore.withPermits(1)),
  };
}
