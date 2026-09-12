import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ServerProviderAccessInput, ServerProviderAccessResult } from "./server.ts";

describe("provider access contracts", () => {
  it("bounds model input and rejects control characters before provider launch", () => {
    const decode = Schema.decodeUnknownSync(ServerProviderAccessInput);
    expect(decode({ instanceId: "claude-work", model: "claude-sonnet-5" }).model).toBe(
      "claude-sonnet-5",
    );
    for (const model of ["", "x".repeat(257), "model\nsecret", "model\u0000value"]) {
      expect(() => decode({ instanceId: "claude-work", model })).toThrow();
    }
  });
  it("accepts only the defined access outcomes", () => {
    const decode = Schema.decodeUnknownSync(ServerProviderAccessResult);
    expect(() =>
      decode({
        instanceId: "claude-work",
        model: "claude-sonnet-5",
        checkedAt: "2026-09-11T00:00:00.000Z",
        status: "local-credentials-present",
      }),
    ).toThrow();
  });
});
