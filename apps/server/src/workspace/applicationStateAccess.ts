import { ApplicationStateError } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { AuthenticatedSession } from "../auth/Services/ServerAuth.ts";
import type { SessionCredentialServiceShape } from "../auth/Services/SessionCredentialService.ts";

export const applicationStateUnavailable = () =>
  new ApplicationStateError({ message: "The operational state preview is unavailable." });

/** Upgrade-time role is insufficient: revocation can occur while a worker runs.
 * Neither session metadata nor native errors cross this fixed error boundary. */
export function withApplicationStateAccess<A>(
  session: AuthenticatedSession,
  observedLoopback: boolean,
  sessions: Pick<SessionCredentialServiceShape, "listActive">,
  operation: () => Promise<A>,
): Effect.Effect<A, ApplicationStateError> {
  const check = Effect.gen(function* () {
    if (session.role !== "owner" || !observedLoopback)
      return yield* Effect.fail(applicationStateUnavailable());
    const active = yield* sessions.listActive();
    const now = yield* DateTime.now;
    const owner = active.find(
      (entry) => entry.sessionId === session.sessionId && entry.role === "owner",
    );
    if (
      !owner ||
      !Number.isFinite(DateTime.toEpochMillis(owner.expiresAt)) ||
      DateTime.toEpochMillis(owner.expiresAt) <= DateTime.toEpochMillis(now)
    ) {
      return yield* Effect.fail(applicationStateUnavailable());
    }
  });
  return Effect.gen(function* () {
    yield* check;
    const result = yield* Effect.tryPromise({ try: operation, catch: applicationStateUnavailable });
    yield* check;
    return result;
  }).pipe(Effect.catch(() => Effect.fail(applicationStateUnavailable())));
}
