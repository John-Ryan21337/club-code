import "../../index.css";

import { CollaborationPresenceUpdate, SharedProjectId } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ProjectPresenceRoster } from "../../cowork/CoworkProjectPresenceRoster.tsx";
import type { ProjectPresenceSubscriptionClient } from "../../cowork/projectPresenceRoster.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodeUpdate = Schema.decodeUnknownSync(CollaborationPresenceUpdate);
const PROJECT_A = decodeProjectId("presence-project-browser-a");
const PROJECT_B = decodeProjectId("presence-project-browser-b");

type Mounted = Awaited<ReturnType<typeof render>>;
let mounted: Mounted | null = null;

function presenceSnapshot(project: typeof PROJECT_A, version: number, count: number) {
  return decodeUpdate({
    kind: "snapshot",
    snapshot: {
      sharedProjectId: project,
      version,
      entries: Array.from({ length: count }, (_, index) => ({
        sessionId: `s${String(index + 1).padStart(42, "0")}`,
        userId: `operator-${String(index + 1).padStart(2, "0")}`,
        deviceId: `device-${index + 1}`,
        membershipEpoch: 4,
        state: index === 0 ? "away" : "online",
        capabilities: index === 0 ? ["operator-chat", "shared-context"] : ["operator-chat"],
        expiresAt: "2026-08-01T12:00:45.000Z",
      })),
    },
  });
}

function clientHarness() {
  const subscriptions: Array<{
    readonly input: Parameters<ProjectPresenceSubscriptionClient["subscribe"]>[0];
    readonly unsubscribe: ReturnType<typeof vi.fn>;
  }> = [];
  const client: ProjectPresenceSubscriptionClient = {
    subscribe: (input) => {
      const unsubscribe = vi.fn();
      subscriptions.push({ input, unsubscribe });
      return unsubscribe;
    },
  };
  return { client, subscriptions };
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("ProjectPresenceRoster", () => {
  it("renders a labeled unavailable state without an injected client", async () => {
    mounted = await render(<ProjectPresenceRoster client={null} sharedProjectId={PROJECT_A} />);

    await expect.element(page.getByRole("heading", { name: "Collaborators" })).toBeVisible();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Collaborator presence is unavailable");
    await expect
      .element(page.getByRole("list", { name: "Current collaborators" }))
      .not.toBeInTheDocument();
  });

  it("renders only the current bounded roster with semantic status and overflow", async () => {
    const { client, subscriptions } = clientHarness();
    mounted = await render(<ProjectPresenceRoster client={client} sharedProjectId={PROJECT_A} />);
    await expect.element(page.getByRole("status")).toHaveTextContent("Loading");

    subscriptions[0]?.input.onUpdate(presenceSnapshot(PROJECT_A, 1, 21));

    await expect.element(page.getByRole("status")).toHaveTextContent("21 collaborators");
    await expect.element(page.getByRole("list", { name: "Current collaborators" })).toBeVisible();
    await expect.element(page.getByText("operator-01")).toBeVisible();
    await expect
      .element(page.getByText("(operator chat, shared context)", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("1 more collaborators are available.")).toBeVisible();
    await expect.element(page.getByText("operator-21")).not.toBeInTheDocument();
  });

  it("cannot render late data from the previous project after a project switch", async () => {
    const { client, subscriptions } = clientHarness();
    mounted = await render(<ProjectPresenceRoster client={client} sharedProjectId={PROJECT_A} />);
    subscriptions[0]?.input.onUpdate(presenceSnapshot(PROJECT_A, 1, 1));
    await expect.element(page.getByText("operator-01")).toBeVisible();

    await mounted.rerender(<ProjectPresenceRoster client={client} sharedProjectId={PROJECT_B} />);
    await expect.element(page.getByRole("status")).toHaveTextContent("Loading");
    expect(subscriptions[0]?.unsubscribe).toHaveBeenCalledTimes(1);

    subscriptions[0]?.input.onUpdate(presenceSnapshot(PROJECT_A, 9, 2));
    subscriptions[0]?.input.onError();
    await expect.element(page.getByText("operator-01")).not.toBeInTheDocument();
    await expect.element(page.getByRole("status")).toHaveTextContent("Loading");

    subscriptions[1]?.input.onUpdate(presenceSnapshot(PROJECT_B, 1, 2));
    await expect.element(page.getByRole("status")).toHaveTextContent("2 collaborators");
  });

  it("cleans up every StrictMode subscription without retaining old callbacks", async () => {
    const { client, subscriptions } = clientHarness();
    mounted = await render(
      <StrictMode>
        <ProjectPresenceRoster client={client} sharedProjectId={PROJECT_A} />
      </StrictMode>,
    );
    await expect.poll(() => subscriptions.length).toBeGreaterThanOrEqual(1);
    const active = subscriptions.at(-1)!;

    for (const subscription of subscriptions.slice(0, -1)) {
      expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
      subscription.input.onUpdate(presenceSnapshot(PROJECT_A, 99, 1));
    }
    await expect.element(page.getByText("operator-01")).not.toBeInTheDocument();

    active.input.onUpdate(presenceSnapshot(PROJECT_A, 1, 1));
    await expect.element(page.getByText("operator-01")).toBeVisible();
    await mounted.unmount();
    mounted = null;
    expect(active.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
