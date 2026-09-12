// @effect-diagnostics nodeBuiltinImport:off
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  APPLICATION_STATE_COLUMNS,
  APPLICATION_STATE_PREVIEW_PROGRAM,
  APPLICATION_STATE_PROJECTORS,
} from "./applicationStatePreviewProgram.ts";

export type ApplicationStateTable = keyof typeof APPLICATION_STATE_COLUMNS;
export interface ApplicationStateTables {
  readonly database: "cafe-code-state";
  readonly tables: ReadonlyArray<{ readonly name: ApplicationStateTable }>;
}
export interface ApplicationStateRows {
  readonly database: "cafe-code-state";
  readonly table: ApplicationStateTable;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly truncated: boolean;
}
export const APPLICATION_STATE_TIMEOUT_MS = 3000;
const OUTPUT_BYTES = 64 * 1024;
const PREFIX = "cafe-operational-state-";
const unavailable = () => new Error("The operational application state preview is unavailable.");
const tableNames = Object.keys(APPLICATION_STATE_COLUMNS) as ApplicationStateTable[];
const isTable = (value: unknown): value is ApplicationStateTable =>
  typeof value === "string" && tableNames.some((name) => name === value);

function validateResult(
  value: unknown,
  request: { operation: "tables" | "rows"; table?: ApplicationStateTable; limit?: number },
): ApplicationStateTables | ApplicationStateRows {
  if (!value || typeof value !== "object") throw unavailable();
  const result = value as Record<string, unknown>;
  if (result.database !== "cafe-code-state") throw unavailable();
  if (request.operation === "tables") {
    if (!Array.isArray(result.tables) || result.tables.length > 2) throw unavailable();
    const names = result.tables.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || !isTable((entry as { name?: unknown }).name))
        throw unavailable();
      return (entry as { name: ApplicationStateTable }).name;
    });
    if (new Set(names).size !== names.length) throw unavailable();
    return { database: "cafe-code-state", tables: names.map((name) => ({ name })) };
  }
  if (
    result.table !== request.table ||
    !isTable(result.table) ||
    typeof result.truncated !== "boolean" ||
    !Array.isArray(result.columns) ||
    !Array.isArray(result.rows) ||
    result.rows.length > (request.limit ?? 100)
  )
    throw unavailable();
  const columns = APPLICATION_STATE_COLUMNS[result.table];
  if (
    result.columns.length !== columns.length ||
    result.columns.some((name, index) => name !== columns[index])
  )
    throw unavailable();
  const rows = result.rows.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw unavailable();
    return row.map((cell: unknown, index) => {
      if (typeof cell !== "string" || cell.length > 128) throw unavailable();
      if (result.table === "usage_stats_days" && index === 0) {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(cell) ||
          !Number.isFinite(Date.parse(cell)) ||
          new Date(cell).toISOString().slice(0, 10) !== cell
        )
          throw unavailable();
      } else if (result.table === "projection_state" && index === 0) {
        if (!(APPLICATION_STATE_PROJECTORS as readonly string[]).includes(cell))
          throw unavailable();
      } else if (result.table === "projection_state" && index === 2) {
        if (
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(cell) ||
          !Number.isFinite(Date.parse(cell))
        )
          throw unavailable();
        const normalized = cell.replace(
          /(?:\.(\d{1,3}))?Z$/,
          (_, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`,
        );
        if (new Date(cell).toISOString() !== normalized) throw unavailable();
      } else if (!/^(?:0|[1-9]\d{0,15})$/.test(cell) || !Number.isSafeInteger(Number(cell)))
        throw unavailable();
      return cell;
    });
  });
  return {
    database: "cafe-code-state",
    table: result.table,
    columns: [...columns],
    rows,
    truncated: result.truncated,
  };
}

/** One shared reader per server. Auth is enforced by its RPC boundary both
 * before admission and before returning data; this worker never sees a token. */
export function createApplicationStatePreview(dbPath: string) {
  const filename = resolve(dbPath);
  let closed = false;
  let pending: Promise<ApplicationStateTables | ApplicationStateRows> | undefined;
  let stopChild: (() => void) | undefined;
  const run = async (request: {
    operation: "tables" | "rows";
    table?: ApplicationStateTable;
    limit?: number;
  }): Promise<ApplicationStateTables | ApplicationStateRows> => {
    let directory: string | undefined;
    const root = resolve(tmpdir());
    try {
      if (closed) throw unavailable();
      directory = await mkdtemp(join(root, PREFIX));
      if (closed) throw unavailable();
      return await new Promise((resolveResult, reject) => {
        const child = spawn(
          process.execPath,
          ["--max-old-space-size=128", "--eval", APPLICATION_STATE_PREVIEW_PROGRAM],
          {
            shell: false,
            windowsHide: true,
            cwd: directory,
            env: {
              ELECTRON_RUN_AS_NODE: "1",
              ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
              ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
            },
            stdio: ["pipe", "pipe", "ignore"],
          },
        );
        let invalid = false,
          stopped = false,
          bytes = 0;
        const chunks: Buffer[] = [];
        const stop = () => {
          invalid = true;
          if (stopped) return;
          stopped = true;
          try {
            child.kill("SIGKILL");
          } catch {}
        };
        stopChild = stop;
        const timer = setTimeout(stop, APPLICATION_STATE_TIMEOUT_MS);
        child.on("error", () => {
          invalid = true;
        });
        child.stdin.on("error", stop);
        child.stdout.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > OUTPUT_BYTES) {
            stop();
            return;
          }
          if (!invalid) chunks.push(chunk);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (stopChild === stop) stopChild = undefined;
          if (invalid || closed || code !== 0 || bytes === 0) {
            reject(unavailable());
            return;
          }
          try {
            resolveResult(
              validateResult(
                JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
                request,
              ),
            );
          } catch {
            reject(unavailable());
          }
        });
        child.stdin.end(JSON.stringify({ ...request, filename }));
      });
    } catch {
      throw unavailable();
    } finally {
      if (
        directory &&
        dirname(resolve(directory)) === root &&
        basename(directory).startsWith(PREFIX)
      ) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  };
  const execute = (request: {
    operation: "tables" | "rows";
    table?: ApplicationStateTable;
    limit?: number;
  }) => {
    if (closed || pending) return Promise.reject(unavailable());
    const operation = run(request).finally(() => {
      if (pending === operation) pending = undefined;
    });
    pending = operation;
    return operation;
  };
  return {
    tables: () => execute({ operation: "tables" }) as Promise<ApplicationStateTables>,
    rows: (input: { table: ApplicationStateTable; limit?: number }) => {
      const limit = input.limit ?? 100;
      if (!isTable(input.table) || !Number.isInteger(limit) || limit < 1 || limit > 100)
        return Promise.reject(unavailable());
      return execute({
        operation: "rows",
        table: input.table,
        limit,
      }) as Promise<ApplicationStateRows>;
    },
    close: async () => {
      closed = true;
      stopChild?.();
      await pending?.catch(() => undefined);
    },
  };
}
