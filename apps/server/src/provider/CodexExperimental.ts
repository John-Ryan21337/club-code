import { CodexExperimentalResult, type CodexExperimentalInput } from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import type { CodexAppServerClientShape } from "effect-codex-app-server/client";
import { CodexAppServerProtocolParseError } from "effect-codex-app-server/errors";

const failure = () =>
  new CodexAppServerProtocolParseError({
    detail: "The experimental Codex operation is unavailable or expired.",
  });

// Audio travels over the browser's WebRTC connection. This controller holds only
// short-lived signaling state; neither SDP nor audio belongs in the daemon journal.
export const makeCodexExperimentalController = Effect.fn("makeCodexExperimentalController")(
  function* (client: CodexAppServerClientShape, readThreadId: Effect.Effect<string, unknown>) {
    const lock = yield* Semaphore.make(1);
    let active: {
      key: string;
      threadId: string;
      expiresAt: number;
      answerSdp?: string;
      started: boolean;
      stopping: boolean;
      closed: Deferred.Deferred<void>;
      sdp: Deferred.Deferred<string, CodexAppServerProtocolParseError>;
    } | null = null;
    const stop = Effect.gen(function* () {
      const current = active;
      if (!current) return;
      current.stopping = true;
      current.expiresAt = 0;
      // A request acknowledgement only queues the core operation. Do not admit
      // another call until the old call's closed notification arrives.
      yield* Effect.gen(function* () {
        yield* client.request("thread/realtime/stop", { threadId: current.threadId });
        yield* Deferred.await(current.closed);
        if (active === current) active = null;
      }).pipe(Effect.timeout("5 seconds"));
    });
    yield* client.raw.notifications.pipe(
      Stream.filter((event) => event.method.startsWith("thread/realtime/")),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const current = active;
          const params = event.params as
            | { threadId?: unknown; realtimeSessionId?: unknown; sdp?: unknown }
            | undefined;
          if (!current || params?.threadId !== current.threadId) return;
          if (event.method === "thread/realtime/started") {
            current.started = params.realtimeSessionId === current.key;
          } else if (
            event.method === "thread/realtime/sdp" &&
            current.started &&
            !current.stopping
          ) {
            if (
              typeof params.sdp === "string" &&
              params.sdp.length > 0 &&
              params.sdp.length <= 65_536
            )
              yield* Deferred.succeed(current.sdp, params.sdp);
            else yield* Deferred.fail(current.sdp, failure());
          } else if (
            event.method === "thread/realtime/error" ||
            event.method === "thread/realtime/closed"
          ) {
            current.stopping = true;
            current.expiresAt = 0;
            yield* Deferred.fail(current.sdp, failure());
            if (event.method === "thread/realtime/closed")
              yield* Deferred.succeed(current.closed, undefined);
          }
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* Effect.addFinalizer(() => stop.pipe(Effect.ignore));
    yield* Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep("5 seconds");
        yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (active && active.expiresAt <= (yield* Clock.currentTimeMillis))
              yield* stop.pipe(Effect.ignore);
          }),
        );
      }
    }).pipe(Effect.forkScoped);

    return (input: CodexExperimentalInput) =>
      lock
        .withPermits(1)(
          Effect.gen(function* () {
            const action = input.action;
            if (action.kind === "memoryStatus") {
              const status = yield* client.request("memory/status", {});
              return {
                kind: "memoryStatus" as const,
                consolidatedThreads: status.v2ConsolidatedThreads,
                ready: status.v2Ready,
              };
            }
            if (action.kind === "verificationStatus") {
              const status = yield* client.request("userVerification/status", {});
              return {
                kind: "verificationStatus" as const,
                available: status.credentialId != null && status.unavailableReason == null,
                reason: status.unavailableReason ?? null,
              };
            }
            if (action.kind === "voiceStop") {
              if (active?.key === action.sessionKey) yield* stop;
              return { kind: "voiceStop" as const };
            }
            if (action.kind === "voiceRenew") {
              if (
                !active ||
                active.stopping ||
                active.key !== action.sessionKey ||
                active.expiresAt <= (yield* Clock.currentTimeMillis)
              )
                return yield* Effect.fail(failure());
              active.expiresAt = (yield* Clock.currentTimeMillis) + 30_000;
              return { kind: "voiceRenew" as const };
            }
            if (active) {
              if (
                active.key === action.sessionKey &&
                !active.stopping &&
                active.answerSdp &&
                active.expiresAt > (yield* Clock.currentTimeMillis)
              )
                return { kind: "voiceStart" as const, answerSdp: active.answerSdp };
              return yield* Effect.fail(failure());
            }
            const threadId = yield* readThreadId.pipe(Effect.mapError(failure));
            active = {
              key: action.sessionKey,
              threadId,
              expiresAt: (yield* Clock.currentTimeMillis) + 30_000,
              started: false,
              stopping: false,
              closed: yield* Deferred.make<void>(),
              sdp: yield* Deferred.make<string, CodexAppServerProtocolParseError>(),
            };
            const current = active;
            return yield* Effect.gen(function* () {
              yield* client.request("thread/realtime/start", {
                threadId,
                realtimeSessionId: action.sessionKey,
                outputModality: "audio",
                version: "v3",
                transport: { type: "webrtc", sdp: action.offerSdp },
              });
              const answerSdp = yield* Deferred.await(current.sdp);
              if (active !== current || current.stopping) return yield* Effect.fail(failure());
              current.expiresAt = (yield* Clock.currentTimeMillis) + 30_000;
              current.answerSdp = answerSdp;
              return { kind: "voiceStart" as const, answerSdp };
            }).pipe(
              Effect.timeout("20 seconds"),
              Effect.onError(() => stop.pipe(Effect.ignore)),
            );
          }),
        )
        .pipe(
          Effect.timeout("25 seconds"),
          Effect.flatMap(Schema.decodeUnknownEffect(CodexExperimentalResult)),
          Effect.mapError(failure),
        );
  },
);
