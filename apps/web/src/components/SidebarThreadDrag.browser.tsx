import "../index.css";
import { EnvironmentId, ProjectId, ThreadId } from "@cafecode/contracts";
import { scopeProjectRef, scopeThreadRef } from "@cafecode/client-runtime";
import { page } from "vitest/browser";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  SidebarThreadDragProvider,
  SidebarThreadDropTarget,
  useSidebarThreadDragSource,
} from "./SidebarThreadDrag";

const harness = vi.hoisted(() => ({
  dispatch: vi.fn(),
  toast: vi.fn(),
  thread: {} as Record<string, unknown> | undefined,
  project: {} as Record<string, unknown> | undefined,
  connection: {} as object,
  dual: false,
}));
vi.mock("../environmentApi", () => ({
  readEnvironmentApi: () => ({ orchestration: { dispatchCommand: harness.dispatch } }),
}));
vi.mock("../environments/runtime", () => ({ readEnvironmentConnection: () => harness.connection }));
vi.mock("../store", () => ({
  useStore: { getState: () => ({}) },
  selectSidebarThreadSummaryByRef: () => harness.thread,
  selectProjectByRef: () => harness.project,
}));
vi.mock("../uiLocalization", () => ({
  useUiLocalization: () => ({
    t: (en: string, ja: string) => (harness.dual ? `${en} / ${ja}` : en),
  }),
}));
vi.mock("./ui/toast", () => ({ toastManager: { add: harness.toast } }));
const env = EnvironmentId.make("server-a");
const sourceRef = scopeThreadRef(env, ThreadId.make("thread-1"));
const targetRef = scopeProjectRef(env, ProjectId.make("project-b"));
function Source({ disabled = false }: { disabled?: boolean }) {
  return (
    <div
      data-testid="source"
      role="button"
      tabIndex={0}
      {...useSidebarThreadDragSource(sourceRef, disabled)}
      className="my-3 rounded-md border p-3"
    >
      <span>Thread in the wrong project</span>
      <button type="button">Archive</button>
    </div>
  );
}
const defaultRefs = [targetRef];
const noop = () => {};
function Fixture({ refs = defaultRefs, disabled = false, moved = noop } = {}) {
  return (
    <SidebarThreadDragProvider>
      <main style={{ width: 280 }} className="bg-background p-3 text-foreground">
        <Source disabled={disabled} />
        <SidebarThreadDropTarget projectRefs={refs} className="border p-2" onMoved={moved}>
          <span data-testid="target">Destination project</span>
        </SidebarThreadDropTarget>
      </main>
    </SidebarThreadDragProvider>
  );
}
beforeEach(() => {
  harness.dispatch.mockReset().mockResolvedValue(undefined);
  harness.toast.mockReset();
  harness.dual = false;
  harness.connection = {};
  harness.thread = { id: sourceRef.threadId, projectId: "project-a", archivedAt: null };
  harness.project = { id: targetRef.projectId, name: "Destination project" };
});
function drag(type: string, target: Element, dataTransfer: DataTransfer) {
  const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
  target.dispatchEvent(event);
  return event;
}
async function start() {
  const data = new DataTransfer();
  drag("dragstart", page.getByTestId("source").element(), data);
  await vi.waitFor(() => expect(data.types).toContain("application/x-club-code-thread"));
  return data;
}

it("moves exactly one thread, clears the worktree override, and opens the destination", async () => {
  const moved = vi.fn();
  const screen = await render(<Fixture moved={moved} />);
  const data = await start();
  const target = page.getByTestId("target").element();
  expect(data.getData("application/x-club-code-thread")).toBe("thread");
  expect(data.getData("text/plain")).toBe("");
  await vi.waitFor(() => expect(drag("dragover", target, data).defaultPrevented).toBe(true));
  await expect.element(page.getByRole("status")).toHaveTextContent("Release to move thread");
  drag("drop", target, data);
  drag("drop", target, data);
  await vi.waitFor(() => expect(moved).toHaveBeenCalledOnce());
  expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      type: "thread.meta.update",
      threadId: "thread-1",
      projectId: "project-b",
      worktreePath: null,
    }),
  );
  await expect.element(page.getByRole("status")).not.toBeInTheDocument();
  await screen.unmount();
});

it("moves a thread with a real browser pointer drag", async () => {
  const screen = await render(<Fixture />);
  await page.getByTestId("source").dropTo(page.getByTestId("target"));
  await vi.waitFor(() => expect(harness.dispatch).toHaveBeenCalledOnce());
  await screen.unmount();
});

it.each([
  "source",
  "foreign",
  "ambiguous",
  "external",
  "cancel",
  "connection",
  "moved",
  "deleted",
  "archived",
])("rejects a %s drop", async (kind) => {
  const refs =
    kind === "source"
      ? [scopeProjectRef(env, ProjectId.make("project-a"))]
      : kind === "foreign"
        ? [scopeProjectRef(EnvironmentId.make("server-b"), targetRef.projectId)]
        : kind === "ambiguous"
          ? [targetRef, scopeProjectRef(env, ProjectId.make("project-c"))]
          : [targetRef];
  const screen = await render(<Fixture refs={refs} />);
  const data = kind === "external" ? new DataTransfer() : await start();
  if (kind === "external") data.setData("application/x-club-code-thread", "thread");
  if (kind === "cancel") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  if (kind === "connection") harness.connection = {};
  if (kind === "moved") harness.thread!.projectId = "another-project";
  if (kind === "deleted") harness.project = undefined;
  if (kind === "archived") harness.thread!.archivedAt = "2026-09-19";
  drag("drop", page.getByTestId("target").element(), data);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(harness.dispatch).not.toHaveBeenCalled();
  await screen.unmount();
});

it("keeps the thread in place and hides private errors when a move fails", async () => {
  harness.dispatch.mockRejectedValue(new Error("private server path"));
  const moved = vi.fn();
  const screen = await render(<Fixture moved={moved} />);
  const data = await start();
  drag("drop", page.getByTestId("target").element(), data);
  await vi.waitFor(() => expect(harness.toast).toHaveBeenCalled());
  expect(JSON.stringify(harness.toast.mock.calls)).not.toContain("private server path");
  expect(moved).not.toHaveBeenCalled();
  await screen.unmount();
});

it("does not drag controls or a thread being renamed", async () => {
  const screen = await render(<Fixture />);
  const data = new DataTransfer();
  expect(
    drag("dragstart", page.getByRole("button", { name: "Archive", exact: true }).element(), data)
      .defaultPrevented,
  ).toBe(true);
  expect(data.types).toHaveLength(0);
  await screen.rerender(<Fixture disabled />);
  expect(page.getByTestId("source").element().getAttribute("draggable")).toBe("false");
  await screen.unmount();
});

it("fits the bilingual drop hint in a narrow sidebar", async () => {
  harness.dual = true;
  const screen = await render(<Fixture />);
  const data = await start();
  await vi.waitFor(() =>
    expect(drag("dragover", page.getByTestId("target").element(), data).defaultPrevented).toBe(
      true,
    ),
  );
  const status = page.getByRole("status");
  await expect.element(status).toBeVisible();
  expect(status.element().scrollWidth).toBeLessThanOrEqual(status.element().clientWidth);
  drag("dragend", page.getByTestId("source").element(), data);
  await expect.element(status).not.toBeInTheDocument();
  await screen.unmount();
});
