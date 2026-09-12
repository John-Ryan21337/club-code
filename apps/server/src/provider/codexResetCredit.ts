import {
  ServerProviderResetCreditError,
  type ServerProviderResetCreditInput,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Duration from "effect/Duration";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import { buildCodexInitializeParams, makeCodexModelListCommand } from "./Layers/CodexProvider.ts";
import { terminateProbeChild } from "./providerSnapshot.ts";

/** The generated current-dev native protocol owns redemption and idempotency. */
export const requestCodexResetCredit = Effect.fn("requestCodexResetCredit")(function* (
  client: CodexClient.CodexAppServerClientShape,
  input: ServerProviderResetCreditInput & {
    readonly expectedEmail: string;
    readonly isCurrent: () => Effect.Effect<boolean>;
  },
) {
  yield* client.request("initialize", buildCodexInitializeParams());
  yield* client.notify("initialized", undefined);
  const { account } = yield* client.request("account/read", {});
  if (
    account?.type !== "chatgpt" ||
    !input.expectedEmail.trim() ||
    account.email?.trim().toLowerCase() !== input.expectedEmail.trim().toLowerCase() ||
    !(yield* input.isCurrent())
  ) {
    return yield* Effect.fail(new ServerProviderResetCreditError({ reason: "account-changed" }));
  }
  const response = yield* client.request("account/rateLimitResetCredit/consume", {
    idempotencyKey: input.attemptId,
    creditId: input.creditId,
  });
  return response.outcome;
});

export const consumeCodexResetCredit = Effect.fn("consumeCodexResetCredit")(function* (
  input: Parameters<typeof makeCodexModelListCommand>[0] &
    ServerProviderResetCreditInput & {
      readonly expectedEmail: string;
      readonly isCurrent: () => Effect.Effect<boolean>;
    },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.acquireUseRelease(
    spawner.spawn(makeCodexModelListCommand(input)),
    (child) =>
      Effect.gen(function* () {
        const context = yield* Layer.build(CodexClient.layerChildProcess(child));
        const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
          Effect.provide(context),
        );
        return yield* requestCodexResetCredit(client, input);
      }),
    (child) => terminateProbeChild(child, Duration.seconds(1)),
  );
});
