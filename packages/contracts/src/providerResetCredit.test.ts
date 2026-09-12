import { expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { ServerProviderResetCreditInput, ServerProviderResetCreditOutcome } from "./server.ts";
const request = {
  instanceId: "synthetic-codex",
  expectedEmail: "synthetic@example.invalid",
  attemptId: "12345678-1234-4123-8123-123456789abc",
  creditId: "synthetic-credit",
};
it("requires bounded account/credit identity and a UUID attempt", () => {
  expect(Schema.decodeUnknownSync(ServerProviderResetCreditInput)(request)).toEqual(request);
  for (const invalid of [
    { ...request, attemptId: "" },
    { ...request, attemptId: "not-a-uuid" },
    { ...request, expectedEmail: "" },
    { ...request, creditId: "x".repeat(257) },
  ]) {
    expect(() => Schema.decodeUnknownSync(ServerProviderResetCreditInput)(invalid)).toThrow();
  }
});
it("accepts only actual native outcomes", () => {
  for (const outcome of ["reset", "nothingToReset", "noCredit", "alreadyRedeemed"])
    expect(Schema.decodeUnknownSync(ServerProviderResetCreditOutcome)(outcome)).toBe(outcome);
  expect(() => Schema.decodeUnknownSync(ServerProviderResetCreditOutcome)("success")).toThrow();
});
