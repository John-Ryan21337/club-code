import { MessageId, ThreadId } from "@cafecode/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { describe, expect, it } from "vitest";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderSessionNotFoundError,
} from "../provider/Errors.ts";
import {
  classifyUserInputCallbackOwnershipLoss,
  makeUserInputRecoveryDeliveryState,
} from "./UserInputRecoveryRuntime.ts";

describe("structured user-input recovery runtime", () => {
  it("classifies typed callback and session ownership loss", () => {
    expect(
      classifyUserInputCallbackOwnershipLoss(
        Cause.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "item/tool/respondToUserInput",
            detail: "Unknown pending Codex user input request: request-1",
          }),
        ),
      ),
    ).toBe("callback-missing");
    expect(
      classifyUserInputCallbackOwnershipLoss(
        Cause.fail(
          new ProviderAdapterRequestError({
            provider: "provider-daemon",
            method: "respondToUserInput",
            detail: "remote callback disappeared",
            remoteErrorTag: "CodexSessionRuntimePendingUserInputNotFoundError",
          }),
        ),
      ),
    ).toBe("callback-missing");
    expect(
      classifyUserInputCallbackOwnershipLoss(
        Cause.fail(new ProviderSessionNotFoundError({ threadId: "thread-1" })),
      ),
    ).toBe("session-missing");
    expect(
      classifyUserInputCallbackOwnershipLoss(
        Cause.die(
          new ProviderAdapterSessionClosedError({
            provider: "opencode",
            threadId: "thread-1",
          }),
        ),
      ),
    ).toBe("session-missing");
  });

  it("does not reinterpret transport failures as callback ownership loss", () => {
    expect(
      classifyUserInputCallbackOwnershipLoss(
        Cause.fail(
          new ProviderAdapterRequestError({
            provider: "provider-daemon",
            method: "respondToUserInput",
            detail: "connect ECONNREFUSED 127.0.0.1:43123",
          }),
        ),
      ),
    ).toBeUndefined();
  });

  it("tracks only recovery deliveries and clears tracking on every exit", async () => {
    const state = makeUserInputRecoveryDeliveryState();
    const recoveryMessageId = MessageId.make("user-input-recovery:abc123");
    const ordinaryMessageId = MessageId.make("message-1");

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const recoveryGate = yield* Deferred.make<void>();
          const recoveryFiber = yield* state.forkTrackedDelivery(
            recoveryMessageId,
            Deferred.await(recoveryGate),
          );
          expect(state.hasDeliveryInFlight(recoveryMessageId)).toBe(true);
          yield* Deferred.succeed(recoveryGate, undefined);
          yield* Fiber.join(recoveryFiber);
          expect(state.hasDeliveryInFlight(recoveryMessageId)).toBe(false);

          const failureFiber = yield* state.forkTrackedDelivery(
            recoveryMessageId,
            Effect.fail("delivery failed"),
          );
          expect(Exit.isFailure(yield* Fiber.await(failureFiber))).toBe(true);
          expect(state.hasDeliveryInFlight(recoveryMessageId)).toBe(false);

          const ordinaryGate = yield* Deferred.make<void>();
          const ordinaryFiber = yield* state.forkTrackedDelivery(
            ordinaryMessageId,
            Deferred.await(ordinaryGate),
          );
          expect(state.hasDeliveryInFlight(ordinaryMessageId)).toBe(false);
          yield* Deferred.succeed(ordinaryGate, undefined);
          yield* Fiber.join(ordinaryFiber);
        }),
      ),
    );
  });

  it("retains accepted recovery proof until explicitly cleared", () => {
    const state = makeUserInputRecoveryDeliveryState();
    const recoveryMessageId = MessageId.make("user-input-recovery:accepted");
    const ordinaryMessageId = MessageId.make("message-accepted");

    state.rememberAcceptedMessage(ordinaryMessageId);
    expect(state.hasAcceptedMessage(ordinaryMessageId)).toBe(false);

    state.rememberAcceptedMessage(recoveryMessageId);
    expect(state.hasAcceptedMessage(recoveryMessageId)).toBe(true);
    state.forgetAcceptedMessage(recoveryMessageId);
    expect(state.hasAcceptedMessage(recoveryMessageId)).toBe(false);
  });

  it("contains bookkeeping failure only after a recovery message was accepted", async () => {
    const state = makeUserInputRecoveryDeliveryState();
    const threadId = ThreadId.make("thread-1");
    const recoveryMessageId = MessageId.make("user-input-recovery:accepted");
    const ordinaryMessageId = MessageId.make("message-accepted");

    await expect(
      Effect.runPromise(
        state.protectAcceptedBookkeeping(
          { threadId, recoveryMessageId },
          Effect.fail("projection unavailable"),
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(
        state.protectAcceptedBookkeeping(
          { threadId, recoveryMessageId: ordinaryMessageId },
          Effect.fail("projection unavailable"),
        ),
      ),
    ).rejects.toBe("projection unavailable");
  });
});
