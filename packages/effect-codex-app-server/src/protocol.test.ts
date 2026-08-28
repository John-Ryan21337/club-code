import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as CodexError from "./errors.ts";
import * as CodexProtocol from "./protocol.ts";
import * as CodexSchema from "./schema.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);

const encoder = new TextEncoder();

const encodeJsonl = (value: unknown) => encoder.encode(`${encodeUnknownJsonString(value)}\n`);

const decodeJson = Schema.decodeEffect(Schema.UnknownFromJsonString);
const isAccountRateLimitPlanType = Schema.is(
  CodexSchema.V2AccountRateLimitsUpdatedNotification__PlanType,
);
const isThreadMetadataUpdateParams = Schema.is(CodexSchema.V2ThreadMetadataUpdateParams);
const isItemStartedNotification = Schema.is(CodexSchema.V2ItemStartedNotification);

it("tracks Codex 0.146 app-server compatibility additions", () => {
  assert.equal(
    CodexSchema.CLIENT_REQUEST_METHODS["externalAgentConfig/import/recordHistory"],
    "externalAgentConfig/import/recordHistory",
  );
  assert.equal(isAccountRateLimitPlanType("ent26"), true);
  assert.equal(
    isThreadMetadataUpdateParams({
      threadId: "thread-1",
      isPinned: true,
    }),
    true,
  );
  assert.equal(
    isItemStartedNotification({
      threadId: "thread-1",
      turnId: "turn-1",
      startedAtMs: 1_721_234_567_890,
      item: {
        type: "commandExecution",
        id: "command-1",
        command: "node scripts/check.mjs",
        commandActions: [],
        cwd: "/workspace",
        status: "inProgress",
        pluginId: "openai/example",
        scriptPath: "scripts/check.mjs",
      },
    }),
    true,
  );
});

it.layer(NodeServices.layer)("effect-codex-app-server protocol", (it) => {
  it.effect(
    "encodes requests without a jsonrpc field and routes inbound requests and notifications",
    () =>
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({ stdio });

        const notificationDeferred =
          yield* Deferred.make<ReadonlyArray<CodexProtocol.CodexAppServerIncomingNotification>>();
        const requestDeferred =
          yield* Deferred.make<ReadonlyArray<CodexProtocol.CodexAppServerIncomingRequest>>();

        yield* transport.incomingNotifications.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.flatMap((notifications) => Deferred.succeed(notificationDeferred, notifications)),
          Effect.forkScoped,
        );

        yield* transport.incomingRequests.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.flatMap((requests) => Deferred.succeed(requestDeferred, requests)),
          Effect.forkScoped,
        );

        yield* transport.notify("initialized");
        assert.equal(yield* Queue.take(output), '{"method":"initialized"}\n');

        const initializeParams = {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        };

        const pendingInitialize = yield* transport
          .request("initialize", initializeParams)
          .pipe(Effect.forkScoped);
        assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
          id: 1,
          method: "initialize",
          params: initializeParams,
        });

        yield* Queue.offer(
          input,
          encodeJsonl({
            emittedAtMs: 1_721_234_567_890,
            method: "item/agentMessage/delta",
            params: {
              delta: "Hello from the mock peer.",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            id: 77,
            method: "item/tool/requestUserInput",
            params: {
              itemId: "item-approval-1",
              threadId: "thread-1",
              turnId: "turn-1",
              questions: [
                {
                  id: "approved",
                  header: "Approve",
                  question: "Continue?",
                },
              ],
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            id: 1,
            result: {
              userAgent: "mock-codex-app-server",
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            },
          }),
        );

        assert.deepEqual(yield* Fiber.join(pendingInitialize), {
          userAgent: "mock-codex-app-server",
          codexHome: "/tmp/codex-home",
          platformFamily: "unix",
          platformOs: "macos",
        });
        assert.deepEqual(yield* Deferred.await(notificationDeferred), [
          {
            emittedAtMs: 1_721_234_567_890,
            method: "item/agentMessage/delta",
            params: {
              delta: "Hello from the mock peer.",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          },
        ]);
        assert.deepEqual(yield* Deferred.await(requestDeferred), [
          {
            id: 77,
            method: "item/tool/requestUserInput",
            params: {
              itemId: "item-approval-1",
              threadId: "thread-1",
              turnId: "turn-1",
              questions: [
                {
                  id: "approved",
                  header: "Approve",
                  question: "Continue?",
                },
              ],
            },
          },
        ]);

        yield* transport.respond(77, {
          answers: {
            approved: {
              answers: ["yes"],
            },
          },
        });
        assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
          id: 77,
          result: {
            answers: {
              approved: {
                answers: ["yes"],
              },
            },
          },
        });

        yield* transport.respondError(
          78,
          CodexError.CodexAppServerRequestError.methodNotFound("x/test"),
        );
        assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
          id: 78,
          error: {
            code: -32601,
            message: "Method not found: x/test",
          },
        });
      }),
  );

  it.effect("keeps draining inbound messages while an onRequest handler is waiting", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        onRequest: () => Effect.never,
      });

      const notificationDeferred =
        yield* Deferred.make<CodexProtocol.CodexAppServerIncomingNotification>();
      yield* transport.incomingNotifications.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.flatMap((notifications) =>
          Deferred.succeed(notificationDeferred, Array.from(notifications)[0]!),
        ),
        Effect.forkScoped,
      );

      const pendingInitialize = yield* transport.request("initialize").pipe(Effect.forkScoped);
      assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
        id: 1,
        method: "initialize",
      });

      yield* Queue.offer(
        input,
        encodeJsonl({
          id: 77,
          method: "item/tool/requestUserInput",
          params: {
            itemId: "item-approval-1",
            threadId: "thread-1",
            turnId: "turn-1",
            questions: [],
          },
        }),
      );
      yield* Queue.offer(
        input,
        encodeJsonl({
          method: "x/after-blocked-request",
          params: {
            ok: true,
          },
        }),
      );
      yield* Queue.offer(
        input,
        encodeJsonl({
          id: 1,
          result: {
            userAgent: "mock-codex-app-server",
          },
        }),
      );

      assert.deepEqual(yield* Deferred.await(notificationDeferred), {
        method: "x/after-blocked-request",
        params: {
          ok: true,
        },
      });
      assert.deepEqual(yield* Fiber.join(pendingInitialize), {
        userAgent: "mock-codex-app-server",
      });
    }),
  );

  it.effect("keeps draining inbound messages while an onNotification handler is waiting", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        onNotification: () => Effect.never,
      });

      const pendingInitialize = yield* transport.request("initialize").pipe(Effect.forkScoped);
      assert.deepEqual(yield* decodeJson(yield* Queue.take(output)), {
        id: 1,
        method: "initialize",
      });

      yield* Queue.offer(
        input,
        encodeJsonl({
          method: "x/blocked-notification",
          params: {
            ok: true,
          },
        }),
      );
      yield* Queue.offer(
        input,
        encodeJsonl({
          id: 1,
          result: {
            userAgent: "mock-codex-app-server",
          },
        }),
      );

      const result = yield* Fiber.join(pendingInitialize).pipe(Effect.timeoutOption("1 second"));
      assert.equal(Option.isSome(result), true);
      if (Option.isSome(result)) {
        assert.deepEqual(result.value, {
          userAgent: "mock-codex-app-server",
        });
      }
    }),
  );

  it.effect("surfaces JSON encoding failures as protocol parse errors", () =>
    Effect.gen(function* () {
      const { stdio } = yield* makeInMemoryStdio();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({ stdio });

      const bigintError = yield* transport.notify("x/test", 1n).pipe(Effect.flip);
      assert.instanceOf(bigintError, CodexError.CodexAppServerProtocolParseError);
      assert.equal(bigintError.detail, "Failed to encode Codex App Server message");

      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const circularError = yield* transport.notify("x/test", circular).pipe(Effect.flip);
      assert.instanceOf(circularError, CodexError.CodexAppServerProtocolParseError);
      assert.equal(circularError.detail, "Failed to encode Codex App Server message");
    }),
  );

  it.effect(
    "fails the protocol with the typed limit error when one incoming line passes the byte cap",
    () =>
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const terminated = yield* Deferred.make<CodexError.CodexAppServerError>();
        const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
          stdio,
          maxIncomingLineBytes: 32,
          onTermination: (error) => Deferred.succeed(terminated, error).pipe(Effect.asVoid),
        });

        const pending = yield* transport.request("x/read").pipe(Effect.forkScoped);
        yield* Queue.take(output);

        // Neither chunk is individually over the limit. The reader has to
        // account for the retained prefix incrementally instead of waiting for
        // a newline and joining an unbounded peer-controlled string first.
        yield* Queue.offer(input, encoder.encode('{"id":1,"result":"'));
        yield* Queue.offer(input, encoder.encode("private-wire-sentinel-that-must-not-leak"));

        const error = yield* Fiber.join(pending).pipe(Effect.flip);
        assert.instanceOf(error, CodexError.CodexAppServerIncomingMessageTooLargeError);
        if (error instanceof CodexError.CodexAppServerIncomingMessageTooLargeError) {
          assert.equal(error.maxBytes, 32);
        }
        assert.equal(String(error).includes("private-wire-sentinel"), false);
        assert.equal(JSON.stringify(error).includes("private-wire-sentinel"), false);

        // The same typed error is what the protocol reports as its termination
        // cause, so callers see one consistent reason for the dead transport.
        const terminationError = yield* Deferred.await(terminated);
        assert.instanceOf(terminationError, CodexError.CodexAppServerIncomingMessageTooLargeError);
      }),
  );

  it.effect("counts fragmented multibyte input in UTF-8 bytes and accepts the exact cap", () =>
    Effect.gen(function* () {
      const wire = encodeJsonl({ id: 1, result: "\u{1F642}" });
      const lineBytes = wire.byteLength - 1;
      const emojiStart = wire.findIndex((byte) => byte === 0xf0);
      assert.notEqual(emojiStart, -1);

      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        maxIncomingLineBytes: lineBytes,
      });
      const pending = yield* transport.request("x/read").pipe(Effect.forkScoped);
      yield* Queue.take(output);

      // Split inside the four-byte scalar. Stream.decodeText must preserve it,
      // and the cap must measure the reconstructed UTF-8 line.
      const splitAt = emojiStart + 2;
      yield* Queue.offer(input, wire.slice(0, splitAt));
      yield* Queue.offer(input, wire.slice(splitAt));

      assert.equal(yield* Fiber.join(pending), "\u{1F642}");
    }),
  );

  it.effect("keeps reading notifications after onNotification defects", () =>
    Effect.gen(function* () {
      const { stdio, input } = yield* makeInMemoryStdio();
      const protocolEvents = yield* Ref.make<Array<CodexProtocol.CodexAppServerProtocolLogEvent>>(
        [],
      );
      const goodNotification =
        yield* Deferred.make<CodexProtocol.CodexAppServerIncomingNotification>();
      const badDiagnosticLogged = yield* Deferred.make<void>();

      yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
        stdio,
        logger: (event) =>
          Ref.update(protocolEvents, (current) => [...current, event]).pipe(
            Effect.andThen(() => {
              const payload =
                typeof event.payload === "object" && event.payload !== null
                  ? (event.payload as Record<string, unknown>)
                  : {};
              return event.stage === "decode_failed" && payload["method"] === "x/bad"
                ? Deferred.succeed(badDiagnosticLogged, undefined).pipe(Effect.asVoid)
                : Effect.void;
            }),
          ),
        onNotification: (notification) =>
          notification.method === "x/bad"
            ? Effect.die(new Error("defective notification callback"))
            : Deferred.succeed(goodNotification, notification).pipe(Effect.asVoid),
      });

      yield* Queue.offer(
        input,
        encodeJsonl({
          method: "x/bad",
          params: {
            secret: "must-not-be-logged",
          },
        }),
      );
      yield* Queue.offer(
        input,
        encodeJsonl({
          method: "x/good",
          params: {
            ok: true,
          },
        }),
      );

      assert.deepEqual(yield* Deferred.await(goodNotification), {
        method: "x/good",
        params: {
          ok: true,
        },
      });
      yield* Deferred.await(badDiagnosticLogged);

      const diagnostics = (yield* Ref.get(protocolEvents)).filter(
        (event) => event.stage === "decode_failed",
      );
      assert.equal(diagnostics.length, 1);
      const diagnosticPayload = diagnostics[0]?.payload as Record<string, unknown>;
      assert.equal(diagnosticPayload["method"], "x/bad");
      assert.equal(String(diagnosticPayload["cause"]).includes("must-not-be-logged"), false);
    }),
  );
});

describe("incoming line buffer", () => {
  const takeLines = (
    buffer: CodexProtocol.IncomingLineBuffer,
    chunk: string,
  ): ReadonlyArray<string> => {
    const result = CodexProtocol.appendIncomingChunk(buffer, chunk);
    assert.equal(result.ok, true);
    return result.ok ? result.lines : [];
  };

  const takeFlushedLine = (buffer: CodexProtocol.IncomingLineBuffer): string => {
    const result = CodexProtocol.flushIncomingLineBuffer(buffer);
    assert.equal(result.ok, true);
    return result.ok ? result.line : "";
  };

  it("assembles lines across arbitrary chunk boundaries without re-scanning", () => {
    const buffer = CodexProtocol.makeIncomingLineBuffer();
    const lines: string[] = [];
    lines.push(...takeLines(buffer, '{"a":'));
    assert.deepEqual(lines, []);
    assert.equal(buffer.pendingLength, 5);
    lines.push(...takeLines(buffer, '1}\r\n{"b":2}\n{"c"'));
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
    assert.equal(buffer.pendingLength, 4);
    lines.push(...takeLines(buffer, ":3}"));
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
    assert.equal(takeFlushedLine(buffer), '{"c":3}');
    assert.equal(buffer.pendingLength, 0);
    assert.deepEqual(takeLines(buffer, "\n\n"), ["", ""]);
  });

  it("handles a very large single-line message delivered in many chunks in linear time", () => {
    const buffer = CodexProtocol.makeIncomingLineBuffer();
    const chunk = "x".repeat(64 * 1024);
    const chunkCount = 4_096; // 256 MiB of characters on one line
    const startedAt = performance.now();
    let emitted: ReadonlyArray<string> = [];
    for (let index = 0; index < chunkCount; index += 1) {
      emitted = takeLines(buffer, chunk);
      assert.equal(emitted.length, 0);
    }
    emitted = takeLines(buffer, "\n");
    const elapsedMs = performance.now() - startedAt;
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.length, chunk.length * chunkCount);
    assert.equal(buffer.pendingLength, 0);
    // The quadratic implementation needed minutes for this input.
    assert.isBelow(elapsedMs, 10_000);
  });

  it("accepts a 96,000,000-byte line under the default cap", () => {
    // Regression for the operator's production thread: one `thread/resume`
    // response line of 95,153,363 characters must still be assembled. Upstream
    // Cafe Code's 64 MiB ceiling would reject it, so Club Code's default has to
    // stay above it.
    const buffer = CodexProtocol.makeIncomingLineBuffer();
    assert.equal(buffer.maxBytes, CodexProtocol.DEFAULT_CODEX_APP_SERVER_MAX_INCOMING_LINE_BYTES);
    assert.isAbove(CodexProtocol.DEFAULT_CODEX_APP_SERVER_MAX_INCOMING_LINE_BYTES, 96_000_000);

    const chunk = "x".repeat(1_000_000);
    for (let index = 0; index < 96; index += 1) {
      assert.equal(takeLines(buffer, chunk).length, 0);
    }
    assert.equal(buffer.pendingBytes, 96_000_000);
    const emitted = takeLines(buffer, "\n");
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.length, 96_000_000);
    assert.equal(buffer.pendingBytes, 0);
  });

  it("leaves lines under the configured cap unaffected", () => {
    const buffer = CodexProtocol.makeIncomingLineBuffer(16);
    assert.equal(buffer.maxBytes, 16);
    assert.deepEqual(takeLines(buffer, '{"a":1}\n{"b":2}\n'), ['{"a":1}', '{"b":2}']);
    assert.deepEqual(takeLines(buffer, "0123456789abcdef\n"), ["0123456789abcdef"]);
    assert.equal(buffer.pendingBytes, 0);
  });

  it("falls back to the default cap for values that are not safe integers >= 1", () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      assert.equal(
        CodexProtocol.makeIncomingLineBuffer(invalid).maxBytes,
        CodexProtocol.DEFAULT_CODEX_APP_SERVER_MAX_INCOMING_LINE_BYTES,
      );
    }
    assert.equal(CodexProtocol.makeIncomingLineBuffer(1).maxBytes, 1);
  });

  it("measures the cap in UTF-8 bytes rather than UTF-16 code units", () => {
    // Two UTF-16 code units, four UTF-8 bytes: exactly at the cap.
    const withinCap = CodexProtocol.makeIncomingLineBuffer(4);
    assert.deepEqual(takeLines(withinCap, "\u{1F642}\n"), ["\u{1F642}"]);

    const overCap = CodexProtocol.makeIncomingLineBuffer(4);
    assert.equal(CodexProtocol.appendIncomingChunk(overCap, "\u{1F642}x\n").ok, false);
  });

  it("reports the typed limit error and releases the retained prefix mid-line", () => {
    const buffer = CodexProtocol.makeIncomingLineBuffer(32);
    assert.equal(takeLines(buffer, '{"id":1,"result":"').length, 0);
    assert.equal(buffer.pendingBytes, 18);

    const result = CodexProtocol.appendIncomingChunk(
      buffer,
      "private-wire-sentinel-that-must-not-leak",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.instanceOf(result.error, CodexError.CodexAppServerIncomingMessageTooLargeError);
      assert.equal(result.error.maxBytes, 32);
      assert.equal(result.error.message.includes("private-wire-sentinel"), false);
      assert.equal(JSON.stringify(result.error).includes("private-wire-sentinel"), false);
    }
    // The retained prefix is released immediately, so the cap is a real memory
    // bound rather than only a decode guard.
    assert.deepEqual(buffer.parts, []);
    assert.equal(buffer.pendingLength, 0);
    assert.equal(buffer.pendingBytes, 0);
  });

  it("reports the cap on the trailing flush when input ends inside an over-limit line", () => {
    const buffer = CodexProtocol.makeIncomingLineBuffer(8);
    assert.equal(CodexProtocol.appendIncomingChunk(buffer, "0123456789").ok, false);

    // Only a truncated fragment of that message was ever retained, so the final
    // flush must report the limit instead of handing back a partial line.
    const flushed = CodexProtocol.flushIncomingLineBuffer(buffer);
    assert.equal(flushed.ok, false);
    if (!flushed.ok) {
      assert.instanceOf(flushed.error, CodexError.CodexAppServerIncomingMessageTooLargeError);
      assert.equal(flushed.error.maxBytes, 8);
    }
    assert.equal(buffer.pendingBytes, 0);
    // The buffer stays usable for a caller that drops the line and warns.
    assert.deepEqual(takeLines(buffer, "ok\n"), ["ok"]);
  });

  it("resynchronizes on the next line boundary for a caller that drops and warns", () => {
    const buffer = CodexProtocol.makeIncomingLineBuffer(8);
    assert.equal(CodexProtocol.appendIncomingChunk(buffer, "over-limit-tail").ok, false);
    // Still inside the dropped line: nothing is emitted and the same line does
    // not raise a second error.
    assert.deepEqual(takeLines(buffer, "still-the-same-line"), []);
    // The terminator resynchronizes, and later lines survive intact.
    assert.deepEqual(takeLines(buffer, "\nnext\n"), ["next"]);
    assert.equal(buffer.pendingBytes, 0);
  });
});
