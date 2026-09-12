import "../index.css";
import type { EnvironmentApi, EnvironmentId, ProjectId } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../environmentApi";
import { WorkspaceDatabaseDiscovery } from "./WorkspaceDatabaseDiscovery";
import { WorkspaceObservatory } from "./WorkspaceObservatory";

const h = vi.hoisted(() => ({ connection: {} as object | null, listeners: new Set<() => void>() }));
vi.mock("../environments/runtime", () => ({
  readEnvironmentConnection: () => h.connection,
  subscribeEnvironmentConnections: (listener: () => void) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
  },
}));
const env = "discovery-environment" as EnvironmentId;
const project = "discovery-project" as ProjectId;
const result = () => ({
  databases: [{ relativePath: " nested/extensionless" }, { relativePath: "data/state.db" }],
  truncated: true,
  redacted: true,
});
let api: {
  databases: ReturnType<typeof vi.fn>;
  tree: ReturnType<typeof vi.fn>;
  tables: ReturnType<typeof vi.fn>;
  rows: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
};
const props = () => ({
  environmentId: env,
  projectId: project,
  connection: h.connection as Parameters<typeof WorkspaceDatabaseDiscovery>[0]["connection"],
  onSelect: vi.fn(),
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
    databases: vi.fn(async () => result()),
    tree: vi.fn(async () => ({ relativePath: "", entries: [], truncated: false, redacted: false })),
    tables: vi.fn(async (input: { relativePath: string }) => ({
      relativePath: input.relativePath,
      tables: [{ name: "items" }],
      truncated: false,
    })),
    rows: vi.fn(),
    readFile: vi.fn(),
  };
  __setEnvironmentApiOverrideForTests(env, {
    workspaceObservatory: api,
  } as unknown as EnvironmentApi);
});
afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  vi.restoreAllMocks();
});

describe("WorkspaceDatabaseDiscovery", () => {
  it("scans only after a click and selects exact paths without opening SQLite", async () => {
    const input = props();
    const screen = await render(<WorkspaceDatabaseDiscovery {...input} />);
    expect(api.databases).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    expect(api.databases).toHaveBeenCalledExactlyOnceWith({ projectId: project });
    await expect
      .element(
        page.getByText(
          "Scan is partial. A limit or unreadable path may have stopped it. / 検索結果は一部です。上限や読み取れないパスで終了した場合があります。",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByText("Some paths were withheld. / 一部のパスは表示しません。"))
      .toBeVisible();
    await page.getByRole("button", { name: "nested/extensionless", exact: true }).click();
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(" nested/extensionless");
    expect(api.tables).not.toHaveBeenCalled();
    expect(api.rows).not.toHaveBeenCalled();
    await screen.unmount();
    expect(h.listeners.size).toBe(0);
  });

  it("clears previous project results before paint and discards late scans", async () => {
    const input = props();
    const screen = await render(<WorkspaceDatabaseDiscovery {...input} />);
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    await expect
      .element(page.getByRole("button", { name: "data/state.db", exact: true }))
      .toBeVisible();
    const pending = deferred<ReturnType<typeof result>>();
    api.databases.mockReturnValueOnce(pending.promise);
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    await screen.rerender(
      <WorkspaceDatabaseDiscovery {...input} projectId={"other-project" as ProjectId} />,
    );
    expect(document.body.textContent).not.toContain("data/state.db");
    pending.resolve(result());
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("data/state.db");
    expect(api.databases).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });

  it("refuses stale connection controls before notification and hides private results afterward", async () => {
    const input = props();
    const screen = await render(<WorkspaceDatabaseDiscovery {...input} />);
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    const selected = page
      .getByRole("button", { name: "data/state.db", exact: true })
      .element() as HTMLButtonElement;
    h.connection = {};
    selected.click();
    (
      page
        .getByRole("button", { name: "Find SQLite files / SQLite を探す" })
        .element() as HTMLButtonElement
    ).click();
    expect(input.onSelect).not.toHaveBeenCalled();
    expect(api.databases).toHaveBeenCalledTimes(1);
    for (const notify of h.listeners) notify();
    await expect.element(page.getByText(/Connection changed\./)).toBeVisible();
    expect(document.body.textContent).not.toContain("data/state.db");
    await screen.rerender(<WorkspaceDatabaseDiscovery {...props()} />);
    expect(document.body.textContent).not.toContain("data/state.db");
    await screen.unmount();
  });

  it("admits one pending scan, refuses old results during rescan, and clears the waiter on close", async () => {
    const input = props();
    const screen = await render(<WorkspaceDatabaseDiscovery {...input} />);
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    const selected = page
      .getByRole("button", { name: "data/state.db", exact: true })
      .element() as HTMLButtonElement;
    const pending = deferred<ReturnType<typeof result>>();
    api.databases.mockReturnValueOnce(pending.promise);
    const scan = page
      .getByRole("button", { name: "Find SQLite files / SQLite を探す" })
      .element() as HTMLButtonElement;
    const cleared = vi.spyOn(window, "clearTimeout");
    scan.click();
    scan.click();
    selected.click();
    expect(api.databases).toHaveBeenCalledTimes(2);
    expect(input.onSelect).not.toHaveBeenCalled();
    await screen.unmount();
    expect(cleared).toHaveBeenCalled();
    pending.resolve(result());
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("data/state.db");
  });

  it("uses fixed errors and states the limits of an empty result", async () => {
    api.databases.mockRejectedValueOnce(new Error("private path and credential"));
    const screen = await render(<WorkspaceDatabaseDiscovery {...props()} />);
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(document.body.textContent).not.toContain("private path and credential");
    api.databases.mockResolvedValueOnce({ databases: [], truncated: true, redacted: false });
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    await expect
      .element(
        page.getByText(
          "No SQLite files found within scan limits. / 検索範囲内で SQLite ファイルが見つかりませんでした。",
        ),
      )
      .toBeVisible();
    await screen.unmount();
  });

  it("releases the UI waiter at its deadline and ignores an old result after retry", async () => {
    const pending = deferred<ReturnType<typeof result>>();
    api.databases.mockReturnValueOnce(pending.promise);
    const nativeSetTimeout = window.setTimeout.bind(window);
    let expire: (() => void) | undefined;
    vi.spyOn(window, "setTimeout").mockImplementation((handler, timeout, ...args) => {
      if (timeout === 20_000 && typeof handler === "function") expire = () => handler(...args);
      // Chromium returns a numeric handle; the shared test types also include Node timers.
      return nativeSetTimeout(handler, timeout, ...args) as unknown as ReturnType<
        typeof window.setTimeout
      >;
    });
    const screen = await render(<WorkspaceDatabaseDiscovery {...props()} />);
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    expect(expire).toBeDefined();
    expire!();
    await expect.element(page.getByRole("alert")).toBeVisible();
    api.databases.mockResolvedValueOnce({
      databases: [{ relativePath: "new.db" }],
      truncated: false,
      redacted: false,
    });
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    await expect.element(page.getByRole("button", { name: "new.db", exact: true })).toBeVisible();
    pending.resolve(result());
    await Promise.resolve();
    expect(document.body.textContent).not.toContain("data/state.db");
    expect(api.databases).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });

  it("keeps forty long synthetic paths inside a narrow result region", async () => {
    await page.viewport(320, 720);
    api.databases.mockResolvedValueOnce({
      databases: Array.from({ length: 40 }, (_, index) => ({
        relativePath: "fixture/" + "x".repeat(450) + index,
      })),
      truncated: true,
      redacted: false,
    });
    const screen = await render(<WorkspaceDatabaseDiscovery {...props()} />);
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    const list = page.getByRole("list", { name: "SQLite results / SQLite 検索結果" });
    await expect.element(list).toBeVisible();
    expect(list.element().querySelectorAll("button")).toHaveLength(40);
    expect(list.element().getBoundingClientRect().height).toBeLessThanOrEqual(210);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    await screen.unmount();
    await page.viewport(1280, 720);
  });

  it("opens a discovered extensionless database in the existing explicit viewer", async () => {
    const screen = await render(
      <WorkspaceObservatory
        open
        environmentId={env}
        projectId={project}
        onOpenChange={() => undefined}
      />,
    );
    expect(api.databases).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Find SQLite files / SQLite を探す" }).click();
    await page.getByRole("button", { name: "nested/extensionless", exact: true }).click();
    await expect
      .element(page.getByRole("article", { name: "Database preview / データベース表示" }))
      .toBeVisible();
    expect(api.tables).not.toHaveBeenCalled();
    expect(api.readFile).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Load tables / テーブルを読む" }).click();
    expect(api.tables).toHaveBeenCalledExactlyOnceWith({
      projectId: project,
      relativePath: " nested/extensionless",
    });
    await screen.unmount();
  });
});
