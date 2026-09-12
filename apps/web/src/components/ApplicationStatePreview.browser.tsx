import "../index.css";
import type { EnvironmentApi, EnvironmentId, ProjectId } from "@cafecode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../environmentApi";
import { ApplicationStatePreview } from "./ApplicationStatePreview";
import { WorkspaceObservatory } from "./WorkspaceObservatory";

const h = vi.hoisted(() => ({ connection: {} as object | null, listeners: new Set<() => void>() }));
vi.mock("../environments/runtime", () => ({
  readEnvironmentConnection: () => h.connection,
  subscribeEnvironmentConnections: (listener: () => void) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
  },
}));
const env = "operational-environment" as EnvironmentId;
const otherEnv = "other-operational-environment" as EnvironmentId;
const makeTables = () => ({
  database: "cafe-code-state" as const,
  tables: [{ name: "usage_stats_days" as const }, { name: "projection_state" as const }],
});
const makeRows = () => ({
  database: "cafe-code-state" as const,
  table: "usage_stats_days" as const,
  columns: ["day", "turns"],
  rows: [["2026-09-12", "17"]],
  truncated: false,
});
let api: { tables: ReturnType<typeof vi.fn>; rows: ReturnType<typeof vi.fn> };
const props = () => ({
  environmentId: env,
  connection: h.connection as Parameters<typeof ApplicationStatePreview>[0]["connection"],
});
const load = () =>
  page.getByRole("button", { name: "Load operational tables / 運用テーブルを読む" });
const usage = () => page.getByRole("button", { name: "Daily usage counters / 日次利用カウンター" });
function install(environmentId = env, applicationState: unknown = api) {
  __setEnvironmentApiOverrideForTests(environmentId, {
    applicationState,
    workspaceObservatory: {
      tree: async () => ({ relativePath: "", entries: [], truncated: false, redacted: false }),
    },
  } as unknown as EnvironmentApi);
}
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
  api = { tables: vi.fn(async () => makeTables()), rows: vi.fn(async () => makeRows()) };
  install();
});
afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  vi.restoreAllMocks();
});

describe("ApplicationStatePreview", () => {
  it("requires explicit global reads and sends no project or path, including changed limits", async () => {
    const screen = await render(
      <WorkspaceObservatory
        open
        environmentId={env}
        projectId={"project" as ProjectId}
        onOpenChange={() => undefined}
      />,
    );
    expect(api.tables).not.toHaveBeenCalled();
    expect(api.rows).not.toHaveBeenCalled();
    await load().click();
    expect(api.tables.mock.calls).toEqual([[]]);
    expect(api.rows).not.toHaveBeenCalled();
    await usage().click();
    await expect
      .element(page.getByRole("region", { name: "Operational rows / 運用行" }))
      .toBeVisible();
    expect(api.rows).toHaveBeenCalledWith({ table: "usage_stats_days", limit: 50 });
    expect(document.body.textContent).toContain("Server-wide counters");
    const limit = page
      .getByRole("combobox", { name: "Operational row limit / 運用行数の上限" })
      .element() as HTMLSelectElement;
    limit.value = "25";
    limit.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => document.body.textContent?.includes("2026-09-12")).toBe(false);
    expect(api.rows).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Read operational rows / 運用行を読む" }).click();
    expect(api.rows).toHaveBeenLastCalledWith({ table: "usage_stats_days", limit: 25 });
    await screen.unmount();
  });

  it("refuses stale controls synchronously and hides old rows on connection replacement", async () => {
    const original = props();
    const screen = await render(<ApplicationStatePreview {...original} />);
    await load().click();
    await usage().click();
    await expect.element(page.getByText("2026-09-12", { exact: true })).toBeVisible();
    const oldButton = usage().element() as HTMLButtonElement;
    h.connection = {};
    oldButton.click();
    expect(api.rows).toHaveBeenCalledTimes(1);
    for (const listener of h.listeners) listener();
    await expect.poll(() => document.body.textContent?.includes("2026-09-12")).toBe(false);
    await expect.poll(() => document.body.textContent?.includes("Connection changed.")).toBe(true);
    await screen.rerender(<ApplicationStatePreview {...props()} />);
    expect(document.body.textContent).not.toContain("2026-09-12");
    expect(api.rows).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it("resets an environment before paint and ignores the old pending rows", async () => {
    const pending = deferred<ReturnType<typeof makeRows>>();
    api.rows.mockImplementationOnce(() => pending.promise);
    const screen = await render(<ApplicationStatePreview {...props()} />);
    await load().click();
    await usage().click();
    install(otherEnv);
    await screen.rerender(<ApplicationStatePreview {...props()} environmentId={otherEnv} />);
    expect(document.body.textContent).not.toContain("Reading operational state");
    pending.resolve(makeRows());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.body.textContent).not.toContain("2026-09-12");
    expect(api.tables).toHaveBeenCalledTimes(1);
    await load().click();
    expect(api.tables).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });

  it("admits one pending read and releases its waiter when unmounted", async () => {
    const pending = deferred<ReturnType<typeof makeTables>>();
    api.tables.mockImplementationOnce(() => pending.promise);
    const screen = await render(<ApplicationStatePreview {...props()} />);
    const button = load().element() as HTMLButtonElement;
    button.click();
    button.click();
    expect(api.tables).toHaveBeenCalledTimes(1);
    await screen.unmount();
    pending.resolve(makeTables());
    const next = await render(<ApplicationStatePreview {...props()} />);
    expect(document.body.textContent).not.toContain("Daily usage counters");
    await load().click();
    await expect.element(usage()).toBeVisible();
    await next.unmount();
  });

  it("bounds the waiter and ignores late completion after a successful retry", async () => {
    const originalTimeout = window.setTimeout.bind(window);
    let deadline: (() => void) | undefined;
    vi.spyOn(window, "setTimeout").mockImplementation((handler, timeout, ...args) => {
      if (timeout === 20_000 && typeof handler === "function") deadline = () => handler(...args);
      return originalTimeout(handler, timeout, ...args) as unknown as ReturnType<
        typeof window.setTimeout
      >;
    });
    const pending = deferred<ReturnType<typeof makeRows>>();
    api.rows.mockImplementationOnce(() => pending.promise);
    const screen = await render(<ApplicationStatePreview {...props()} />);
    await load().click();
    await usage().click();
    expect(deadline).toBeDefined();
    deadline!();
    await expect.element(page.getByRole("alert")).toBeVisible();
    api.rows.mockResolvedValueOnce({ ...makeRows(), rows: [["fresh-result", "23"]] });
    await page.getByRole("button", { name: "Read operational rows / 運用行を読む" }).click();
    await expect.element(page.getByText("fresh-result", { exact: true })).toBeVisible();
    pending.resolve(makeRows());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.body.textContent).not.toContain("2026-09-12");
    expect(document.body.textContent).toContain("fresh-result");
    await screen.unmount();
  });

  it("shows a fixed unavailable error for old servers and never displays raw refusal data", async () => {
    install(env, null);
    const screen = await render(<ApplicationStatePreview {...props()} />);
    await load().click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    install();
    api.tables.mockRejectedValueOnce(new Error("secret-account-token private-database-path"));
    await load().click();
    expect(document.body.textContent).not.toContain("secret-account-token");
    expect(document.body.textContent).not.toContain("private-database-path");
    await screen.unmount();
  });

  it.each([
    { ...makeRows(), database: "other-state", rows: [["wrong-database", "1"]] },
    { ...makeRows(), table: "projection_state", rows: [["wrong-table", "1"]] },
  ])("rejects a mismatched result identity", async (response) => {
    api.rows.mockResolvedValueOnce(response);
    const screen = await render(<ApplicationStatePreview {...props()} />);
    await load().click();
    await usage().click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(document.body.textContent).not.toContain("wrong-database");
    expect(document.body.textContent).not.toContain("wrong-table");
    await screen.unmount();
  });

  it("contains bounded operational data and wrapped controls in a narrow pane", async () => {
    await page.viewport(420, 700);
    api.rows.mockResolvedValueOnce({
      ...makeRows(),
      columns: ["x".repeat(128)],
      rows: [["y".repeat(128)]],
      truncated: true,
    });
    const screen = await render(
      <div style={{ width: 320 }}>
        <ApplicationStatePreview {...props()} />
      </div>,
    );
    await load().click();
    await usage().click();
    await expect
      .element(page.getByText("Preview truncated at a limit.", { exact: false }))
      .toBeVisible();
    const section = page
      .getByRole("region", { name: "Application operational state / アプリケーションの運用状態" })
      .element();
    const bounds = section.getBoundingClientRect();
    for (const control of section.querySelectorAll("button,select")) {
      const rect = control.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
      expect(rect.right).toBeLessThanOrEqual(bounds.right);
    }
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth + 1);
    await screen.unmount();
  });
});
