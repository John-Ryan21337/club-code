import type { EnvironmentApi, EnvironmentId, ProjectId } from "@cafecode/contracts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { readEnvironmentConnection, subscribeEnvironmentConnections } from "~/environments/runtime";
import { Button } from "./ui/button";

type Connection = NonNullable<ReturnType<typeof readEnvironmentConnection>>;
type DatabaseApi = Pick<NonNullable<EnvironmentApi["workspaceObservatory"]>, "tables" | "rows">;
type TableResult = Awaited<ReturnType<DatabaseApi["tables"]>>;
type RowResult = Awaited<ReturnType<DatabaseApi["rows"]>>;

interface Props {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly relativePath: string;
  readonly connection: Connection;
  readonly onClose: () => void;
}

export function WorkspaceDatabaseViewer(props: Props) {
  return (
    <DatabaseSession
      key={JSON.stringify([props.environmentId, props.projectId, props.relativePath])}
      {...props}
    />
  );
}

function DatabaseSession({ environmentId, projectId, relativePath, connection, onClose }: Props) {
  const currentConnection = useSyncExternalStore(subscribeEnvironmentConnections, () =>
    readEnvironmentConnection(environmentId),
  );
  const [tables, setTables] = useState<TableResult | null>(null);
  const [rows, setRows] = useState<RowResult | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const admission = useRef(false);
  const alive = useRef(true);
  const owner = useRef(connection);
  const cancelWait = useRef<(() => void) | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current += 1;
      cancelWait.current?.();
    };
  }, []);
  const connected = currentConnection === owner.current && connection === owner.current;
  const current = () =>
    alive.current &&
    connection === owner.current &&
    readEnvironmentConnection(environmentId) === owner.current;

  async function read(kind: "tables" | "rows", table?: string) {
    if (
      !current() ||
      admission.current ||
      (kind === "rows" && (!table || !tables?.tables.some((entry) => entry.name === table)))
    )
      return;
    admission.current = true;
    const request = ++epoch.current;
    setBusy(true);
    setError(null);
    setRows(null);
    if (kind === "tables") {
      setTables(null);
      setSelectedTable(null);
    } else setSelectedTable(table!);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const api = ensureEnvironmentApi(environmentId).workspaceObservatory;
      if (!api?.tables || !api.rows || !current()) throw new Error("unavailable");
      const operation =
        kind === "tables"
          ? api.tables({ projectId, relativePath })
          : api.rows({ projectId, relativePath, table: table!, limit });
      const result = await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          cancelWait.current = () => reject(new Error("closed"));
          timer = setTimeout(() => reject(new Error("deadline")), 20_000);
        }),
      ]);
      if (!current() || epoch.current !== request) return;
      if (result.relativePath !== relativePath) throw new Error("selection changed");
      if (kind === "tables" && "tables" in result) setTables(result);
      else if (kind === "rows" && "table" in result && result.table === table) setRows(result);
      else throw new Error("selection changed");
    } catch {
      if (current() && epoch.current === request)
        setError(
          "The read was refused or timed out. Retry after the database is stable. / 読み取りが拒否されたか、時間切れになりました。データベースが安定してから再試行してください。",
        );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      cancelWait.current = null;
      if (epoch.current === request) {
        admission.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }

  return (
    <article
      className="mt-3 min-w-0 rounded-xl border border-border/70 p-3"
      aria-label="Database preview / データベース表示"
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-all text-sm font-medium">
            {connected ? relativePath : "Database preview / データベース表示"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Read-only snapshot. Masking is best effort; private values can remain. /
            読み取り専用のスナップショットです。マスキングしても非公開の値が残る場合があります。
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close database / 閉じる
        </Button>
      </header>
      {!connected ? (
        <p role="status" className="mt-3 text-xs">
          Connection changed. Close this preview and reopen the observatory. /
          接続が変わりました。この表示を閉じ、観測画面を開き直してください。
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void read("tables")}>
              Load tables / テーブルを読む
            </Button>
            <label className="flex items-center gap-2 text-xs">
              Row limit / 行数上限
              <select
                aria-label="Row limit / 行数上限"
                className="rounded border bg-background p-1"
                value={limit}
                disabled={busy}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if ([25, 50, 100].includes(next)) setLimit(next);
                }}
              >
                {[25, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {selectedTable ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void read("rows", selectedTable)}
              >
                Refresh rows / 行を更新
              </Button>
            ) : null}
          </div>
          {busy ? (
            <p role="status" className="mt-2 text-xs">
              Reading snapshot… / スナップショットを読み取り中…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {tables ? (
            <>
              <div
                className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-auto"
                aria-label="Database tables / テーブル一覧"
              >
                {tables.tables.map((entry) => (
                  <Button
                    key={entry.name}
                    className="max-w-full break-all whitespace-normal"
                    size="sm"
                    variant={selectedTable === entry.name ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => void read("rows", entry.name)}
                  >
                    {entry.name}
                  </Button>
                ))}
              </div>
              {tables.tables.length === 0 ? (
                <p className="mt-2 text-xs">No readable tables. / 読めるテーブルがありません。</p>
              ) : null}
              {tables.truncated ? (
                <p className="mt-2 text-xs">Table list truncated. / テーブル一覧は一部のみです。</p>
              ) : null}
            </>
          ) : null}
          {rows ? (
            <>
              <p className="mt-3 break-all text-xs">
                {rows.table}: {rows.rows.length} rows / 行
              </p>
              {rows.redacted ? (
                <p className="mt-1 text-xs">
                  Some values were masked. / 一部の値をマスキングしました。
                </p>
              ) : null}
              {rows.truncated ? (
                <p className="mt-1 text-xs">
                  Preview truncated at a limit. / 上限により表示を省略しました。
                </p>
              ) : null}
              <div
                className="mt-2 max-h-80 max-w-full overflow-auto rounded border"
                tabIndex={0}
                role="region"
                aria-label="Database rows / データベースの行"
              >
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {rows.columns.map((column) => (
                        <th
                          key={column}
                          className="max-w-60 break-all border-b p-2 font-medium"
                          scope="col"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* These immutable display snapshots have no row identity or
                        editable state. Do not invent a primary key from values. */}
                    {rows.rows.map((row, index) => (
                      // eslint-disable-next-line react/no-array-index-key -- Snapshot positions are not persistent row identities.
                      <tr key={index}>
                        {row.map((cell, column) => (
                          <td
                            key={rows.columns[column]}
                            className="max-w-60 break-all whitespace-pre-wrap border-b p-2 align-top"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </article>
  );
}
