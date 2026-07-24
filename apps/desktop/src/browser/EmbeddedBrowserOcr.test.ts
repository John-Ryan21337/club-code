import { describe, expect, it, vi } from "vitest";

import {
  buildEmbeddedBrowserOcrChildEnv,
  makeEmbeddedBrowserOcrEngine,
  type EmbeddedBrowserOcrChild,
} from "./EmbeddedBrowserOcr.ts";

const input = {
  png: Buffer.from("bounded png"),
  width: 320,
  height: 200,
  language: "eng" as const,
};

describe("EmbeddedBrowserOcr", () => {
  it("passes only non-secret platform and locale variables to the OCR child", () => {
    expect(
      buildEmbeddedBrowserOcrChildEnv({
        SystemRoot: "C:\\Windows",
        TEMP: "C:\\Temp",
        LANG: "ja_JP.UTF-8",
        PATH: "secret-path",
        OPENAI_API_KEY: "secret-openai",
        ANTHROPIC_API_KEY: "secret-anthropic",
        HTTPS_PROXY: "http://secret-proxy",
        NODE_OPTIONS: "--require=secret.js",
      }),
    ).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      LANG: "ja_JP.UTF-8",
    });
  });

  it("caps result metadata and always terminates the isolated child", async () => {
    const terminate = vi.fn(async () => undefined);
    const startChild = vi.fn(
      (): EmbeddedBrowserOcrChild => ({
        result: Promise.resolve({ text: "visible words", confidence: 105 }),
        terminate,
      }),
    );
    const engine = makeEmbeddedBrowserOcrEngine({
      startChild,
      timeoutMs: 30_000,
      terminateTimeoutMs: 10,
    });

    await expect(engine.recognize(input)).resolves.toEqual({
      status: "completed",
      engine: "tesseract.js@7.0.0",
      language: "eng",
      confidence: 100,
      truncated: false,
      text: "visible words",
    });
    expect(startChild).toHaveBeenCalledWith(input);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("rejects oversized inputs before starting a child", async () => {
    const startChild = vi.fn();
    const engine = makeEmbeddedBrowserOcrEngine({
      startChild,
      timeoutMs: 30_000,
      terminateTimeoutMs: 10,
    });

    await expect(engine.recognize({ ...input, width: 2_048, height: 2_048 })).rejects.toThrow(
      "input limits",
    );
    expect(startChild).not.toHaveBeenCalled();
  });

  it("kills a never-settling child at the deadline and immediately reopens the one-child slot", async () => {
    vi.useFakeTimers();
    const firstTerminate = vi.fn(async () => undefined);
    const secondTerminate = vi.fn(async () => undefined);
    const startChild = vi
      .fn<() => EmbeddedBrowserOcrChild>()
      .mockReturnValueOnce({
        result: new Promise(() => undefined),
        terminate: firstTerminate,
      })
      .mockReturnValueOnce({
        result: Promise.resolve({ text: "recovered", confidence: 75 }),
        terminate: secondTerminate,
      });
    const engine = makeEmbeddedBrowserOcrEngine({
      startChild,
      timeoutMs: 10,
      terminateTimeoutMs: 10,
    });

    const timedOut = engine.recognize(input);
    const timedOutExpectation = expect(timedOut).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10);
    await timedOutExpectation;
    expect(firstTerminate).toHaveBeenCalledOnce();

    await expect(engine.recognize(input)).resolves.toMatchObject({
      status: "completed",
      text: "recovered",
    });
    expect(secondTerminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("terminates active work during shutdown and rejects all later OCR actions", async () => {
    let rejectResult!: (error: Error) => void;
    const terminate = vi.fn(async () => {
      rejectResult(new Error("child terminated"));
    });
    const result = new Promise<{ text: string; confidence: number }>((_resolve, reject) => {
      rejectResult = reject;
    });
    const engine = makeEmbeddedBrowserOcrEngine({
      startChild: () => ({ result, terminate }),
      timeoutMs: 30_000,
      terminateTimeoutMs: 10,
    });
    const active = engine.recognize(input);
    const activeExpectation = expect(active).rejects.toThrow("child terminated");

    await engine.close();

    await activeExpectation;
    expect(terminate).toHaveBeenCalled();
    await expect(engine.recognize(input)).rejects.toThrow("shutting down");
  });

  it("returns after bounded cleanup and permanently fails closed if child exit is unconfirmed", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn(() => new Promise<void>(() => undefined));
    const engine = makeEmbeddedBrowserOcrEngine({
      startChild: () => ({
        result: Promise.resolve({ text: "done", confidence: 80 }),
        terminate,
      }),
      timeoutMs: 30_000,
      terminateTimeoutMs: 10,
    });

    const action = engine.recognize(input);
    await vi.advanceTimersByTimeAsync(10);
    await expect(action).resolves.toMatchObject({ status: "completed" });
    expect(terminate).toHaveBeenCalledOnce();
    await expect(engine.recognize(input)).rejects.toThrow("shutting down");
    vi.useRealTimers();
  });
});
