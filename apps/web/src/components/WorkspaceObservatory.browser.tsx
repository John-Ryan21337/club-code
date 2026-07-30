import { EnvironmentId } from "@cafecode/contracts";
import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

let fileSnapshots = ["export {};"];
let fileSnapshotIndex = 0;
let activitySnapshots: Array<{
  observations: Array<{
    agentId: string;
    threadId: string;
    operation: string;
    path: string;
    status: string;
    timestamp: string;
    attribution: "observed";
  }>;
}> = [{ observations: [] }];
let activitySnapshotIndex = 0;
let rowSnapshots = [
  {
    columns: ["id", "value"],
    identityColumns: [0],
    rows: [["1", "before"]],
    truncated: false,
    redacted: false,
  },
];
let rowSnapshotIndex = 0;
let visibilityOverride = false;

const api = {
  workspaceObservatory: {
    tree: vi.fn(async () => ({
      relativePath: "",
      entries: [{ name: "app.ts", relativePath: "app.ts", kind: "file" as const }],
      truncated: false,
      redacted: true,
    })),
    databases: vi.fn(async () => [
      { database: "club-code-state" as const, label: "Club Code state" },
    ]),
    activity: vi.fn(
      async () =>
        activitySnapshots[Math.min(activitySnapshotIndex++, activitySnapshots.length - 1)] ?? {
          observations: [],
        },
    ),
    readFile: vi.fn(async () => ({
      relativePath: "app.ts",
      content:
        fileSnapshots[Math.min(fileSnapshotIndex++, fileSnapshots.length - 1)] ?? "export {};",
      truncated: false,
    })),
    tables: vi.fn(async () => [{ name: "records", type: "table" as const }]),
    rows: vi.fn(async () => rowSnapshots[Math.min(rowSnapshotIndex++, rowSnapshots.length - 1)]!),
  },
};

vi.mock("~/environmentApi", () => ({ readEnvironmentApi: () => api }));

const { WorkspaceObservatory } = await import("./WorkspaceObservatory");

let mounted: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  if (visibilityOverride) Reflect.deleteProperty(document, "visibilityState");
  visibilityOverride = false;
  fileSnapshots = ["export {};"];
  fileSnapshotIndex = 0;
  activitySnapshots = [{ observations: [] }];
  activitySnapshotIndex = 0;
  rowSnapshots = [
    {
      columns: ["id", "value"],
      identityColumns: [0],
      rows: [["1", "before"]],
      truncated: false,
      redacted: false,
    },
  ];
  rowSnapshotIndex = 0;
  for (const method of Object.values(api.workspaceObservatory)) method.mockClear();
  document.body.innerHTML = "";
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  if (visibilityOverride) Reflect.deleteProperty(document, "visibilityState");
  visibilityOverride = false;
  document.body.innerHTML = "";
});

it("opens as a full workspace dialog with accessible attribution disclosure", async () => {
  mounted = await render(
    <WorkspaceObservatory
      open
      onOpenChange={vi.fn()}
      environmentId={EnvironmentId.make("environment-test")}
      workspaceRoot="/workspace"
    />,
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await expect.element(page.getByText(/not omniscience/)).toBeVisible();
  await expect.element(page.getByText(/Unattributed/)).toBeInTheDocument();
  await expect.element(page.getByText(/credential-like paths are omitted/)).toBeVisible();
  await page.getByRole("button", { name: "app.ts" }).click();
  await expect.element(page.getByText("export {};")).toBeVisible();

  for (let index = 0; index < 7; index += 1) {
    await page.getByRole("button", { name: "Add observatory pane" }).click();
  }
  expect(document.querySelectorAll('[aria-label^="Observatory pane "]')).toHaveLength(8);
  expect(document.querySelector('[aria-label="Add observatory pane"]')).toBeNull();
});

it("polls only visible open panes, pauses and resumes, shows bounded line changes, and cleans up", async () => {
  fileSnapshots = ["const value = 1;", "const value = 2;"];
  mounted = await render(
    <WorkspaceObservatory
      open
      onOpenChange={vi.fn()}
      environmentId={EnvironmentId.make("environment-live-test")}
      workspaceRoot="/workspace"
    />,
  );
  await page.getByRole("button", { name: "app.ts" }).click();
  await page.getByLabelText("Show live line changes").click();
  await page.getByLabelText("Live refresh cadence").selectOptions("1");
  await expect.poll(() => api.workspaceObservatory.readFile.mock.calls.length).toBeGreaterThan(1);
  await expect.element(page.getByText("Latest snapshot line changes (1)")).toBeVisible();
  await expect.element(page.getByText(/const value = 1; -> const value = 2;/)).toBeVisible();

  await page.getByRole("button", { name: "Pause live refresh" }).click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pausedCalls = api.workspaceObservatory.readFile.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  expect(api.workspaceObservatory.readFile).toHaveBeenCalledTimes(pausedCalls);
  await page.getByRole("button", { name: "Resume live refresh" }).click();
  await expect
    .poll(() => api.workspaceObservatory.readFile.mock.calls.length)
    .toBeGreaterThan(pausedCalls);

  let visibility: DocumentVisibilityState = "hidden";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  visibilityOverride = true;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const hiddenCalls = api.workspaceObservatory.readFile.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  expect(api.workspaceObservatory.readFile).toHaveBeenCalledTimes(hiddenCalls);
  visibility = "visible";
  await expect
    .poll(() => api.workspaceObservatory.readFile.mock.calls.length)
    .toBeGreaterThan(hiddenCalls);

  await mounted.unmount();
  mounted = null;
  const unmountedCalls = api.workspaceObservatory.readFile.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  expect(api.workspaceObservatory.readFile).toHaveBeenCalledTimes(unmountedCalls);
});

it("refreshes the visible tree for a new explicit observation and follows only that observed path", async () => {
  activitySnapshots = [
    { observations: [] },
    {
      observations: [
        {
          agentId: "agent-sol",
          threadId: "thread-1",
          operation: "write",
          path: "app.ts",
          status: "running",
          timestamp: "2026-07-23T12:00:00.000Z",
          attribution: "observed",
        },
      ],
    },
  ];
  mounted = await render(
    <WorkspaceObservatory
      open
      onOpenChange={vi.fn()}
      environmentId={EnvironmentId.make("environment-follow-test")}
      workspaceRoot="/workspace"
    />,
  );
  await page.getByLabelText("Live refresh cadence").selectOptions("1");
  await expect.element(page.getByRole("button", { name: "Follow agent-sol" })).toBeVisible();
  await page.getByRole("button", { name: "Follow agent-sol" }).click();
  await expect.element(page.getByText(/Following agent-sol at app.ts/)).toBeVisible();
  await expect
    .element(page.getByText(/Provider explicitly observed agent-sol at app.ts/))
    .toBeVisible();
  await expect.poll(() => api.workspaceObservatory.tree.mock.calls.length).toBeGreaterThan(1);
});

it("visualizes primary-key row changes while keeping row attribution unknown", async () => {
  rowSnapshots = [
    {
      columns: ["id", "value"],
      identityColumns: [0],
      rows: [["1", "before"]],
      truncated: false,
      redacted: false,
    },
    {
      columns: ["id", "value"],
      identityColumns: [0],
      rows: [
        ["1", "after"],
        ["2", "added"],
      ],
      truncated: false,
      redacted: false,
    },
  ];
  mounted = await render(
    <WorkspaceObservatory
      open
      onOpenChange={vi.fn()}
      environmentId={EnvironmentId.make("environment-rows-test")}
      workspaceRoot="/workspace"
    />,
  );
  await page.getByLabelText("Live refresh cadence").selectOptions("1");
  await page.getByRole("button", { name: "Club Code state" }).click();
  await page.getByRole("button", { name: /records/ }).click();
  await expect.element(page.getByText(/Primary-key identity proven: 2/)).toBeVisible();
  await expect.element(page.getByText(/row attribution is unknown/)).toBeVisible();
  await expect.element(page.getByText("changed row key [1] - columns value")).toBeVisible();
  await expect.element(page.getByText("added row key [2]")).toBeVisible();
});
