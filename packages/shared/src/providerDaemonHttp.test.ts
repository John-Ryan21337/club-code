// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
import * as http from "node:http";

import type { ProviderDaemonClientConfig } from "@cafecode/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { streamProviderDaemonNdjson } from "./providerDaemonHttp.ts";

const servers: http.Server[] = [];

async function serve(
  handler: (response: http.ServerResponse) => void,
): Promise<{ readonly endpoint: ProviderDaemonClientConfig; readonly close: () => Promise<void> }> {
  const server = http.createServer((_request, response) => handler(response));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test HTTP server did not bind a TCP port");
  }
  return {
    endpoint: {
      httpBaseUrl: `http://127.0.0.1:${address.port}`,
      token: "provider-daemon-test-token-000000000000000000000000",
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

describe("streamProviderDaemonNdjson", () => {
  it("rejects a truncated live response so a new stream can replay from the accepted cursor", async () => {
    let attempts = 0;
    let disconnect: (() => void) | undefined;
    const fixture = await serve((response) => {
      attempts += 1;
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      if (attempts === 1) {
        disconnect = () => response.destroy();
        response.write('{"cursor":1}\n{"private":"partial');
      } else {
        response.end('{"cursor":2}\n');
      }
    });
    const seen: string[] = [];
    await expect(
      streamProviderDaemonNdjson(fixture.endpoint, "/events?after=0", {
        onLine: (line) => {
          seen.push(line);
          disconnect?.();
        },
      }),
    ).rejects.toThrow("provider daemon event stream closed before completion");
    await streamProviderDaemonNdjson(fixture.endpoint, "/events?after=1", {
      onLine: (line) => {
        seen.push(line);
      },
    });
    expect(seen).toEqual(['{"cursor":1}', '{"cursor":2}']);
    expect(attempts).toBe(2);
  });

  it("finishes accepted async records after a clean HTTP end", async () => {
    const fixture = await serve((response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end('{"cursor":1}\n{"cursor":2}\n');
    });
    const seen: string[] = [];
    await streamProviderDaemonNdjson(fixture.endpoint, "/events", {
      onLine: async (line) => {
        await new Promise((resolve) => setImmediate(resolve));
        seen.push(line);
      },
    });
    expect(seen).toEqual(['{"cursor":1}', '{"cursor":2}']);
  });

  it("serializes async record handling and preserves order", async () => {
    const fixture = await serve((response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end('{"cursor":1}\n{"cursor":2}\n{"cursor":3}\n');
    });
    const seen: number[] = [];
    let activeHandlers = 0;
    let maxActiveHandlers = 0;

    await streamProviderDaemonNdjson(fixture.endpoint, "/events", {
      onLine: async (line) => {
        activeHandlers += 1;
        maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
        const cursor = Number.parseInt(line.match(/\d+/u)?.[0] ?? "0", 10);
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(cursor);
        activeHandlers -= 1;
      },
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(maxActiveHandlers).toBe(1);
  });

  it("does not reconnect when a record arrives during an idle probe", async () => {
    const responseReady = Promise.withResolvers<http.ServerResponse>();
    const fixture = await serve((response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.flushHeaders();
      responseReady.resolve(response);
    });
    const startedProbe = Promise.withResolvers<void>();
    const firstProbe = Promise.withResolvers<boolean>();
    const repeatedProbe = Promise.withResolvers<void>();
    const accepted = Promise.withResolvers<void>();
    let probes = 0;
    const seen: string[] = [];
    const reading = streamProviderDaemonNdjson(fixture.endpoint, "/events", {
      idleWatchdog: {
        intervalMs: 15,
        shouldReconnect: async () => {
          probes += 1;
          if (probes === 1) {
            startedProbe.resolve();
            return firstProbe.promise;
          }
          repeatedProbe.resolve();
          return false;
        },
      },
      onLine: (line) => {
        seen.push(line);
        accepted.resolve();
      },
    });
    const response = await responseReady.promise;
    await startedProbe.promise;
    response.write('{"cursor":1}\n');
    await accepted.promise;
    firstProbe.resolve(true);
    await repeatedProbe.promise;
    response.end('{"cursor":2}\n');
    await reading;
    expect(seen).toEqual(['{"cursor":1}', '{"cursor":2}']);
  });

  it("waits for in-flight acceptance before allowing reconnect after disconnect", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const disconnected = Promise.withResolvers<void>();
    const responseReady = Promise.withResolvers<http.ServerResponse>();
    const fixture = await serve((response) => {
      response.on("close", () => disconnected.resolve());
      response.write('{"cursor":1}\n{"cursor":2}\n');
      responseReady.resolve(response);
    });
    const seen: string[] = [];
    let probes = 0;
    let rejected = false;
    const reading = streamProviderDaemonNdjson(fixture.endpoint, "/events", {
      idleWatchdog: {
        intervalMs: 10,
        shouldReconnect: async () => {
          probes += 1;
          return true;
        },
      },
      onLine: async (line) => {
        entered.resolve();
        await release.promise;
        seen.push(line);
      },
    });
    void reading.catch(() => {
      rejected = true;
    });
    const response = await responseReady.promise;
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(probes).toBe(0);
    response.destroy();
    await disconnected.promise;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(rejected).toBe(false);
    release.resolve();
    await expect(reading).rejects.toThrow("provider daemon event stream closed before completion");
    expect(seen).toEqual(['{"cursor":1}']);
  });

  it("cancels an outstanding idle probe when the stream is aborted", async () => {
    const fixture = await serve(() => {});
    const startedProbe = Promise.withResolvers<void>();
    const abortedProbe = Promise.withResolvers<void>();
    const controller = new AbortController();
    const reading = streamProviderDaemonNdjson(fixture.endpoint, "/events", {
      signal: controller.signal,
      idleWatchdog: {
        intervalMs: 10,
        shouldReconnect: (signal) =>
          new Promise<boolean>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                abortedProbe.resolve();
                resolve(true);
              },
              { once: true },
            );
            startedProbe.resolve();
          }),
      },
      onLine: () => {},
    });
    await startedProbe.promise;
    controller.abort();
    await abortedProbe.promise;
    await expect(reading).rejects.toThrow("The operation was aborted");
  });

  it("honors abort after a clean HTTP end while record acceptance is pending", async () => {
    const fixture = await serve((response) => {
      response.writeHead(200, { connection: "close" });
      response.end('{"cursor":1}\n{"cursor":2}\n');
    });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const controller = new AbortController();
    const seen: string[] = [];
    const rejection = expect(
      streamProviderDaemonNdjson(fixture.endpoint, "/events", {
        signal: controller.signal,
        onLine: async (line) => {
          entered.resolve();
          await release.promise;
          seen.push(line);
        },
      }),
    ).rejects.toThrow("The operation was aborted");
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    release.resolve();
    await rejection;
    expect(seen).toEqual(['{"cursor":1}']);
  });

  it("decodes UTF-8 safely when a character is split across chunks", async () => {
    const encoded = Buffer.from('{"text":"🙂"}\n', "utf8");
    const emojiStart = encoded.indexOf(Buffer.from("🙂", "utf8"));
    const fixture = await serve((response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.write(encoded.subarray(0, emojiStart + 2));
      response.end(encoded.subarray(emojiStart + 2));
    });
    const seen: string[] = [];

    await streamProviderDaemonNdjson(fixture.endpoint, "/events", {
      onLine: (line) => {
        seen.push(line);
      },
    });

    expect(seen).toEqual(['{"text":"🙂"}']);
  });

  it("rejects a line before unbounded pending data can accumulate", async () => {
    const fixture = await serve((response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end(`${"x".repeat(65)}\n`);
    });

    await expect(
      streamProviderDaemonNdjson(fixture.endpoint, "/events", {
        maxLineBytes: 64,
        maxPendingBytes: 128,
        onLine: () => {},
      }),
    ).rejects.toThrow("exceeds 64 bytes");
  });

  it("yields to unrelated scheduler work during a complete-line burst", async () => {
    const fixture = await serve((response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end(
        Array.from({ length: 96 }, (_, index) => `{"cursor":${index + 1}}`).join("\n") + "\n",
      );
    });
    let schedulerProgress = false;
    let observedProgressBySecondBudget = false;
    setImmediate(() => {
      schedulerProgress = true;
    });

    await streamProviderDaemonNdjson(fixture.endpoint, "/events", {
      onLine: (line) => {
        if (line.includes('"cursor":33')) observedProgressBySecondBudget = schedulerProgress;
      },
    });

    expect(observedProgressBySecondBudget).toBe(true);
  });
});
