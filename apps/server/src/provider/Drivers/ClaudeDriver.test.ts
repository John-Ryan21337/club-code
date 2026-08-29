import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { CLAUDE_PROBE_POLICY } from "./ClaudeDriver.ts";

describe("CLAUDE_PROBE_POLICY", () => {
  it("delegates the first probe to the registry's bounded admission queue", () => {
    assert.equal(CLAUDE_PROBE_POLICY.initialRefresh, "external");
  });

  it("classifies nothing as inconclusive, so no Claude failure is ever masked", () => {
    // Claude's status probe reports conclusive install/auth results; adding a
    // predicate here would suppress up to two real failures per provider scope.
    assert.equal(
      "isInconclusiveSnapshot" in CLAUDE_PROBE_POLICY,
      false,
      "Claude must not retain stale auth state behind an inconclusive classifier",
    );
  });

  it("keeps the bounded external-admission fallback enabled", () => {
    // `undefined` means the managed provider's default 60 s liveness backstop
    // applies. Only an explicit `null` would restore a hard dependency on the
    // registry ever admitting this instance.
    assert.equal(
      "externalInitialRefreshFallback" in CLAUDE_PROBE_POLICY,
      false,
      "Claude must keep the default external-admission fallback",
    );
  });
});
