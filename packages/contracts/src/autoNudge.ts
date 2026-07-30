import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TurnId } from "./baseSchemas.ts";

export const AutoNudgeMode = Schema.Literals(["off", "hardcore-fanout", "steady-progress"]);
export type AutoNudgeMode = typeof AutoNudgeMode.Type;

export const AutoNudgeEnabledMode = Schema.Literals(["hardcore-fanout", "steady-progress"]);
export type AutoNudgeEnabledMode = typeof AutoNudgeEnabledMode.Type;

export const DEFAULT_AUTO_NUDGE_MODE: AutoNudgeMode = "off";
export const DEFAULT_AUTO_NUDGE_BACKGROUND_CONTINUATION = false;
export const MIN_AUTO_NUDGE_MAX_ROUNDS = 1;
export const MAX_AUTO_NUDGE_MAX_ROUNDS = 20;
export const DEFAULT_AUTO_NUDGE_MAX_ROUNDS = 5;
export const THREAD_AUTO_NUDGE_PROMPT_MAX_CHARS = 4_000;
export const THREAD_AUTO_NUDGE_MAX_AUTHORITY_REVISION = 2_147_483_647;

export const AutoNudgeMaxRounds = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_AUTO_NUDGE_MAX_ROUNDS,
    maximum: MAX_AUTO_NUDGE_MAX_ROUNDS,
  }),
);
export type AutoNudgeMaxRounds = typeof AutoNudgeMaxRounds.Type;

export const ThreadAutoNudgeAuthorityRevision = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(THREAD_AUTO_NUDGE_MAX_AUTHORITY_REVISION),
);
export type ThreadAutoNudgeAuthorityRevision = typeof ThreadAutoNudgeAuthorityRevision.Type;

/**
 * User-authored Auto Nudge text. Newlines are intentionally valid, while an
 * all-whitespace prompt is not. The prompt is persisted only on the exact
 * thread detail projection and is never accepted on an automated dispatch
 * command.
 */
export const ThreadAutoNudgePrompt = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(THREAD_AUTO_NUDGE_PROMPT_MAX_CHARS),
  Schema.isPattern(/\S/),
);
export type ThreadAutoNudgePrompt = typeof ThreadAutoNudgePrompt.Type;

export const StoredThreadAutoNudgePrompt = Schema.String.check(
  Schema.isMaxLength(THREAD_AUTO_NUDGE_PROMPT_MAX_CHARS),
);
export type StoredThreadAutoNudgePrompt = typeof StoredThreadAutoNudgePrompt.Type;

const ThreadAutoNudgeRunFields = {
  authorityRevision: ThreadAutoNudgeAuthorityRevision,
  backgroundContinuation: Schema.Boolean,
  maxRounds: AutoNudgeMaxRounds,
  baselineSettledTurnId: Schema.NullOr(TurnId),
  lastDispatchedSettledTurnId: Schema.NullOr(TurnId),
  roundsDispatched: NonNegativeInt,
  lastDispatchedAt: Schema.NullOr(IsoDateTime),
} as const;

const ThreadAutoNudgeOffConfig = Schema.Struct({
  ...ThreadAutoNudgeRunFields,
  mode: Schema.Literal("off"),
  prompt: StoredThreadAutoNudgePrompt,
  armedAt: Schema.Null,
});

const ThreadAutoNudgeEnabledConfig = Schema.Struct({
  ...ThreadAutoNudgeRunFields,
  mode: AutoNudgeEnabledMode,
  prompt: ThreadAutoNudgePrompt,
  armedAt: IsoDateTime,
});

/**
 * Server-authoritative execution authority for one exact thread.
 *
 * `authorityRevision` changes whenever configuration authority is replaced or
 * stopped. `baselineSettledTurnId` prevents enabling/editing a configuration
 * from retroactively dispatching against a turn that was already complete.
 */
export const ThreadAutoNudgeConfig = Schema.Union([
  ThreadAutoNudgeOffConfig,
  ThreadAutoNudgeEnabledConfig,
]);
export type ThreadAutoNudgeConfig = typeof ThreadAutoNudgeConfig.Type;

/**
 * Prompt-free shell representation. It is safe to fan out to shell
 * subscribers and contains only the state required to schedule a revision-
 * checked server dispatch.
 */
export const ThreadAutoNudgeSummary = Schema.Struct({
  ...ThreadAutoNudgeRunFields,
  mode: AutoNudgeMode,
  armedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadAutoNudgeSummary = typeof ThreadAutoNudgeSummary.Type;

export const DEFAULT_THREAD_AUTO_NUDGE_CONFIG: ThreadAutoNudgeConfig = {
  authorityRevision: 0,
  mode: "off",
  prompt: "",
  backgroundContinuation: false,
  maxRounds: DEFAULT_AUTO_NUDGE_MAX_ROUNDS,
  armedAt: null,
  baselineSettledTurnId: null,
  lastDispatchedSettledTurnId: null,
  roundsDispatched: 0,
  lastDispatchedAt: null,
};

export const ThreadAutoNudgeConfigWithDefault = ThreadAutoNudgeConfig.pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_THREAD_AUTO_NUDGE_CONFIG)),
);

export const DEFAULT_THREAD_AUTO_NUDGE_SUMMARY: ThreadAutoNudgeSummary = {
  authorityRevision: 0,
  mode: "off",
  backgroundContinuation: false,
  maxRounds: DEFAULT_AUTO_NUDGE_MAX_ROUNDS,
  armedAt: null,
  baselineSettledTurnId: null,
  lastDispatchedSettledTurnId: null,
  roundsDispatched: 0,
  lastDispatchedAt: null,
};

export const ThreadAutoNudgeSummaryWithDefault = ThreadAutoNudgeSummary.pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_THREAD_AUTO_NUDGE_SUMMARY)),
);

export const ThreadAutoNudgeDispatchSource = Schema.Literals(["foreground", "background"]);
export type ThreadAutoNudgeDispatchSource = typeof ThreadAutoNudgeDispatchSource.Type;
