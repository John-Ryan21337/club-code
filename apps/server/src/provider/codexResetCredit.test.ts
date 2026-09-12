import { expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import type { CodexAppServerClientShape } from "effect-codex-app-server/client";
import { ProviderInstanceId } from "@cafecode/contracts";
import { requestCodexResetCredit } from "./codexResetCredit.ts";

const input = {
  instanceId: ProviderInstanceId.make("synthetic-codex"),
  attemptId: "12345678-1234-4123-8123-123456789abc",
  creditId: "synthetic-credit",
  expectedEmail: "synthetic@example.invalid",
  isCurrent: () => Effect.succeed(true),
};
function client(account: unknown, outcome: string = "reset") {
  const request = vi.fn((method: string) =>
    Effect.succeed(
      method === "account/read"
        ? { account }
        : method === "account/rateLimitResetCredit/consume"
          ? { outcome }
          : {},
    ),
  );
  return { request, notify: vi.fn(() => Effect.void) };
}
it.each(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"])(
  "preserves the native %s outcome and sends the exact attempt and credit once",
  async (outcome) => {
    const fake = client({ type: "chatgpt", email: input.expectedEmail }, outcome);
    expect(
      await Effect.runPromise(
        requestCodexResetCredit(fake as unknown as CodexAppServerClientShape, input),
      ),
    ).toBe(outcome);
    expect(fake.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "account/read",
      "account/rateLimitResetCredit/consume",
    ]);
    expect(fake.request).toHaveBeenLastCalledWith("account/rateLimitResetCredit/consume", {
      idempotencyKey: input.attemptId,
      creditId: input.creditId,
    });
  },
);
it.each([
  null,
  { type: "apiKey" },
  { type: "chatgpt", email: null },
  { type: "chatgpt", email: "other@example.invalid" },
])("refuses redemption for an unmatched native account", async (account) => {
  const fake = client(account);
  const result = await Effect.runPromise(
    requestCodexResetCredit(fake as unknown as CodexAppServerClientShape, input).pipe(
      Effect.result,
    ),
  );
  expect(result._tag).toBe("Failure");
  expect(fake.request.mock.calls.map(([method]) => method)).not.toContain(
    "account/rateLimitResetCredit/consume",
  );
});
it("rechecks the exact live instance immediately before the mutation", async () => {
  const fake = client({ type: "chatgpt", email: input.expectedEmail });
  await Effect.runPromise(
    requestCodexResetCredit(fake as unknown as CodexAppServerClientShape, {
      ...input,
      isCurrent: () => Effect.succeed(false),
    }).pipe(Effect.result),
  );
  expect(fake.request.mock.calls.map(([method]) => method)).not.toContain(
    "account/rateLimitResetCredit/consume",
  );
});
