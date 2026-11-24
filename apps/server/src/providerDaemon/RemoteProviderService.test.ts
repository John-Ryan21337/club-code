// @effect-diagnostics nodeBuiltinImport:off
import {
  PROVIDER_DAEMON_EVENTS_PATH,
  PROVIDER_DAEMON_HEALTH_PATH,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  EventId,
  TurnId,
  type ProviderSession,
} from "@cafecode/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as http from "node:http";

import {
  attachCommandIdToMutatingProviderDaemonRequest,
  isVoidProviderDaemonRpcMethod,
  makeRemoteListSessionsInventory,
  PROVIDER_DAEMON_MUTATING_RPC_TIMEOUT_MS,
  PROVIDER_DAEMON_PROMPT_ROUTING_READ_TIMEOUT_MS,
  ProviderDaemonRpcResponseError,
  providerDaemonRpcTimeoutMs,
  readEventStream,
  remoteProviderCursorProjectorForConfig,
  toRemoteRequestError,
  requireRemoteCodexOperation,
  makeRemoteProviderEventBridge,
} from "./RemoteProviderService.ts";
import {
  PROVIDER_DAEMON_RUNTIME_CURSOR_PROJECTOR,
  PROVIDER_SUPERVISOR_RUNTIME_CURSOR_PROJECTOR,
} from "./ProviderDaemonRuntimeCursor.ts";

describe("RemoteProviderService", () => {
  it("recovers idle streams only when authenticated health is ahead of the accepted cursor", async () => {
    const token = "provider-daemon-test-token-000000000000000000000000";
    const requestedCursors: Array<string | null> = [];
    const authorizations: Array<string | undefined> = [];
    const healthCursors: number[] = [];
    const cursorOnlyQueries: Array<string | null> = [];
    const createdAt = "2026-11-11T18:06:27.583Z";
    const eventRecord = (cursor: number): string =>
      JSON.stringify({
        cursor,
        emittedAt: createdAt,
        event: {
          provider: "claudeAgent",
          providerInstanceId: "claudeAgent",
          threadId: "replayed-thread",
          eventId: `replayed-event-${cursor}`,
          createdAt,
          type: "session.started",
          payload: {},
        },
      }) + "\n";
    const server = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === PROVIDER_DAEMON_HEALTH_PATH) {
        const probe = healthCursors.length;
        const eventCursor = probe < 2 ? 1 : 3;
        healthCursors.push(eventCursor);
        cursorOnlyQueries.push(url.searchParams.get("cursorOnly"));
        response.writeHead(probe === 2 ? 503 : 200, { "content-type": "application/json" });
        if (probe !== 0) {
          response.end(JSON.stringify({ eventCursor }));
          return;
        }
        // Older daemon: ignores the query and returns the full health shape.
        response.end(
          JSON.stringify({
            ok: true,
            mode: "provider-daemon",
            pid: 1,
            ppid: 0,
            version: "test",
            startedAt: createdAt,
            activeSessionCount: 1,
            configuredInstanceCount: 1,
            eventCursor,
          }),
        );
        return;
      }
      if (url.pathname !== PROVIDER_DAEMON_EVENTS_PATH) {
        response.writeHead(404).end();
        return;
      }
      requestedCursors.push(url.searchParams.get("after"));
      if (requestedCursors.length === 1) return;
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      if (requestedCursors.length === 2) {
        response.write(eventRecord(1));
      } else {
        response.end(eventRecord(2) + eventRecord(3));
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      assert.isNotNull(address);
      if (address === null || typeof address === "string") {
        throw new Error("The daemon test server did not bind a TCP port.");
      }
      const endpoint = { httpBaseUrl: `http://127.0.0.1:${address.port}`, token };
      let acceptedCursor = 0;
      const accepted: number[] = [];
      const options = {
        readAcceptedCursor: () => acceptedCursor,
        onRecord: async (record: { readonly cursor: number }) => {
          acceptedCursor = record.cursor;
          accepted.push(record.cursor);
        },
        idleIntervalMs: 20,
        signal: AbortSignal.timeout(5_000),
      };

      await expect(readEventStream(endpoint, options)).rejects.toThrow(
        "provider daemon event stream stalled",
      );
      assert.deepEqual(accepted, []);
      await expect(readEventStream(endpoint, options)).rejects.toThrow(
        "provider daemon event stream stalled",
      );
      assert.deepEqual(accepted, [1]);
      assert.deepEqual(healthCursors, [1, 1, 3, 3]);
      await readEventStream(endpoint, options);

      assert.deepEqual(requestedCursors, ["0", "0", "1"]);
      assert.deepEqual(accepted, [1, 2, 3]);
      assert.deepEqual(cursorOnlyQueries, ["1", "1", "1", "1"]);
      assert.deepEqual(
        authorizations,
        Array.from({ length: 7 }, () => `Bearer ${token}`),
      );
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  });

  it.effect(
    "holds replay until canonical ingestion subscribes even with an ancillary observer",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const bridge = yield* makeRemoteProviderEventBridge(2);
          const seen: string[] = [];
          yield* Stream.runForEach(bridge.streamEvents, (event) =>
            Effect.sync(() => seen.push(event.type)),
          ).pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          const base = {
            provider: ProviderDriverKind.make("claudeAgent"),
            providerInstanceId: ProviderInstanceId.make("claudeAgent"),
            threadId: ThreadId.make("replayed-thread"),
            turnId: TurnId.make("replayed-turn"),
            createdAt: "2026-11-11T18:06:27.583Z",
          };
          const replay = yield* Effect.gen(function* () {
            yield* bridge.awaitCanonicalConsumer;
            yield* bridge.publish({
              ...base,
              eventId: EventId.make("replayed-start"),
              type: "turn.started",
              payload: {},
            });
            yield* bridge.publish({
              ...base,
              eventId: EventId.make("replayed-completion"),
              type: "turn.completed",
              payload: { state: "completed" },
            });
          }).pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          assert.isUndefined(replay.pollUnsafe());
          assert.deepEqual(seen, []);
          const canonical = yield* bridge.subscribeCanonicalEvents();
          // Both records may publish before consumption begins: acquisition,
          // rather than a scheduler delay, must retain the terminal record.
          yield* Fiber.join(replay);
          const events = yield* Stream.runCollect(canonical.pipe(Stream.take(2)));
          assert.deepEqual(
            events.map((event) => event.type),
            ["turn.started", "turn.completed"],
          );
        }),
      ),
  );

  it("refuses new Codex operations before sending their payload to an older daemon", async () => {
    for (const method of ["codexThreadAttachments", "codexExperimental"] as const) {
      let sent = false;
      try {
        await requireRemoteCodexOperation(method, async () => ({}));
        sent = true;
      } catch (error) {
        assert.instanceOf(error, ProviderDaemonRpcResponseError);
      }
      assert.isFalse(sent);
      await requireRemoteCodexOperation(method, async () => ({
        supportedCodexOperations: [method],
      }));
    }
    await requireRemoteCodexOperation("listSessions", async () => {
      throw new Error("Ordinary reads must not request health.");
    });
  });
  it("gives attachment mutations stable command IDs but leaves reads unjournaled", () => {
    const payload = {
      threadId: ThreadId.make("thread-1"),
      providerInstanceId: ProviderInstanceId.make("codex"),
    };
    const read = attachCommandIdToMutatingProviderDaemonRequest({
      method: "codexThreadAttachments",
      payload: { ...payload, action: { kind: "list" } },
    });
    assert.isFalse("commandId" in read);
    const remove = attachCommandIdToMutatingProviderDaemonRequest({
      method: "codexThreadAttachments",
      payload: {
        ...payload,
        action: { kind: "remove", attachmentType: "note", identityKey: "key" },
      },
    });
    assert.equal(typeof remove.commandId, "string");
    assert.equal(
      attachCommandIdToMutatingProviderDaemonRequest(remove).commandId,
      remove.commandId,
    );
  });
  it("adds commandId to restartProviderRuntime daemon RPC requests", () => {
    const request = attachCommandIdToMutatingProviderDaemonRequest({
      method: "restartProviderRuntime",
      payload: {
        instanceId: ProviderInstanceId.make("codex"),
      },
    });

    assert.equal(request.method, "restartProviderRuntime");
    const commandId = request.commandId;
    assert.equal(typeof commandId, "string");
    if (commandId === undefined) {
      throw new Error("restartProviderRuntime request did not receive commandId");
    }
    assert.isAtLeast(commandId.length, 16);
  });

  it("adds commandId to goal mutation daemon RPC requests", () => {
    const request = attachCommandIdToMutatingProviderDaemonRequest({
      method: "setGoal",
      payload: {
        threadId: ThreadId.make("thread-1"),
        objective: "Finish the proof",
        status: "active",
        tokenBudget: null,
      },
    });

    assert.equal(request.method, "setGoal");
    assert.equal(typeof request.commandId, "string");
  });

  it("does not add commandId to read-only daemon RPC requests", () => {
    const request = attachCommandIdToMutatingProviderDaemonRequest({
      method: "listSessions",
      payload: {},
    });

    assert.equal(request.method, "listSessions");
    assert.isFalse("commandId" in request);
  });

  it("allows session and turn mutations to outlive the short daemon read timeout", () => {
    assert.equal(
      providerDaemonRpcTimeoutMs("startSession"),
      PROVIDER_DAEMON_MUTATING_RPC_TIMEOUT_MS,
    );
    assert.equal(providerDaemonRpcTimeoutMs("sendTurn"), PROVIDER_DAEMON_MUTATING_RPC_TIMEOUT_MS);
    assert.equal(providerDaemonRpcTimeoutMs("steerTurn"), PROVIDER_DAEMON_MUTATING_RPC_TIMEOUT_MS);
    assert.equal(
      providerDaemonRpcTimeoutMs("listSessions"),
      PROVIDER_DAEMON_PROMPT_ROUTING_READ_TIMEOUT_MS,
    );
    assert.equal(
      providerDaemonRpcTimeoutMs("getCapabilities"),
      PROVIDER_DAEMON_PROMPT_ROUTING_READ_TIMEOUT_MS,
    );
    assert.equal(
      providerDaemonRpcTimeoutMs("getInstanceInfo"),
      PROVIDER_DAEMON_PROMPT_ROUTING_READ_TIMEOUT_MS,
    );
    assert.isUndefined(providerDaemonRpcTimeoutMs("interruptTurn"));
    assert.isUndefined(providerDaemonRpcTimeoutMs("stopSession"));
    assert.isUndefined(providerDaemonRpcTimeoutMs("restartProviderRuntime"));
  });

  it("does not treat restartProviderRuntime as a void daemon RPC", () => {
    assert.isFalse(isVoidProviderDaemonRpcMethod("restartProviderRuntime"));
    assert.isTrue(isVoidProviderDaemonRpcMethod("stopSession"));
    assert.isTrue(isVoidProviderDaemonRpcMethod("rollbackConversation"));
  });

  it("uses a separate cursor for daemon to supervisor event bridging", () => {
    assert.equal(
      remoteProviderCursorProjectorForConfig({ providerDaemon: {} }),
      PROVIDER_DAEMON_RUNTIME_CURSOR_PROJECTOR,
    );
    assert.equal(
      remoteProviderCursorProjectorForConfig({ providerSupervisor: {} }),
      PROVIDER_SUPERVISOR_RUNTIME_CURSOR_PROJECTOR,
    );
  });

  it("reports a reachable daemon inventory as available", async () => {
    const session: ProviderSession = {
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      status: "running",
      runtimeMode: "full-access",
      threadId: ThreadId.make("thread-inventory"),
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    const listSessionsInventory = makeRemoteListSessionsInventory(() => Effect.succeed([session]));

    const inventory = await Effect.runPromise(listSessionsInventory());

    assert.isTrue(inventory.available);
    assert.deepEqual(inventory.sessions, [session]);
  });

  it("reports an unreachable daemon as unavailable instead of an empty session list", async () => {
    const listSessionsInventory = makeRemoteListSessionsInventory(() =>
      Effect.fail(toRemoteRequestError("listSessions", new Error("connect ECONNREFUSED"))),
    );

    const inventory = await Effect.runPromise(listSessionsInventory());

    assert.isFalse(inventory.available);
    assert.deepEqual(inventory.sessions, []);
  });

  it("retains a typed remote RPC error tag on adapter request errors", () => {
    const error = toRemoteRequestError(
      "getInstanceInfo",
      new ProviderDaemonRpcResponseError(
        "ProviderUnsupportedError",
        "ProviderUnsupportedError: provider instance is not configured",
      ),
    );

    assert.equal(error.remoteErrorTag, "ProviderUnsupportedError");
    assert.include(error.detail, "provider instance is not configured");
  });
});
