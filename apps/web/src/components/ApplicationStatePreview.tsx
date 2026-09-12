import type { EnvironmentApi, EnvironmentId } from "@cafecode/contracts";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { readEnvironmentConnection, subscribeEnvironmentConnections } from "~/environments/runtime";
import { Button } from "./ui/button";

type Connection = NonNullable<ReturnType<typeof readEnvironmentConnection>>;
type StateApi = NonNullable<EnvironmentApi["applicationState"]>;
type Table = Parameters<StateApi["rows"]>[0]["table"];
type TablesResult = Awaited<ReturnType<StateApi["tables"]>>;
type RowsResult = Awaited<ReturnType<StateApi["rows"]>>;
interface Props {
  readonly environmentId: EnvironmentId;
  readonly connection: Connection;
}

const tableLabels: Record<Table, string> = {
  usage_stats_days: "Daily usage counters / 日次利用カウンター",
  projection_state: "Projection status / 投影処理の状態",
};

/** The server authorizes each read; this view never sends a path or project. */
export function ApplicationStatePreview(props: Props) {
  return <StateSession key={props.environmentId} {...props} />;
}

function StateSession({ environmentId, connection }: Props) {
  const observed = useSyncExternalStore(subscribeEnvironmentConnections, () =>
    readEnvironmentConnection(environmentId),
  );
  const owner = useRef(connection);
  const alive = useRef(true);
  const admission = useRef(false);
  const epoch = useRef(0);
  const cancelWait = useRef<(() => void) | null>(null);
  const [tables, setTables] = useState<TablesResult | null>(null);
  const [rows, setRows] = useState<RowsResult | null>(null);
  const [selected, setSelected] = useState<Table | null>(null);
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current += 1;
      cancelWait.current?.();
    };
  }, []);
  const connected = observed === owner.current && connection === owner.current;
  const current = () =>
    alive.current &&
    connection === owner.current &&
    readEnvironmentConnection(environmentId) === owner.current;

  async function read(table?: Table) {
    if (
      !current() ||
      admission.current ||
      (table && !tables?.tables.some(({ name }) => name === table))
    )
      return;
    admission.current = true;
    const request = ++epoch.current;
    setBusy(true);
    setFailed(false);
    setRows(null);
    setSelected(table ?? null);
    if (!table) setTables(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const api = ensureEnvironmentApi(environmentId).applicationState;
      if (!api || !current()) throw new Error("unavailable");
      const response = await Promise.race([
        table ? api.rows({ table, limit }) : api.tables(),
        new Promise<never>((_resolve, reject) => {
          cancelWait.current = () => reject(new Error("closed"));
          timer = setTimeout(() => reject(new Error("deadline")), 20_000);
        }),
      ]);
      if (!current() || epoch.current !== request) return;
      if (response.database !== "cafe-code-state") throw new Error("selection changed");
      if (!table && "tables" in response) setTables(response);
      else if (table && "table" in response && response.table === table) setRows(response);
      else throw new Error("selection changed");
    } catch {
      if (current() && epoch.current === request) setFailed(true);
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
    <section
      className="min-w-0 rounded-xl border border-border/70 p-3 lg:col-span-2"
      aria-label="Application operational state / アプリケーションの運用状態"
    >
      <h3 className="text-sm font-medium">
        Application operational state / アプリケーションの運用状態
      </h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Server-wide counters and projection status. Requires an active owner session and a backend
        connection from loopback. Reads start only when selected. /
        サーバー全体のカウンターと投影処理の状態です。有効な所有者セッションと、バックエンドから見てループバック経由の接続が必要です。操作を選んだときだけ読み取ります。
      </p>
      {!connected ? (
        <p role="status" className="mt-3 text-xs">
          Connection changed. Reopen the observatory. /
          接続が変わりました。観測画面を開き直してください。
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="max-w-full whitespace-normal"
              disabled={busy}
              onClick={() => void read()}
            >
              Load operational tables / 運用テーブルを読む
            </Button>
            <label className="flex items-center gap-2 text-xs">
              Row limit / 行数上限
              <select
                aria-label="Operational row limit / 運用行数の上限"
                className="rounded border bg-background p-1"
                value={limit}
                disabled={busy}
                onChange={(event) => {
                  if (!current() || admission.current) return;
                  const next = Number(event.target.value);
                  if ([25, 50, 100].includes(next)) {
                    setLimit(next);
                    setRows(null);
                  }
                }}
              >
                {[25, 50, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void read(selected)}
              >
                Read operational rows / 運用行を読む
              </Button>
            ) : null}
          </div>
          {busy ? (
            <p role="status" className="mt-2 text-xs">
              Reading operational state… / 運用状態を読み取り中…
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              This read is unavailable, refused, or timed out. /
              この読み取りは利用できないか、拒否されたか、時間切れです。
            </p>
          ) : null}
          {tables ? (
            <div
              className="mt-3 flex flex-wrap gap-2"
              aria-label="Operational tables / 運用テーブル"
            >
              {tables.tables.map(({ name }) => (
                <Button
                  key={name}
                  size="sm"
                  variant={selected === name ? "default" : "outline"}
                  className="max-w-full whitespace-normal"
                  disabled={busy}
                  onClick={() => void read(name)}
                >
                  {tableLabels[name]}
                </Button>
              ))}
            </div>
          ) : null}
          {rows ? (
            <>
              <p className="mt-3 text-xs">
                {tableLabels[rows.table]}: {rows.rows.length} rows / 行
              </p>
              {rows.truncated ? (
                <p className="mt-1 text-xs">
                  Preview truncated at a limit. / 上限により表示を省略しました。
                </p>
              ) : null}
              <div
                className="mt-2 max-h-64 max-w-full overflow-auto rounded border"
                tabIndex={0}
                role="region"
                aria-label="Operational rows / 運用行"
              >
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {rows.columns.map((column, index) => (
                        <th
                          key={index}
                          scope="col"
                          className="max-w-60 break-all border-b p-2 font-medium"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.rows.map((row, index) => (
                      <tr key={index}>
                        {row.map((cell, column) => (
                          <td
                            key={column}
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
    </section>
  );
}
