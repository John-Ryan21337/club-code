import {
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProviderInstanceId,
  ThreadId,
} from "@cafecode/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProviderPacingPendingLaunch = Schema.Struct({
  sourceEventId: EventId,
  sourceSequence: NonNegativeInt,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  // Auto Nudge is fail-fast and must never survive as delayed durable work.
  dispatchSource: Schema.Literal("user"),
  requestedAt: IsoDateTime,
});
export type ProviderPacingPendingLaunch = typeof ProviderPacingPendingLaunch.Type;

export const GetProviderPacingPendingLaunchInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProviderPacingPendingLaunchInput = typeof GetProviderPacingPendingLaunchInput.Type;

export interface ProviderPacingPendingLaunchRepositoryShape {
  /**
   * Atomically claims the durable slot for one manual launch. Returns false
   * when either the thread or immutable source event is already claimed.
   */
  readonly insertIfAbsent: (
    launch: ProviderPacingPendingLaunch,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly upsert: (
    launch: ProviderPacingPendingLaunch,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByThreadId: (
    input: GetProviderPacingPendingLaunchInput,
  ) => Effect.Effect<Option.Option<ProviderPacingPendingLaunch>, ProjectionRepositoryError>;
  readonly listAll: Effect.Effect<
    ReadonlyArray<ProviderPacingPendingLaunch>,
    ProjectionRepositoryError
  >;
  readonly deleteByThreadId: (
    input: GetProviderPacingPendingLaunchInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProviderPacingPendingLaunchRepository extends Context.Service<
  ProviderPacingPendingLaunchRepository,
  ProviderPacingPendingLaunchRepositoryShape
>()("cafecode/persistence/Services/ProviderPacingPendingLaunchRepository") {}
