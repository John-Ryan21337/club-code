// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
import { addAbortListener } from "node:events";
import * as http from "node:http";

import type { ProviderDaemonClientConfig } from "@cafecode/contracts";

import { PROVIDER_PIPELINE_POLICY } from "./providerPipelinePolicy.ts";
import {
  addProviderBackendBridgeDiagnostics,
  recordProviderBackendBridgeLine,
  setProviderBackendBridgeDiagnostics,
} from "./providerPipelineDiagnostics.ts";

export interface ProviderDaemonHttpResponse {
  readonly statusCode: number;
  readonly body: string;
}

export interface ProviderDaemonJsonRequestOptions {
  readonly method?: "GET" | "POST";
  readonly body?: string;
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ProviderDaemonNdjsonRequestOptions {
  readonly headers?: Record<string, string>;
  readonly onLine: (line: string) => void | Promise<void>;
  readonly maxLineBytes?: number;
  readonly maxPendingBytes?: number;
  readonly signal?: AbortSignal;
  readonly idleWatchdog?: {
    readonly intervalMs: number;
    readonly shouldReconnect: (signal: AbortSignal) => Promise<boolean>;
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function requestOptions(
  endpoint: ProviderDaemonClientConfig,
  path: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
): http.RequestOptions {
  const url = new URL(
    path,
    endpoint.httpBaseUrl.endsWith("/") ? endpoint.httpBaseUrl : `${endpoint.httpBaseUrl}/`,
  );
  const common = {
    method,
    path: `${url.pathname}${url.search}`,
    headers,
  } satisfies http.RequestOptions;

  if (endpoint.transport === "ipc" && endpoint.socketPath !== undefined) {
    return {
      ...common,
      socketPath: endpoint.socketPath,
    };
  }

  return {
    ...common,
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port.length > 0 ? Number.parseInt(url.port, 10) : undefined,
  };
}

export function requestProviderDaemonJson(
  endpoint: ProviderDaemonClientConfig,
  path: string,
  options: ProviderDaemonJsonRequestOptions = {},
): Promise<ProviderDaemonHttpResponse> {
  const method = options.method ?? "GET";
  const body = options.body;
  const headers = {
    authorization: `Bearer ${endpoint.token}`,
    accept: "application/json",
    ...(body === undefined
      ? {}
      : {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body, "utf8")),
        }),
    ...options.headers,
  };

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        ...requestOptions(endpoint, path, method, headers),
        signal: options.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(options.timeoutMs ?? 30_000, () => {
      request.destroy(new Error("provider daemon request timed out"));
    });
    if (body !== undefined) {
      request.write(body);
    }
    request.end();
  });
}

export function streamProviderDaemonNdjson(
  endpoint: ProviderDaemonClientConfig,
  path: string,
  options: ProviderDaemonNdjsonRequestOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const maxLineBytes = Math.max(
      1,
      Math.trunc(options.maxLineBytes ?? PROVIDER_PIPELINE_POLICY.ndjsonMaxLineBytes),
    );
    const maxPendingBytes = Math.max(
      maxLineBytes,
      Math.trunc(options.maxPendingBytes ?? PROVIDER_PIPELINE_POLICY.ndjsonMaxPendingBytes),
    );
    let settled = false;
    let processing = false;
    let ended = false;
    let finishSettlement: (() => void) | undefined;
    let abortSubscription: ReturnType<typeof addAbortListener> | undefined;
    const idleWatchdog = options.idleWatchdog;
    const probeController = idleWatchdog === undefined ? undefined : new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastActivityAt = performance.now();
    let activityVersion = 0;
    let lastSocketBytesRead = 0;
    const noteActivity = (socketBytesRead?: number): void => {
      if (idleWatchdog === undefined) return;
      if (socketBytesRead !== undefined) lastSocketBytesRead = socketBytesRead;
      lastActivityAt = performance.now();
      activityVersion += 1;
    };
    const stopIdleWatchdog = (): void => {
      clearTimeout(idleTimer);
      probeController?.abort();
    };
    const settle = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      stopIdleWatchdog();
      abortSubscription?.[Symbol.dispose]();
      // Let an in-flight record finish before the caller uses its accepted
      // cursor to reconnect. The processing loop will leave buffered records
      // for replay as soon as it sees that this request has settled.
      if (processing) finishSettlement = complete;
      else complete();
    };
    const settleReject = (cause: unknown): void => settle(() => reject(cause));
    const request = http.request(
      requestOptions(endpoint, path, "GET", {
        authorization: `Bearer ${endpoint.token}`,
        accept: "application/x-ndjson",
        ...options.headers,
      }),
      (response) => {
        noteActivity(response.socket?.bytesRead);
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
          settleReject(
            new Error(`provider daemon stream failed with HTTP ${response.statusCode ?? 0}`),
          );
          response.resume();
          return;
        }

        let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let pauseStartedAt = 0;

        const beginPause = (): void => {
          response.pause();
          if (pauseStartedAt !== 0) return;
          pauseStartedAt = performance.now();
          addProviderBackendBridgeDiagnostics({ pauseCount: 1 });
        };
        const finishPause = (): void => {
          if (pauseStartedAt === 0) return;
          addProviderBackendBridgeDiagnostics({ pausedMs: performance.now() - pauseStartedAt });
          pauseStartedAt = 0;
        };

        const processPending = async (): Promise<void> => {
          if (processing || settled) return;
          processing = true;
          try {
            let turnRecords = 0;
            let turnBytes = 0;
            let turnStartedAt = performance.now();
            while (!settled) {
              const lineEnd = pending.indexOf(0x0a);
              if (lineEnd < 0) break;
              if (lineEnd > maxLineBytes) {
                throw new RangeError(`provider daemon NDJSON line exceeds ${maxLineBytes} bytes`);
              }
              const lineBuffer = pending.subarray(0, lineEnd);
              pending = pending.subarray(lineEnd + 1);
              setProviderBackendBridgeDiagnostics({ pendingBytes: pending.byteLength });
              recordProviderBackendBridgeLine(lineBuffer.byteLength);
              const line = lineBuffer.toString("utf8").trim();
              if (line.length > 0) {
                await options.onLine(line);
                addProviderBackendBridgeDiagnostics({ decodedRecordCount: 1 });
                turnRecords += 1;
                turnBytes += lineBuffer.byteLength;
              }
              if (
                turnRecords >= PROVIDER_PIPELINE_POLICY.workTurnMaxRecords ||
                turnBytes >= PROVIDER_PIPELINE_POLICY.workTurnMaxBytes ||
                performance.now() - turnStartedAt >= PROVIDER_PIPELINE_POLICY.workTurnMaxElapsedMs
              ) {
                await yieldToEventLoop();
                turnRecords = 0;
                turnBytes = 0;
                turnStartedAt = performance.now();
              }
            }
            // A socket can close while downstream acceptance is awaiting a
            // promise. Leave buffered records for the next replay.
            if (settled) return;
            if (pending.indexOf(0x0a) < 0 && pending.byteLength > maxLineBytes) {
              throw new RangeError(`provider daemon NDJSON line exceeds ${maxLineBytes} bytes`);
            }
            if (pending.byteLength > maxPendingBytes) {
              throw new RangeError(
                `provider daemon NDJSON pending data exceeds ${maxPendingBytes} bytes`,
              );
            }
            if (ended) {
              if (pending.byteLength > 0) {
                if (pending.byteLength > maxLineBytes) {
                  throw new RangeError(`provider daemon NDJSON line exceeds ${maxLineBytes} bytes`);
                }
                recordProviderBackendBridgeLine(pending.byteLength);
                const trailing = pending.toString("utf8").trim();
                pending = Buffer.alloc(0);
                setProviderBackendBridgeDiagnostics({ pendingBytes: 0 });
                if (trailing.length > 0) {
                  await options.onLine(trailing);
                  addProviderBackendBridgeDiagnostics({ decodedRecordCount: 1 });
                }
              }
              finishPause();
              settle(resolve);
              return;
            }
            if (
              pauseStartedAt !== 0 &&
              pending.byteLength <= PROVIDER_PIPELINE_POLICY.bridgeQueueLowWaterBytes
            ) {
              finishPause();
              response.resume();
            }
          } catch (cause) {
            addProviderBackendBridgeDiagnostics({ decodeFailureCount: 1 });
            finishPause();
            settleReject(cause);
            response.destroy();
            request.destroy();
          } finally {
            processing = false;
            noteActivity();
            finishSettlement?.();
          }
        };

        response.on("data", (chunk: Buffer) => {
          noteActivity(response.socket?.bytesRead);
          pending = pending.byteLength === 0 ? chunk : Buffer.concat([pending, chunk]);
          setProviderBackendBridgeDiagnostics({ pendingBytes: pending.byteLength });
          if (pending.byteLength > maxPendingBytes) {
            const error = new RangeError(
              `provider daemon NDJSON pending data exceeds ${maxPendingBytes} bytes`,
            );
            settleReject(error);
            response.destroy();
            request.destroy();
            return;
          }
          if (pending.byteLength >= PROVIDER_PIPELINE_POLICY.bridgeQueueHighWaterBytes) {
            beginPause();
          }
          void processPending();
        });
        response.on("error", settleReject);
        // `end` is the only clean HTTP body boundary. A daemon/IPC disconnect
        // may instead surface as `aborted` or `close`; leaving those unhandled
        // strands the caller in this promise and prevents cursor-based replay.
        // Keep the failure fixed and payload-free, including for partial lines.
        const rejectPrematureClose = (): void => {
          finishPause();
          settleReject(new Error("provider daemon event stream closed before completion"));
        };
        response.on("aborted", rejectPrematureClose);
        response.on("close", () => {
          if (!ended) rejectPrematureClose();
        });
        response.on("end", () => {
          ended = true;
          stopIdleWatchdog();
          void processPending();
        });
      },
    );

    request.on("error", settleReject);
    if (options.signal !== undefined) {
      // Keep this listener until record acceptance finishes, even after the
      // last HTTP body byte has arrived and Node has closed the request.
      abortSubscription = addAbortListener(options.signal, () => {
        const cause = new DOMException("The operation was aborted", "AbortError");
        settleReject(cause);
        request.destroy(cause);
      });
    }
    if (idleWatchdog !== undefined && probeController !== undefined) {
      request.on("socket", (socket) => {
        noteActivity(socket.bytesRead);
      });
      const canCheckIdle = (): boolean =>
        !settled && !ended && !request.destroyed && !options.signal?.aborted;
      const checkIdle = async (): Promise<void> => {
        if (!canCheckIdle()) return;
        const socket = request.socket;
        const socketBytesRead = socket?.bytesRead ?? 0;
        // Socket bytes include incomplete headers and framing that might
        // never reach an HTTP response or body callback.
        if (socketBytesRead !== lastSocketBytesRead) {
          noteActivity(socketBytesRead);
        }
        let nextCheckMs = idleWatchdog.intervalMs;
        try {
          const idleRemainingMs = idleWatchdog.intervalMs - (performance.now() - lastActivityAt);
          if (processing) return;
          if (idleRemainingMs > 0) {
            nextCheckMs = idleRemainingMs;
            return;
          }
          const version = activityVersion;
          const shouldReconnect = await idleWatchdog.shouldReconnect(probeController.signal);
          if (
            shouldReconnect &&
            canCheckIdle() &&
            !processing &&
            version === activityVersion &&
            request.socket === socket &&
            (socket?.bytesRead ?? 0) === socketBytesRead
          ) {
            const cause = new Error("provider daemon event stream stalled");
            settleReject(cause);
            request.destroy(cause);
          }
        } catch {
          // A failed probe provides no evidence that this stream has stalled.
          nextCheckMs *= 2;
        } finally {
          if (canCheckIdle()) {
            idleTimer = setTimeout(() => void checkIdle(), Math.ceil(nextCheckMs));
          }
        }
      };
      idleTimer = setTimeout(() => void checkIdle(), idleWatchdog.intervalMs);
    }
    request.end();
  });
}
