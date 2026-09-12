import { AuthSessionId, type AuthClientSession } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../auth/Services/ServerAuth.ts";
import { SessionCredentialError } from "../auth/Services/SessionCredentialService.ts";
import { withApplicationStateAccess } from "./applicationStateAccess.ts";

const session: AuthenticatedSession = {
  sessionId: AuthSessionId.make("state-owner"),
  subject: "fixture",
  method: "browser-session-cookie",
  role: "owner",
};
const active = {
  sessionId: session.sessionId,
  role: "owner",
  expiresAt: DateTime.makeUnsafe("2100-01-01T00:00:00.000Z"),
} as AuthClientSession;
const unavailable = "The operational state preview is unavailable.";
const run = <A>(value: Effect.Effect<A, unknown>) =>
  Effect.runPromise(value.pipe(Effect.catch((error) => Effect.succeed(error))));

describe("application-state authority", () => {
  it("checks fresh authority before and after the owned operation", async () => {
    const listActive = vi.fn(() => Effect.succeed([active]));
    const work = vi.fn(async () => ({ safe: 1 }));
    expect(await run(withApplicationStateAccess(session, true, { listActive }, work))).toEqual({
      safe: 1,
    });
    expect(listActive).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledOnce();
  });

  it.each(["paired", "remote", "revoked", "expired", "other-owner"])(
    "refuses %s before starting work",
    async (kind) => {
      const work = vi.fn(async () => "private");
      const rows =
        kind === "revoked"
          ? []
          : [
              {
                ...active,
                ...(kind === "expired"
                  ? { expiresAt: DateTime.makeUnsafe("2000-01-01T00:00:00.000Z") }
                  : {}),
                ...(kind === "other-owner" ? { sessionId: AuthSessionId.make("other") } : {}),
              },
            ];
      const result = await run(
        withApplicationStateAccess(
          { ...session, role: kind === "paired" ? "client" : "owner" },
          kind !== "remote",
          { listActive: () => Effect.succeed(rows) },
          work,
        ),
      );
      expect(result).toMatchObject({ _tag: "ApplicationStateError", message: unavailable });
      expect(work).not.toHaveBeenCalled();
    },
  );

  it("suppresses a result when the owner is revoked during work", async () => {
    let rows = [active];
    const result = await run(
      withApplicationStateAccess(
        session,
        true,
        { listActive: () => Effect.succeed(rows) },
        async () => {
          rows = [];
          return "private-result-must-not-escape";
        },
      ),
    );
    expect(result).toMatchObject({ _tag: "ApplicationStateError", message: unavailable });
    expect(JSON.stringify(result)).not.toContain("private-result");
  });

  it("does not expose session lookup or worker errors", async () => {
    const lookup = await run(
      withApplicationStateAccess(
        session,
        true,
        {
          listActive: () => Effect.fail(new SessionCredentialError({ message: "private-session" })),
        },
        async () => "unused",
      ),
    );
    const worker = await run(
      withApplicationStateAccess(
        session,
        true,
        { listActive: () => Effect.succeed([active]) },
        async () => {
          throw new Error("private-row-path");
        },
      ),
    );
    for (const result of [lookup, worker]) {
      expect(result).toMatchObject({ message: unavailable });
      expect(JSON.stringify(result)).not.toContain("private-");
    }
  });

  it.each(["expired", "client"])(
    "refuses a completed result after owner authority becomes %s",
    async (kind) => {
      let rows = [active];
      const result = await run(
        withApplicationStateAccess(
          session,
          true,
          { listActive: () => Effect.succeed(rows) },
          async () => {
            rows = [
              {
                ...active,
                ...(kind === "expired"
                  ? { expiresAt: DateTime.makeUnsafe("2000-01-01T00:00:00.000Z") }
                  : { role: "client" as const }),
              },
            ];
            return "late-operational-result";
          },
        ),
      );
      expect(result).toMatchObject({ _tag: "ApplicationStateError", message: unavailable });
      expect(JSON.stringify(result)).not.toContain("late-operational-result");
    },
  );
});
