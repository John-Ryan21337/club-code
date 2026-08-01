import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  CoworkReplicaStatusPanel,
  type CoworkReplicaStatusClient,
} from "./CoworkReplicaStatusPanel";

const hashes = Array.from({ length: 12 }, (_, index) => index.toString(16).padStart(64, "0"));

function statusPage(sharedProjectId: string, relativePath = "data/project.db") {
  return {
    sharedProjectId,
    projectRevision: 12,
    nextCursor: null,
    entries: [
      {
        relativePath,
        manifestRevision: 12,
        head: {
          kind: "version",
          revisionId: hashes[0],
          contentSha256: hashes[1],
          auditRef: hashes[2],
        },
        forks: [{ revisionId: hashes[3], contentSha256: hashes[4], auditRef: hashes[5] }],
        recoverableTombstones: [
          { revisionId: hashes[6], contentSha256: null, auditRef: hashes[7] },
        ],
        conflictRefs: [hashes[8]],
        materialization: "recovery-preserved",
        operatorAttention: ["database-fork-needs-selection"],
      },
    ],
  };
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("CoworkReplicaStatusPanel", () => {
  it("renders nothing and performs no client work when the client is absent", async () => {
    mounted = await render(
      <CoworkReplicaStatusPanel client={null} sharedProjectId="project-one" />,
    );

    expect(document.body.textContent?.trim()).toBe("");
    expect(document.querySelector("section")).toBeNull();
  });

  it("renders project-scoped read-only heads, forks, recovery, and operator attention", async () => {
    const listReplicaStatus = vi.fn(async () => statusPage("project-one"));
    mounted = await render(
      <CoworkReplicaStatusPanel client={{ listReplicaStatus }} sharedProjectId="project-one" />,
    );

    await expect
      .element(page.getByRole("region", { name: "Shared project managed replica status" }))
      .toBeVisible();
    await expect.element(page.getByText("data/project.db")).toBeVisible();
    await expect.element(page.getByText("Manifest head")).toBeVisible();
    await expect.element(page.getByText("Preserved conflict fork")).toBeVisible();
    await expect.element(page.getByText("Recoverable tombstone")).toBeVisible();
    await expect.element(page.getByText("Operator attention required")).toBeVisible();
    await expect
      .element(page.getByText(/cannot delete, restore, materialize, or resolve/))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("C:\\");
    expect(document.body.textContent).not.toContain("/Users/");
    expect(listReplicaStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sharedProjectId: "project-one", cursor: null, limit: 50 }),
    );
  });

  it("renders accessible empty and fail-closed malformed states", async () => {
    const client: CoworkReplicaStatusClient = {
      listReplicaStatus: vi.fn(async () => ({
        sharedProjectId: "project-one",
        projectRevision: 0,
        entries: [],
        nextCursor: null,
      })),
    };
    mounted = await render(
      <CoworkReplicaStatusPanel client={client} sharedProjectId="project-one" />,
    );
    await expect
      .element(page.getByRole("status").getByText("No managed replica files are visible"))
      .toBeVisible();

    await mounted.unmount();
    mounted = await render(
      <CoworkReplicaStatusPanel
        client={{
          listReplicaStatus: vi.fn(async () => ({
            ...statusPage("project-one"),
            absolutePath: "C:\\private\\project.db",
          })),
        }}
        sharedProjectId="project-one"
      />,
    );
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(page.getByText("Replica status is unavailable.")).toBeVisible();
    expect(document.body.textContent).not.toContain("private");
  });

  it("rejects an invalid selected project before invoking the injected client", async () => {
    const listReplicaStatus = vi.fn(async () => statusPage("project-one"));
    mounted = await render(
      <CoworkReplicaStatusPanel
        client={{ listReplicaStatus }}
        sharedProjectId="../another-project"
      />,
    );
    await expect.element(page.getByRole("alert")).toBeVisible();
    expect(listReplicaStatus).not.toHaveBeenCalled();
  });

  it("aborts stale project requests and ignores their later response", async () => {
    const resolvers = new Map<string, (value: unknown) => void>();
    const signals = new Map<string, AbortSignal>();
    const listReplicaStatus = vi.fn(
      ({ sharedProjectId, signal }: { sharedProjectId: string; signal: AbortSignal }) =>
        new Promise<unknown>((resolve) => {
          resolvers.set(sharedProjectId, resolve);
          signals.set(sharedProjectId, signal);
        }),
    );
    const client = { listReplicaStatus };
    mounted = await render(
      <CoworkReplicaStatusPanel client={client} sharedProjectId="project-one" />,
    );
    await expect.poll(() => resolvers.has("project-one")).toBe(true);
    await mounted.rerender(
      <CoworkReplicaStatusPanel client={client} sharedProjectId="project-two" />,
    );
    await expect.poll(() => resolvers.has("project-two")).toBe(true);
    expect(signals.get("project-one")?.aborted).toBe(true);

    resolvers.get("project-one")?.(statusPage("project-one", "stale/private.ts"));
    resolvers.get("project-two")?.(statusPage("project-two", "current/shared.ts"));
    await expect.element(page.getByText("current/shared.ts")).toBeVisible();
    expect(document.body.textContent).not.toContain("stale/private.ts");
  });

  it("aborts an in-flight request when unmounted", async () => {
    let signal: AbortSignal | undefined;
    const client: CoworkReplicaStatusClient = {
      listReplicaStatus: vi.fn(
        ({ signal: requestSignal }) =>
          new Promise(() => {
            signal = requestSignal;
          }),
      ),
    };
    mounted = await render(
      <CoworkReplicaStatusPanel client={client} sharedProjectId="project-one" />,
    );
    await expect.poll(() => signal !== undefined).toBe(true);
    await mounted.unmount();
    mounted = null;
    expect(signal?.aborted).toBe(true);
  });
});
