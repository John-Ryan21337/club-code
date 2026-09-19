import { ProviderInstanceId, ThreadId } from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import type { CodexAppServerClientShape } from "effect-codex-app-server/client";
import type { CodexAppServerIncomingNotification } from "effect-codex-app-server/protocol";
import { CodexAppServerRequestError } from "effect-codex-app-server/errors";
import { makeCodexExperimentalController } from "./CodexExperimental.ts";

const identity = {
  threadId: ThreadId.make("club-thread"),
  providerInstanceId: ProviderInstanceId.make("codex-1"),
};
const harness = Effect.gen(function* () {
  const events = yield* PubSub.unbounded<CodexAppServerIncomingNotification>();
  const calls: { method: string; params: unknown }[] = [];
  let failStop = false;
  let emitClosed = true;
  const request = (method: string, params: unknown) =>
    Effect.gen(function* () {
      calls.push({ method, params });
      if (method === "thread/realtime/start") {
        // An SDP without this call's started marker is stale and must be ignored.
        yield* PubSub.publish(events, {
          method: "thread/realtime/sdp",
          params: { threadId: "native-thread", sdp: "stale-private-answer" },
        });
        yield* PubSub.publish(events, {
          method: "thread/realtime/started",
          params: {
            threadId: "native-thread",
            realtimeSessionId: (params as { realtimeSessionId: string }).realtimeSessionId,
            version: "v3",
          },
        });
        yield* PubSub.publish(events, {
          method: "thread/realtime/sdp",
          params: { threadId: "native-thread", sdp: "synthetic-answer" },
        });
      }
      if (method === "thread/realtime/stop") {
        if (failStop)
          return yield* Effect.fail(
            new CodexAppServerRequestError({ code: -32000, errorMessage: "private stop failure" }),
          );
        if (emitClosed)
          yield* PubSub.publish(events, {
            method: "thread/realtime/closed",
            params: { threadId: "native-thread", reason: "requested" },
          });
      }
      if (method === "memory/status") return { v2ConsolidatedThreads: 24, v2Ready: true };
      if (method === "userVerification/status")
        return { credentialId: "private-native-id", unavailableReason: null };
      return {};
    });
  const client = {
    request,
    raw: { notifications: Stream.fromPubSub(events) },
  } as unknown as CodexAppServerClientShape;
  const run = yield* makeCodexExperimentalController(client, Effect.succeed("native-thread"));
  return {
    calls,
    run,
    client,
    events,
    setFailStop: (value: boolean) => {
      failStop = value;
    },
    setEmitClosed: (value: boolean) => {
      emitClosed = value;
    },
  };
});

it.effect("returns bounded readiness metadata without exposing native credential identifiers", () =>
  Effect.gen(function* () {
    const { run } = yield* harness;
    assert.deepEqual(yield* run({ ...identity, action: { kind: "memoryStatus" } }), {
      kind: "memoryStatus",
      consolidatedThreads: 24,
      ready: true,
    });
    assert.deepEqual(yield* run({ ...identity, action: { kind: "verificationStatus" } }), {
      kind: "verificationStatus",
      available: true,
      reason: null,
    });
  }),
);

it.effect(
  "negotiates the native thread, rejects a replacement session, and expires its lease",
  () =>
    Effect.gen(function* () {
      const { run, calls } = yield* harness;
      const action = {
        kind: "voiceStart" as const,
        sessionKey: "lease-1",
        offerSdp: "synthetic-offer",
      };
      assert.deepEqual(yield* run({ ...identity, action }), {
        kind: "voiceStart",
        answerSdp: "synthetic-answer",
      });
      assert.deepEqual(calls[0], {
        method: "thread/realtime/start",
        params: {
          threadId: "native-thread",
          realtimeSessionId: "lease-1",
          outputModality: "audio",
          version: "v3",
          transport: { type: "webrtc", sdp: "synthetic-offer" },
        },
      });
      assert.equal(
        (yield* Effect.exit(run({ ...identity, action: { ...action, sessionKey: "replacement" } })))
          ._tag,
        "Failure",
      );
      yield* run({ ...identity, action: { kind: "voiceStop", sessionKey: "wrong-key" } });
      assert.equal(calls.length, 1);
      yield* TestClock.adjust("35 seconds");
      assert.equal(calls.at(-1)?.method, "thread/realtime/stop");
      assert.equal(
        (yield* Effect.exit(
          run({ ...identity, action: { kind: "voiceRenew", sessionKey: "lease-1" } }),
        ))._tag,
        "Failure",
      );
    }),
);

it.effect("retains a failed stop lease, blocks replacement and renewal, then retries cleanup", () =>
  Effect.gen(function* () {
    const { run, calls, setFailStop } = yield* harness;
    const start = { kind: "voiceStart" as const, sessionKey: "first", offerSdp: "synthetic" };
    yield* run({ ...identity, action: start });
    setFailStop(true);
    assert.equal(
      (yield* Effect.exit(run({ ...identity, action: { kind: "voiceStop", sessionKey: "first" } })))
        ._tag,
      "Failure",
    );
    assert.equal(
      (yield* Effect.exit(run({ ...identity, action: { ...start, sessionKey: "second" } })))._tag,
      "Failure",
    );
    assert.equal(
      (yield* Effect.exit(
        run({ ...identity, action: { kind: "voiceRenew", sessionKey: "first" } }),
      ))._tag,
      "Failure",
    );
    assert.equal(calls.filter((call) => call.method === "thread/realtime/start").length, 1);
    setFailStop(false);
    yield* TestClock.adjust("5 seconds");
    yield* run({ ...identity, action: { ...start, sessionKey: "second" } });
    assert.equal(calls.filter((call) => call.method === "thread/realtime/start").length, 2);
  }),
);

it.effect("refuses renewal after provider closure", () =>
  Effect.gen(function* () {
    const { run, events } = yield* harness;
    yield* run({
      ...identity,
      action: { kind: "voiceStart", sessionKey: "first", offerSdp: "synthetic" },
    });
    yield* PubSub.publish(events, {
      method: "thread/realtime/closed",
      params: { threadId: "native-thread" },
    });
    yield* Effect.yieldNow;
    assert.equal(
      (yield* Effect.exit(
        run({ ...identity, action: { kind: "voiceRenew", sessionKey: "first" } }),
      ))._tag,
      "Failure",
    );
  }),
);

it.effect("does not treat a stop acknowledgement as proof the provider call closed", () =>
  Effect.gen(function* () {
    const { run, setEmitClosed } = yield* harness;
    const start = { kind: "voiceStart" as const, sessionKey: "first", offerSdp: "synthetic" };
    yield* run({ ...identity, action: start });
    setEmitClosed(false);
    const stop = yield* run({
      ...identity,
      action: { kind: "voiceStop", sessionKey: "first" },
    }).pipe(Effect.forkChild);
    yield* TestClock.adjust("5 seconds");
    assert.equal((yield* Fiber.await(stop))._tag, "Failure");
    const replacement = yield* run({
      ...identity,
      action: { ...start, sessionKey: "second" },
    }).pipe(Effect.forkChild);
    yield* TestClock.adjust("5 seconds");
    assert.equal((yield* Fiber.await(replacement))._tag, "Failure");
    setEmitClosed(true);
    yield* run({ ...identity, action: { kind: "voiceStop", sessionKey: "first" } });
    yield* run({ ...identity, action: { ...start, sessionKey: "second" } });
  }),
);

it.effect("masks provider failures before they reach daemon diagnostics", () =>
  Effect.gen(function* () {
    const { client } = yield* harness;
    const failing = {
      ...client,
      request: () =>
        Effect.fail(
          new CodexAppServerRequestError({
            code: -32602,
            errorMessage: "private SDP and account text",
          }),
        ),
    } as CodexAppServerClientShape;
    const run = yield* makeCodexExperimentalController(failing, Effect.succeed("native-thread"));
    const error = yield* run({ ...identity, action: { kind: "memoryStatus" } }).pipe(Effect.flip);
    assert.equal(JSON.stringify(error).includes("private SDP"), false);
    assert.equal("cause" in error, false);
  }),
);
