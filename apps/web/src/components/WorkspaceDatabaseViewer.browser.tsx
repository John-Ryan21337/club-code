import "../index.css";
import type { EnvironmentApi, EnvironmentId, ProjectId } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../environmentApi";
import { WorkspaceDatabaseViewer } from "./WorkspaceDatabaseViewer";
import { WorkspaceObservatory } from "./WorkspaceObservatory";

const h = vi.hoisted(() => ({ connection: {} as object | null, listeners: new Set<() => void>() }));
vi.mock("../environments/runtime", () => ({
  readEnvironmentConnection: () => h.connection,
  subscribeEnvironmentConnections: (listener: () => void) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
  },
}));
const env = "database-environment" as EnvironmentId;
const project = "database-project" as ProjectId;
const path = " leading/state.sqlite";
const makeTables = (relativePath = path) => ({
  relativePath,
  tables: [{ name: "items" }, { name: "empty" }],
  truncated: true,
});
const makeRows = (relativePath = path, table = "items") => ({
  relativePath,
  table,
  columns: ["label", "value"],
  rows: [["Synthetic row", "[masked]"]],
  truncated: true,
  redacted: true,
});
let api: {
  tables: ReturnType<typeof vi.fn>;
  rows: ReturnType<typeof vi.fn>;
  tree: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
};
function install() {
  __setEnvironmentApiOverrideForTests(env, {
    workspaceObservatory: api,
  } as unknown as EnvironmentApi);
}
const props = () => ({
  environmentId: env,
  projectId: project,
  relativePath: path,
  connection: h.connection as Parameters<typeof WorkspaceDatabaseViewer>[0]["connection"],
  onClose: vi.fn(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  h.connection = {};
  h.listeners.clear();
  __resetEnvironmentApiOverridesForTests();
  api = {
    tables: vi.fn(async () => makeTables()),
    rows: vi.fn(async () => makeRows()),
    tree: vi.fn(async () => ({
      relativePath: "",
      entries: [{ name: "state.sqlite", relativePath: path, kind: "file" }],
      truncated: false,
      redacted: false,
    })),
    readFile: vi.fn(),
  };
  install();
});
afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  vi.restoreAllMocks();
});

describe("WorkspaceDatabaseViewer", () => {
  it("reads only explicit selections with bounded row limits and fixed snapshot flags", async () => {
    const screen = await render(<WorkspaceDatabaseViewer {...props()} />);
    expect(api.tables).not.toHaveBeenCalled();
    expect(api.rows).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    expect(api.tables).toHaveBeenCalledExactlyOnceWith({ projectId: project, relativePath: path });
    await page.getByRole("button", { name: "items", exact: true }).click();
    expect(api.rows).toHaveBeenCalledExactlyOnceWith({
      projectId: project,
      relativePath: path,
      table: "items",
      limit: 50,
    });
    await expect.element(page.getByText("Synthetic row", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Some values were masked. / 一部の値をマスキングしました。"))
      .toBeVisible();
    await page.getByRole("combobox", { name: "Row limit / 行数上限" }).selectOptions("100");
    await page.getByRole("button", { name: "Refresh rows / 行を更新" }).click();
    expect(api.rows).toHaveBeenLastCalledWith({
      projectId: project,
      relativePath: path,
      table: "items",
      limit: 100,
    });
    await screen.unmount();
    expect(h.listeners.size).toBe(0);
  });

  it("clears a previous database synchronously and discards its late read", async () => {
    const pending = deferred<ReturnType<typeof makeRows>>();
    api.rows.mockReturnValue(pending.promise);
    const initial = props();
    const screen = await render(<WorkspaceDatabaseViewer {...initial} />);
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    await page.getByRole("button", { name: "items", exact: true }).click();
    await screen.rerender(<WorkspaceDatabaseViewer {...initial} relativePath="other.db" />);
    expect(document.body.textContent).not.toContain("items");
    pending.resolve(makeRows());
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("Synthetic row");
    expect(api.tables).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it("refuses stale controls before a connection notification and hides old private rows after it", async () => {
    const initial = props();
    const screen = await render(<WorkspaceDatabaseViewer {...initial} />);
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    await page.getByRole("button", { name: "items", exact: true }).click();
    await expect.element(page.getByText("Synthetic row", { exact: true })).toBeVisible();
    h.connection = {};
    (
      page.getByRole("button", { name: "Refresh rows / 行を更新" }).element() as HTMLButtonElement
    ).click();
    expect(api.rows).toHaveBeenCalledTimes(1);
    for (const notify of h.listeners) notify();
    await expect.element(page.getByText(/Connection changed\./)).toBeVisible();
    expect(document.body.textContent).not.toContain("Synthetic row");
    // Rebinding the component props cannot relabel the prior owner's rows.
    await screen.rerender(<WorkspaceDatabaseViewer {...props()} />);
    expect(document.body.textContent).not.toContain("Synthetic row");
    await screen.unmount();
  });

  it("rejects mismatched response identities and never renders raw failure text", async () => {
    api.tables.mockResolvedValueOnce(makeTables("wrong.sqlite"));
    const screen = await render(<WorkspaceDatabaseViewer {...props()} />);
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(document.body.textContent).not.toContain("items");
    api.tables.mockRejectedValueOnce(new Error("private-account-and-query"));
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    expect(document.body.textContent).not.toContain("private-account-and-query");
    await screen.unmount();
  });

  it("admits one pending read and cancels its UI waiter when closed", async () => {
    const pending = deferred<ReturnType<typeof makeTables>>();
    api.tables.mockReturnValue(pending.promise);
    const clear = vi.spyOn(window, "clearTimeout");
    const screen = await render(<WorkspaceDatabaseViewer {...props()} />);
    const button = page
      .getByRole("button", { name: "Load tables / テーブルを読む" })
      .element() as HTMLButtonElement;
    button.click();
    button.click();
    expect(api.tables).toHaveBeenCalledTimes(1);
    await screen.unmount();
    expect(clear).toHaveBeenCalled();
    pending.resolve(makeTables());
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("items");
  });

  it("keeps long cell values inside a scrollable table on a narrow viewport", async () => {
    await page.viewport(320, 720);
    api.rows.mockResolvedValue({
      ...makeRows(),
      columns: Array.from({ length: 40 }, (_, index) => "column" + index),
      rows: [Array.from({ length: 40 }, () => "<img src=private>" + "x".repeat(4000))],
    });
    const screen = await render(<WorkspaceDatabaseViewer {...props()} />);
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    await page.getByRole("button", { name: "items", exact: true }).click();
    const region = page.getByRole("region", { name: "Database rows / データベースの行" });
    await expect.element(region).toBeVisible();
    expect(region.element().querySelector("img")).toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    await screen.unmount();
    await page.viewport(1280, 720);
  });

  it("opens an explicitly selected tree database without treating it as text or polling it", async () => {
    const screen = await render(
      <WorkspaceObservatory
        open
        environmentId={env}
        projectId={project}
        onOpenChange={() => undefined}
      />,
    );
    await page.getByRole("button", { name: "state.sqlite", exact: true }).click();
    await expect
      .element(page.getByRole("article", { name: "Database preview / データベース表示" }))
      .toBeVisible();
    expect(api.readFile).not.toHaveBeenCalled();
    expect(api.tables).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    expect(api.tables).toHaveBeenCalledExactlyOnceWith({ projectId: project, relativePath: path });
    await page.getByRole("button", { name: "Close database / 閉じる" }).click();
    await expect
      .element(page.getByRole("article", { name: "Database preview / データベース表示" }))
      .not.toBeInTheDocument();
    await screen.unmount();
  });
});
