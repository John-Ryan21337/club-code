import type { EnvironmentId, ServerProvider, ThreadId } from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type { ProviderPacingActiveTurnLifecycleShape } from "./Services/ProviderPacingActiveTurnLifecycle.ts";
import type { ProviderPacingAdmissionShape } from "./Services/ProviderPacingAdmission.ts";

export type ProviderPacingLaunchOutcome<A> =
  | { readonly status: "launched"; readonly value: A }
  | { readonly status: "deferred" };

export class ProviderPacingLaunchAdmissionError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Provider pacing could not admit the launch.");
    this.name = "ProviderPacingLaunchAdmissionError";
    this.cause = cause;
  }
}

export interface ProviderPacingLaunchExecution<A, E> {
  readonly result: Effect.Effect<
    ProviderPacingLaunchOutcome<A>,
    E | ProviderPacingLaunchAdmissionError
  >;
  /**
   * Cancels only while this launch is still waiting for admission. It cannot
   * signal provider work after the launch thunk begins.
   */
  readonly cancelWaiting: () => boolean;
}

type ProviderPacingLaunchSettlement<A, E> =
  | { readonly status: "admitted"; readonly exit: Exit.Exit<A, E> }
  | { readonly status: "rejected"; readonly error: ProviderPacingLaunchAdmissionError };

/**
 * Bridges the promise-based bounded admission coordinator to an Effect-owned
 * provider launch without giving pacing a cancellation handle to active work.
 *
 * Auto Nudge is fail-fast: if admission is not synchronous, its reservation is
 * removed immediately and the caller receives `deferred`. Manual work remains
 * queued and may be cancelled explicitly by a later thread interrupt.
 */
export function prepareProviderPacingLaunch<A, E>(input: {
  readonly admission: ProviderPacingAdmissionShape;
  readonly activeTurnLifecycle: ProviderPacingActiveTurnLifecycleShape;
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider;
  readonly threadId: ThreadId;
  readonly dispatchSource: "user" | "auto-nudge";
  readonly launch: Effect.Effect<A, E>;
}): ProviderPacingLaunchExecution<A, E> {
  const admission = input.admission.submitNewLaunch({
    environmentId: input.environmentId,
    provider: input.provider,
    dispatchSource: input.dispatchSource,
    launch: () =>
      Effect.runPromiseExit(
        input.launch.pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              input.activeTurnLifecycle.adoptAcceptedLaunch({
                environmentId: input.environmentId,
                provider: input.provider,
                threadId: input.threadId,
              }),
            ),
          ),
        ),
      ),
  });

  // Attach both promise continuations before any synchronous cancellation so
  // a fail-fast Auto Nudge rejection can never surface as an unhandled promise.
  const settled: Promise<ProviderPacingLaunchSettlement<A, E>> = admission.promise.then(
    (exit): ProviderPacingLaunchSettlement<A, E> => ({ status: "admitted", exit }),
    (cause: unknown) => ({
      status: "rejected",
      error: new ProviderPacingLaunchAdmissionError(cause),
    }),
  );

  if (input.dispatchSource === "auto-nudge" && admission.cancel()) {
    return {
      result: Effect.succeed({ status: "deferred" }),
      cancelWaiting: () => false,
    };
  }

  return {
    result: Effect.callback<ProviderPacingLaunchOutcome<A>, E | ProviderPacingLaunchAdmissionError>(
      (resume) => {
        void settled.then((settlement) => {
          if (settlement.status === "rejected") {
            resume(Effect.fail(settlement.error));
            return;
          }
          if (Exit.isFailure(settlement.exit)) {
            resume(Effect.failCause(settlement.exit.cause));
            return;
          }
          resume(
            Effect.succeed({
              status: "launched",
              value: settlement.exit.value,
            }),
          );
        });
      },
    ),
    cancelWaiting: admission.cancel,
  };
}
