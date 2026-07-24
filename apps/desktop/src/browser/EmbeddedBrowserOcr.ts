import { spawn } from "node:child_process";
import path from "node:path";

import {
  EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS,
  EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE,
  EMBEDDED_BROWSER_OCR_MAX_INPUT_PIXELS,
  EMBEDDED_BROWSER_OCR_MAX_PNG_BYTES,
  EMBEDDED_BROWSER_OCR_TIMEOUT_MS,
  type EmbeddedBrowserOcrResult,
} from "@cafecode/contracts";

export type EmbeddedBrowserOcrLanguage = "eng" | "jpn";

export interface EmbeddedBrowserOcrInput {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  readonly language: EmbeddedBrowserOcrLanguage;
}

interface EmbeddedBrowserOcrCompleted {
  readonly text: string;
  readonly confidence: number;
}

export interface EmbeddedBrowserOcrChild {
  readonly result: Promise<EmbeddedBrowserOcrCompleted>;
  readonly terminate: () => Promise<void>;
}

export interface EmbeddedBrowserOcrDependencies {
  readonly startChild: (input: EmbeddedBrowserOcrInput) => EmbeddedBrowserOcrChild;
  readonly timeoutMs: number;
  readonly terminateTimeoutMs: number;
}

export interface EmbeddedBrowserOcrEngine {
  readonly recognize: (input: EmbeddedBrowserOcrInput) => Promise<EmbeddedBrowserOcrResult>;
  readonly close: () => Promise<void>;
}

const OCR_CHILD_STDOUT_MAX_BYTES = 64 * 1_024;
const OCR_CHILD_TERMINATE_TIMEOUT_MS = 1_000;
const OCR_CHILD_ENV_ALLOWLIST = [
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
] as const;

export function buildEmbeddedBrowserOcrChildEnv(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1" };
  for (const key of OCR_CHILD_ENV_ALLOWLIST) {
    const value = environment[key];
    if (value !== undefined) childEnvironment[key] = value;
  }
  return childEnvironment;
}

function validateInput(input: EmbeddedBrowserOcrInput): void {
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width > EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE ||
    input.height > EMBEDDED_BROWSER_OCR_MAX_INPUT_EDGE ||
    input.width * input.height > EMBEDDED_BROWSER_OCR_MAX_INPUT_PIXELS ||
    input.png.byteLength < 1 ||
    input.png.byteLength > EMBEDDED_BROWSER_OCR_MAX_PNG_BYTES
  ) {
    throw new Error("The visible browser viewport exceeds the local OCR input limits.");
  }
}

function parseChildResult(raw: string): EmbeddedBrowserOcrCompleted {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The local OCR worker returned an invalid result.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { text?: unknown }).text !== "string" ||
    typeof (parsed as { confidence?: unknown }).confidence !== "number" ||
    !Number.isFinite((parsed as { confidence: number }).confidence)
  ) {
    throw new Error("The local OCR worker returned an invalid result.");
  }
  return {
    text: (parsed as { text: string }).text.slice(0, EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS + 1),
    confidence: (parsed as { confidence: number }).confidence,
  };
}

export function startEmbeddedBrowserOcrChild(
  input: EmbeddedBrowserOcrInput,
): EmbeddedBrowserOcrChild {
  const entrypoint = path.join(__dirname, "EmbeddedBrowserOcrWorker.cjs");
  const child = spawn(
    process.execPath,
    [
      "--max-old-space-size=384",
      entrypoint,
      input.language,
      String(input.width),
      String(input.height),
    ],
    {
      cwd: __dirname,
      env: buildEmbeddedBrowserOcrChildEnv(process.env),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    },
  );
  const stdoutChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stdoutOverflow = false;
  let settled = false;
  let rejectResult!: (error: Error) => void;
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const result = new Promise<EmbeddedBrowserOcrCompleted>((resolve, reject) => {
    rejectResult = reject;
    child.once("error", () => {
      reject(new Error("The local OCR worker could not start."));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutOverflow) {
        chunk.fill(0);
        return;
      }
      if (stdoutBytes + chunk.byteLength > OCR_CHILD_STDOUT_MAX_BYTES) {
        stdoutOverflow = true;
        for (const buffered of stdoutChunks) buffered.fill(0);
        stdoutChunks.length = 0;
        stdoutBytes = 0;
        chunk.fill(0);
        rejectResult(new Error("The local OCR worker output exceeded its limit."));
        child.kill("SIGKILL");
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.byteLength;
    });
    child.once("close", (code) => {
      settled = true;
      resolveExit();
      const stdout = Buffer.concat(stdoutChunks, stdoutBytes);
      try {
        if (code !== 0) {
          reject(new Error("The local OCR worker stopped without a result."));
        } else {
          resolve(parseChildResult(stdout.toString("utf8")));
        }
      } finally {
        stdout.fill(0);
        for (const chunk of stdoutChunks) chunk.fill(0);
        stdoutChunks.length = 0;
        stdoutBytes = 0;
      }
    });
  });
  child.stdin.once("error", () => undefined);
  child.stdin.end(input.png);

  return {
    result,
    terminate: async () => {
      if (settled) return;
      child.kill("SIGKILL");
      await exited;
    },
  };
}

async function terminateBounded(
  child: EmbeddedBrowserOcrChild,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      child.terminate().then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function makeEmbeddedBrowserOcrEngine(
  dependencies: EmbeddedBrowserOcrDependencies,
): EmbeddedBrowserOcrEngine {
  let activeChild: EmbeddedBrowserOcrChild | undefined;
  let closed = false;

  return {
    recognize: async (input) => {
      validateInput(input);
      if (closed) throw new Error("Local OCR is shutting down.");
      if (activeChild) throw new Error("A local OCR action is already running.");
      const child = dependencies.startChild(input);
      activeChild = child;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const recognized = await Promise.race([
          child.result,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Local OCR timed out.")),
              dependencies.timeoutMs,
            );
          }),
        ]);
        const truncated = recognized.text.length > EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS;
        const confidence = Math.min(100, Math.max(0, recognized.confidence));
        return {
          status: "completed",
          engine: "tesseract.js@7.0.0",
          language: input.language,
          confidence: Math.round(confidence * 10) / 10,
          truncated,
          text: recognized.text.slice(0, EMBEDDED_BROWSER_MAX_SNAPSHOT_TEXT_CHARS),
        };
      } finally {
        if (timer) clearTimeout(timer);
        const terminated = await terminateBounded(child, dependencies.terminateTimeoutMs);
        if (activeChild === child) {
          if (terminated) {
            activeChild = undefined;
          } else {
            closed = true;
          }
        }
      }
    },
    close: async () => {
      closed = true;
      const child = activeChild;
      if (!child) return;
      if (await terminateBounded(child, dependencies.terminateTimeoutMs)) {
        if (activeChild === child) activeChild = undefined;
      }
    },
  };
}

export const embeddedBrowserOcrEngine = makeEmbeddedBrowserOcrEngine({
  startChild: startEmbeddedBrowserOcrChild,
  timeoutMs: EMBEDDED_BROWSER_OCR_TIMEOUT_MS,
  terminateTimeoutMs: OCR_CHILD_TERMINATE_TIMEOUT_MS,
});
