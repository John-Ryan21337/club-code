import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  CoworkReplicaApplyPreviewPanel,
  type CoworkReplicaApplyPreviewClient,
} from "./CoworkReplicaApplyPreviewPanel";

const hashes = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(64, "0"));

function entry(relativePath = "src/shared.ts") {
  return {
    relativePath,
    action: "apply-version",
    outcome: "materialize-if-base-matches",
    expectedBaseSha256: hashes[10],
    contentSha256: hashes[11],
    byteCount: 128,
    databaseSnapshotSha256: null,
    conflictRef: null,
  };
}

function plan(entries: unknown[] = [entry()], nextCursor: string | null = null) {
  return {
    sharedProjectId: "project-one",
    deviceId: "device-one",
    membershipEpoch: 7,
    manifestRevision: 19,
    manifestHeadSha256: hashes[0],
    baseManifestSha256: hashes[1],
    fence: 23,
    planToken: hashes[2],
    planSha256: hashes[3],
    summary: {
      publishVersionCount: 0,
      applyVersionCount: 1,
      tombstoneCount: 0,
      databaseSnapshotCount: 0,
      skippedSidecarCount: 0,
      conflictCount: 0,
      noOverwriteCount: 0,
      totalEntryCount: 1,
      totalBytes: 128,
    },
    entries,
    nextCursor,
  };
}

function receipt(
  command: Parameters<CoworkReplicaApplyPreviewClient["approveReplicaApplyPlan"]>[0],
) {
  return {
    status: "accepted",
    commandId: command.commandId,
    sharedProjectId: command.sharedProjectId,
    deviceId: command.deviceId,
    membershipEpoch: command.membershipEpoch,
    manifestRevision: command.manifestRevision,
    manifestHeadSha256: command.manifestHeadSha256,
    baseManifestSha256: command.baseManifestSha256,
    fence: command.fence,
    planToken: command.planToken,
    planSha256: command.planSha256,
  };
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("CoworkReplicaApplyPreviewPanel", () => {
  it("is null-inert without an injected client", async () => {
    mounted = await render(
      <CoworkReplicaApplyPreviewPanel client={null} sharedProjectId="project-one" />,
    );
    expect(document.body.textContent?.trim()).toBe("");
    expect(document.querySelector("section")).toBeNull();
  });

  it("renders bound preview evidence and never claims it was applied", async () => {
    const entries = [
      {
        ...entry("data/account.db"),
        action: "database-snapshot",
        outcome: "immutable-snapshot-only",
        expectedBaseSha256: null,
        databaseSnapshotSha256: hashes[11],
      },
      {
        ...entry("data/account.db-shm"),
        action: "skip-volatile-sidecar",
        outcome: "skipped-volatile-sidecar",
        expectedBaseSha256: null,
        contentSha256: null,
        byteCount: 0,
      },
      {
        ...entry("old.txt"),
        action: "apply-tombstone",
        outcome: "delete-if-base-matches",
        contentSha256: null,
        byteCount: 0,
      },
      {
        ...entry("shared.txt"),
        action: "preserve-conflict",
        outcome: "preserve-local-and-record-conflict",
        conflictRef: hashes[12],
      },
      {
        ...entry("untracked.txt"),
        action: "no-overwrite",
        outcome: "preserve-local-no-overwrite",
      },
    ];
    const previewReplicaApplyPlan = vi.fn(async () => ({
      ...plan(entries),
      summary: {
        ...plan().summary,
        applyVersionCount: 0,
        tombstoneCount: 1,
        databaseSnapshotCount: 1,
        skippedSidecarCount: 1,
        conflictCount: 1,
        noOverwriteCount: 1,
        totalEntryCount: 5,
        totalBytes: 384,
      },
    }));
    mounted = await render(
      <CoworkReplicaApplyPreviewPanel
        client={{
          createCommandId: () => "command-one",
          previewReplicaApplyPlan,
          approveReplicaApplyPlan: vi.fn(),
        }}
        sharedProjectId="project-one"
      />,
    );

    await expect
      .element(page.getByRole("heading", { name: "data/account.db", exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Transfer immutable database snapshot only")).toBeVisible();
    await expect.element(page.getByText("Skip volatile database sidecar")).toBeVisible();
    await expect
      .element(page.getByText("Delete only if local base hash still matches"))
      .toBeVisible();
    await expect.element(page.getByText("Preserve local file and record conflict")).toBeVisible();
    await expect.element(page.getByText("Preserve local file; no overwrite")).toBeVisible();
    await expect
      .element(page.getByText("Preview only. Nothing in this panel is applied file truth."))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("successfully applied");
    expect(document.body.textContent).not.toContain("C:\\");
    expect(previewReplicaApplyPlan).toHaveBeenCalledWith(
      expect.objectContaining({ sharedProjectId: "project-one", cursor: null, limit: 50 }),
    );
  });

  it("loads every bounded page before enabling explicit approval", async () => {
    const first = {
      ...plan([entry("a.ts")], "next"),
      summary: { ...plan().summary, applyVersionCount: 2, totalEntryCount: 2, totalBytes: 256 },
    };
    const second = { ...plan([entry("b.ts")]), summary: first.summary };
    const previewReplicaApplyPlan = vi.fn(async ({ cursor }: { cursor: string | null }) =>
      cursor === null ? first : second,
    );
    mounted = await render(
      <CoworkReplicaApplyPreviewPanel
        client={{
          createCommandId: () => "command-one",
          previewReplicaApplyPlan,
          approveReplicaApplyPlan: vi.fn(),
        }}
        sharedProjectId="project-one"
      />,
    );
    await expect.element(page.getByRole("button", { name: "Load complete plan" })).toBeVisible();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    await page.getByRole("button", { name: "Load complete plan" }).click();
    await expect.element(page.getByText("b.ts")).toBeVisible();
    await expect.element(page.getByRole("checkbox")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve exact plan" })).toBeDisabled();
    await page.getByRole("checkbox").click();
    await expect.element(page.getByRole("button", { name: "Approve exact plan" })).toBeEnabled();
  });

  it("retries an indeterminate acknowledgement with the exact frozen command", async () => {
    const commands: unknown[] = [];
    let attempts = 0;
    const approveReplicaApplyPlan = vi.fn(
      async (
        command: Parameters<CoworkReplicaApplyPreviewClient["approveReplicaApplyPlan"]>[0],
      ) => {
        commands.push(command);
        attempts += 1;
        if (attempts === 1) throw new Error("socket closed after commit");
        return receipt(command);
      },
    );
    const createCommandId = vi.fn(() => "command-one");
    mounted = await render(
      <CoworkReplicaApplyPreviewPanel
        client={{
          createCommandId,
          previewReplicaApplyPlan: vi.fn(async () => plan()),
          approveReplicaApplyPlan,
        }}
        sharedProjectId="project-one"
      />,
    );
    await page.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Approve exact plan" }).click();
    await expect.element(page.getByRole("button", { name: "Retry exact approval" })).toBeVisible();
    await page.getByRole("button", { name: "Retry exact approval" }).click();
    await expect
      .element(page.getByText("Approval was accepted. This is not proof that files were applied."))
      .toBeVisible();
    expect(createCommandId).toHaveBeenCalledTimes(1);
    expect(approveReplicaApplyPlan).toHaveBeenCalledTimes(2);
    expect(commands[0]).toBe(commands[1]);
    expect(Object.isFrozen(commands[0])).toBe(true);
  });

  it("discards and refreshes when current authority changes", async () => {
    const previewReplicaApplyPlan = vi.fn(async () => plan());
    mounted = await render(
      <CoworkReplicaApplyPreviewPanel
        client={{
          createCommandId: () => "command-one",
          previewReplicaApplyPlan,
          approveReplicaApplyPlan: vi.fn(async () => ({ status: "authority-changed" })),
        }}
        sharedProjectId="project-one"
      />,
    );
    await page.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Approve exact plan" }).click();
    await expect.element(page.getByText(/Project authority changed/)).toBeVisible();
    await expect.poll(() => previewReplicaApplyPlan.mock.calls.length).toBe(2);
    await expect.element(page.getByRole("checkbox")).not.toBeChecked();
  });

  it("aborts stale project work and rejects invalid project ids before client work", async () => {
    const resolvers = new Map<string, (value: unknown) => void>();
    const signals = new Map<string, AbortSignal>();
    const client: CoworkReplicaApplyPreviewClient = {
      createCommandId: () => "command-one",
      previewReplicaApplyPlan: vi.fn(
        ({ sharedProjectId, signal }) =>
          new Promise((resolve) => {
            resolvers.set(sharedProjectId, resolve);
            signals.set(sharedProjectId, signal);
          }),
      ),
      approveReplicaApplyPlan: vi.fn(),
    };
    mounted = await render(
      <CoworkReplicaApplyPreviewPanel client={client} sharedProjectId="project-one" />,
    );
    await expect.poll(() => resolvers.has("project-one")).toBe(true);
    await mounted.rerender(
      <CoworkReplicaApplyPreviewPanel client={client} sharedProjectId="project-two" />,
    );
    await expect.poll(() => resolvers.has("project-two")).toBe(true);
    expect(signals.get("project-one")?.aborted).toBe(true);
    resolvers.get("project-one")?.(plan([entry("stale/private.ts")]));
    resolvers.get("project-two")?.({
      ...plan([entry("current/shared.ts")]),
      sharedProjectId: "project-two",
    });
    await expect.element(page.getByText("current/shared.ts")).toBeVisible();
    expect(document.body.textContent).not.toContain("stale/private.ts");

    await mounted.unmount();
    mounted = await render(
      <CoworkReplicaApplyPreviewPanel client={client} sharedProjectId="../escape" />,
    );
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(client.previewReplicaApplyPlan).toHaveBeenCalledTimes(2);
  });
});
