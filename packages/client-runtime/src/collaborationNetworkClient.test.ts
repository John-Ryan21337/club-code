import type {
  CollaborationNetworkClientFrame,
  CollaborationNetworkDeviceProof,
  CollaborationNetworkRequestFrame,
  CollaborationNetworkServerFrame,
  CollaborationTransportPage,
} from "@cafecode/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  COLLABORATION_NETWORK_COMMAND_PATH,
  COLLABORATION_NETWORK_SOCKET_PATH,
  type CollaborationNetworkClientConfig,
  type CollaborationNetworkSocket,
  type CollaborationNetworkSocketOpenInput,
  createCollaborationNetworkClient,
} from "./collaborationNetworkClient.ts";

const SESSION = "opaque.session_evidence-1";
const SERVER_ORIGIN = "https://cowork.example";
const CLIENT_ORIGIN = "https://club-code.example";

function page(sharedProjectId = "project-1"): CollaborationTransportPage {
  return {
    sharedProjectId,
    messages: [],
    mergedOrder: [],
    lanePositions: [],
    nextCursor: "cursor-1",
    hasMore: false,
  } as never;
}

class FakeSocket implements CollaborationNetworkSocket {
  readonly sent: string[] = [];
  readyState = 1;
  bufferedAmount = 0;
  closed: { code?: number; reason?: string } | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
    this.readyState = 3;
  }
}

function harness(overrides: Partial<CollaborationNetworkClientConfig> = {}) {
  let sequence = 0;
  let socketInput: CollaborationNetworkSocketOpenInput | null = null;
  const socket = new FakeSocket();
  const requestHttp = vi.fn(
    async (input: Parameters<CollaborationNetworkClientConfig["requestHttp"]>[0]) => {
      const request = JSON.parse(input.body) as CollaborationNetworkRequestFrame;
      const response: CollaborationNetworkServerFrame = {
        version: 1,
        type: "result",
        requestId: request.requestId,
        operation: request.operation,
        payload: page(),
      };
      return { status: 200, body: JSON.stringify(response) };
    },
  );
  const openSocket = vi.fn((input: CollaborationNetworkSocketOpenInput) => {
    socketInput = input;
    input.onOpen();
    return socket;
  });
  const config: CollaborationNetworkClientConfig = {
    serverOrigin: SERVER_ORIGIN,
    clientOrigin: CLIENT_ORIGIN,
    sessionEvidence: SESSION,
    createRequestId: () => `request-${++sequence}`,
    createDeviceProof: ({ requestId }) => ({
      deviceId: "device-1",
      deviceKeyId: "device-key-1",
      issuedAtMs: 1,
      nonce: `nonce-${requestId}`,
      signature: `signature-${requestId}`,
    }),
    requestHttp,
    openSocket,
    ...overrides,
  };
  return {
    client: createCollaborationNetworkClient(config),
    requestHttp,
    openSocket,
    socket,
    socketInput: () => socketInput as CollaborationNetworkSocketOpenInput | null,
  };
}

function replayRequest() {
  return {
    sharedProjectId: "project-1",
    cursor: null,
    kinds: ["operator-chat"],
  } as never;
}

describe("collaboration network client", () => {
  it("is disconnected and performs no I/O until connect is explicitly called", async () => {
    const test = harness();
    expect(test.client.state()).toBe("disconnected");
    expect(test.openSocket).not.toHaveBeenCalled();
    expect(test.requestHttp).not.toHaveBeenCalled();

    await expect(test.client.command("message.page", replayRequest())).rejects.toMatchObject({
      code: "not-connected",
    });
    expect(test.openSocket).not.toHaveBeenCalled();

    await test.client.connect();
    expect(test.client.state()).toBe("connected");
    expect(test.openSocket).toHaveBeenCalledTimes(1);
  });

  it("uses only fixed paths, exact origins, header credentials, and per-frame proofs", async () => {
    const proofs = vi.fn(({ requestId }: { readonly requestId: string }) => ({
      deviceId: "device-1",
      deviceKeyId: "key-1",
      issuedAtMs: 2,
      nonce: `nonce-${requestId}`,
      signature: `signature-${requestId}`,
    }));
    const test = harness({ createDeviceProof: proofs as never });
    await test.client.connect();
    await test.client.command("message.page", replayRequest());

    const socketCall = test.openSocket.mock.calls[0]?.[0];
    expect(socketCall).toMatchObject({
      url: `wss://cowork.example${COLLABORATION_NETWORK_SOCKET_PATH}`,
      headers: { Authorization: `Bearer ${SESSION}`, Origin: CLIENT_ORIGIN },
    });
    expect(socketCall?.url).not.toContain(SESSION);
    const httpCall = test.requestHttp.mock.calls[0]?.[0];
    expect(httpCall).toMatchObject({
      url: `${SERVER_ORIGIN}${COLLABORATION_NETWORK_COMMAND_PATH}`,
      headers: {
        Authorization: `Bearer ${SESSION}`,
        "Content-Type": "application/json",
        Origin: CLIENT_ORIGIN,
      },
    });
    expect(httpCall?.url).not.toContain(SESSION);
    expect(proofs).toHaveBeenCalledTimes(1);
    expect(JSON.parse(httpCall!.body)).not.toHaveProperty("userId");
    expect(JSON.parse(httpCall!.body)).not.toHaveProperty("role");
  });

  it("rejects non-exact, credentialed, and insecure non-loopback origins", () => {
    for (const serverOrigin of [
      "https://cowork.example/extra",
      "https://cowork.example/?query=1",
      "https://cowork.example/#fragment",
      "https://user:secret@cowork.example",
      "https://%63owork.example",
      "http://cowork.example",
      "http://[::ffff:127.0.0.1]",
    ]) {
      expect(() => harness({ serverOrigin })).toThrow(/exact|HTTPS/);
    }
    expect(() => harness({ clientOrigin: "http://club-code.example" })).toThrow(/HTTPS/);
    expect(() => harness({ serverOrigin: "http://127.0.0.1:3773" })).not.toThrow();
  });

  it("strictly correlates and decodes HTTP response frames without leaking evidence", async () => {
    const requestHttp = vi.fn(async () => ({
      status: 200,
      body: JSON.stringify({
        version: 1,
        type: "result",
        requestId: "wrong-request",
        operation: "message.page",
        payload: page(),
        unexpected: SESSION,
      }),
    }));
    const test = harness({ requestHttp });
    await test.client.connect();
    const failure = test.client.command("message.page", replayRequest());
    await expect(failure).rejects.toMatchObject({ code: "protocol-error" });
    await expect(failure).rejects.not.toThrow(SESSION);
  });

  it("binds HTTP status and response project to the request", async () => {
    for (const response of [
      {
        status: 503,
        body: JSON.stringify({
          version: 1,
          type: "result",
          requestId: "request-1",
          operation: "message.page",
          payload: page(),
        }),
      },
      {
        status: 200,
        body: JSON.stringify({
          version: 1,
          type: "result",
          requestId: "request-1",
          operation: "message.page",
          payload: page("project-2"),
        }),
      },
    ]) {
      const test = harness({ requestHttp: async () => response });
      await test.client.connect();
      await expect(test.client.command("message.page", replayRequest())).rejects.toMatchObject({
        code: "protocol-error",
      });
    }
  });

  it("rejects excess request properties before proof generation or network I/O", async () => {
    const proof = vi.fn();
    const test = harness({ createDeviceProof: proof });
    await test.client.connect();
    await expect(
      test.client.command("message.page", {
        sharedProjectId: "project-1",
        cursor: null,
        kinds: ["operator-chat"],
        principal: "forged-user",
      } as never),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(proof).not.toHaveBeenCalled();
    expect(test.requestHttp).not.toHaveBeenCalled();
  });

  it("delivers bounded replay pages and resolves only the matching result", async () => {
    const test = harness();
    const onPage = vi.fn();
    await test.client.connect();
    const result = test.client.subscribeReplay(replayRequest(), { onPage });
    await vi.waitFor(() => expect(test.socket.sent).toHaveLength(1));
    const sent = JSON.parse(test.socket.sent[0]!) as CollaborationNetworkRequestFrame;
    expect(sent.operation).toBe("message.subscribe-replay");

    test.socketInput()!.onMessage(
      JSON.stringify({
        version: 1,
        type: "replay-page",
        requestId: sent.requestId,
        page: page(),
      }),
    );
    expect(onPage).toHaveBeenCalledWith(page());
    test.socketInput()!.onMessage(
      JSON.stringify({
        version: 1,
        type: "result",
        requestId: sent.requestId,
        operation: "message.subscribe-replay",
        payload: {
          sharedProjectId: "project-1",
          deliveredBatches: 1,
          deliveredMessages: 0,
          nextCursor: "cursor-1",
          caughtUp: true,
        },
      }),
    );
    await expect(result).resolves.toMatchObject({ deliveredBatches: 1, caughtUp: true });
  });

  it("disconnects rather than delivering a replay page for another project", async () => {
    const test = harness();
    const onPage = vi.fn();
    await test.client.connect();
    const result = test.client.subscribeReplay(replayRequest(), { onPage });
    await vi.waitFor(() => expect(test.socket.sent).toHaveLength(1));
    const sent = JSON.parse(test.socket.sent[0]!) as CollaborationNetworkRequestFrame;
    test.socketInput()!.onMessage(
      JSON.stringify({
        version: 1,
        type: "replay-page",
        requestId: sent.requestId,
        page: page("project-2"),
      }),
    );
    await expect(result).rejects.toMatchObject({ code: "unavailable" });
    expect(onPage).not.toHaveBeenCalled();
    expect(test.client.state()).toBe("disconnected");
  });

  it("contains an asynchronous replay observer failure with one cancellation", async () => {
    const test = harness();
    await test.client.connect();
    const result = test.client.subscribeReplay(replayRequest(), {
      onPage: async () => {
        throw new Error(SESSION);
      },
    });
    await vi.waitFor(() => expect(test.socket.sent).toHaveLength(1));
    const sent = JSON.parse(test.socket.sent[0]!) as CollaborationNetworkRequestFrame;
    test.socketInput()!.onMessage(
      JSON.stringify({
        version: 1,
        type: "replay-page",
        requestId: sent.requestId,
        page: page(),
      }),
    );
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    expect(test.socket.sent.map((encoded) => JSON.parse(encoded))).toEqual([
      sent,
      { version: 1, type: "cancel", requestId: sent.requestId },
    ]);
  });

  it("sends one exact cancel frame and never reconnects after a close", async () => {
    const test = harness();
    const abort = new AbortController();
    await test.client.connect();
    const result = test.client.subscribeReplay(replayRequest(), {
      signal: abort.signal,
      onPage: () => undefined,
    });
    await vi.waitFor(() => expect(test.socket.sent).toHaveLength(1));
    const request = JSON.parse(test.socket.sent[0]!) as CollaborationNetworkRequestFrame;
    abort.abort();
    abort.abort();
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    const frames = test.socket.sent.map(
      (encoded) => JSON.parse(encoded) as CollaborationNetworkClientFrame,
    );
    expect(frames).toEqual([request, { version: 1, type: "cancel", requestId: request.requestId }]);

    test.socketInput()!.onClose();
    await Promise.resolve();
    expect(test.openSocket).toHaveBeenCalledTimes(1);
    expect(test.client.state()).toBe("disconnected");
  });

  it("allows an explicit retry after a synchronous socket-open failure", async () => {
    const socket = new FakeSocket();
    let attempts = 0;
    const test = harness({
      openSocket: (input) => {
        attempts += 1;
        if (attempts === 1) throw new Error(`unsafe transport detail: ${SESSION}`);
        input.onOpen();
        return socket;
      },
    });
    const first = test.client.connect();
    await expect(first).rejects.toMatchObject({ code: "unavailable" });
    await expect(first).rejects.not.toThrow(SESSION);
    await expect(test.client.connect()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("ignores late callbacks from an invalidated socket generation", async () => {
    const inputs: CollaborationNetworkSocketOpenInput[] = [];
    const sockets: FakeSocket[] = [];
    const test = harness({
      openSocket: (input) => {
        const opened = new FakeSocket();
        inputs.push(input);
        sockets.push(opened);
        input.onOpen();
        return opened;
      },
    });
    await test.client.connect();
    test.client.disconnect();
    await test.client.connect();

    inputs[0]!.onMessage("not-json");
    inputs[0]!.onError();
    inputs[0]!.onClose();
    inputs[0]!.onOpen();

    expect(test.client.state()).toBe("connected");
    expect(sockets[1]!.closed).toBeNull();
  });

  it("does not let late proof completion consume or release a new generation reservation", async () => {
    let resolveFirstProof!: (proof: CollaborationNetworkDeviceProof) => void;
    const firstProof = new Promise<CollaborationNetworkDeviceProof>((resolve) => {
      resolveFirstProof = resolve;
    });
    let proofCalls = 0;
    let resolveHttp!: () => void;
    const requestHttp = vi.fn(
      (input: Parameters<CollaborationNetworkClientConfig["requestHttp"]>[0]) =>
        new Promise<{ readonly status: number; readonly body: string }>((resolve) => {
          const request = JSON.parse(input.body) as CollaborationNetworkRequestFrame;
          resolveHttp = () =>
            resolve({
              status: 200,
              body: JSON.stringify({
                version: 1,
                type: "result",
                requestId: request.requestId,
                operation: request.operation,
                payload: page(),
              }),
            });
        }),
    );
    const proof = () => {
      proofCalls += 1;
      if (proofCalls === 1) return firstProof;
      return {
        deviceId: "device-1",
        deviceKeyId: "device-key-1",
        issuedAtMs: proofCalls,
        nonce: `nonce-${proofCalls}`,
        signature: `signature-${proofCalls}`,
      };
    };
    const test = harness({
      createRequestId: () => "request-same",
      createDeviceProof: proof,
      requestHttp,
    });
    await test.client.connect();
    const stale = test.client.command("message.page", replayRequest());
    await vi.waitFor(() => expect(proofCalls).toBe(1));
    test.client.disconnect();
    await test.client.connect();
    const current = test.client.command("message.page", replayRequest());
    await vi.waitFor(() => expect(requestHttp).toHaveBeenCalledTimes(1));

    resolveFirstProof({
      deviceId: "device-1",
      deviceKeyId: "device-key-1",
      issuedAtMs: 1,
      nonce: "nonce-stale",
      signature: "signature-stale",
    });
    await expect(stale).rejects.toMatchObject({ code: "not-connected" });
    await expect(test.client.command("message.page", replayRequest())).rejects.toMatchObject({
      code: "resource-exhausted",
    });
    resolveHttp();
    await expect(current).resolves.toMatchObject({ sharedProjectId: "project-1" });
  });

  it("reports a socket-loss abort as unavailable instead of caller cancellation", async () => {
    const requestHttp = vi.fn(
      (input: Parameters<CollaborationNetworkClientConfig["requestHttp"]>[0]) =>
        new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error(SESSION)), { once: true });
        }),
    );
    const test = harness({ requestHttp });
    await test.client.connect();
    const command = test.client.command("message.page", replayRequest());
    await vi.waitFor(() => expect(requestHttp).toHaveBeenCalledTimes(1));
    test.socketInput()!.onClose();
    await expect(command).rejects.toMatchObject({ code: "unavailable" });
  });

  it("aborts in-flight HTTP work when explicitly disconnected", async () => {
    const requestHttp = vi.fn(
      (input: Parameters<CollaborationNetworkClientConfig["requestHttp"]>[0]) =>
        new Promise<never>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error(SESSION)), { once: true });
        }),
    );
    const test = harness({ requestHttp });
    await test.client.connect();
    const command = test.client.command("message.page", replayRequest());
    await vi.waitFor(() => expect(requestHttp).toHaveBeenCalledTimes(1));
    test.client.disconnect();
    await expect(command).rejects.toMatchObject({ code: "cancelled" });
    await expect(command).rejects.not.toThrow(SESSION);
  });

  it("enforces subscription and in-flight bounds", async () => {
    const test = harness();
    await test.client.connect();
    const pending = Array.from({ length: 4 }, () =>
      test.client.subscribeReplay(replayRequest(), { onPage: () => undefined }),
    );
    await expect(
      test.client.subscribeReplay(replayRequest(), { onPage: () => undefined }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
    await vi.waitFor(() => expect(test.socket.sent).toHaveLength(4));
    test.client.disconnect();
    await Promise.all(
      pending.map(async (promise) => expect(promise).rejects.toBeInstanceOf(Error)),
    );
  });

  it("cancels every local subscription even when the first disconnect send fails", async () => {
    const test = harness();
    await test.client.connect();
    const pending = Array.from({ length: 2 }, () =>
      test.client.subscribeReplay(replayRequest(), { onPage: () => undefined }),
    );
    await vi.waitFor(() => expect(test.socket.sent).toHaveLength(2));
    test.socket.send = () => {
      throw new Error(SESSION);
    };
    test.client.disconnect();
    for (const result of pending) {
      await expect(result).rejects.toMatchObject({ code: "cancelled" });
    }
  });

  it("enforces the socket-buffer bound", async () => {
    const buffered = harness();
    buffered.socket.bufferedAmount = 2 * 1_024 * 1_024;
    await buffered.client.connect();
    await expect(
      buffered.client.subscribeReplay(replayRequest(), { onPage: () => undefined }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });

    const invalid = harness();
    invalid.socket.bufferedAmount = Number.NaN;
    await invalid.client.connect();
    await expect(
      invalid.client.subscribeReplay(replayRequest(), { onPage: () => undefined }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("closes on binary or malformed socket data without exposing public parsing detail", async () => {
    const test = harness();
    await test.client.connect();
    const pending = test.client.subscribeReplay(replayRequest(), { onPage: () => undefined });
    await vi.waitFor(() => expect(test.socket.sent).toHaveLength(1));
    test.socketInput()!.onMessage(new Uint8Array([1, 2, 3]));
    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
    expect(test.socket.closed).toEqual({ code: 1008, reason: "invalid response" });
    expect(test.client.state()).toBe("disconnected");
  });
});
