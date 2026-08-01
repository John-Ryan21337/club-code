import "../../index.css";

import type { CollaborationNetworkClient } from "@cafecode/client-runtime";
import {
  SharedProjectId,
  UserId,
  type CollaborationProjectMember,
  type CollaborationTransportPage,
} from "@cafecode/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { createSharedOperatorChatNetworkComposition } from "./SharedOperatorChatNetworkComposition.ts";
import { SharedOperatorChatNetworkPanel } from "./SharedOperatorChatNetworkPanel.tsx";

const projectId = SharedProjectId.make("shared-project-network-panel");
const currentUserId = UserId.make("operator-a");
const participants: readonly CollaborationProjectMember[] = [
  {
    userId: currentUserId,
    displayName: "Aiko",
    role: "owner",
    permissions: ["chat.read", "chat.append", "transcript.read"],
    joinedAt: "2026-08-01T10:00:00.000Z",
  },
];

function emptyPage(): CollaborationTransportPage {
  return {
    sharedProjectId: projectId,
    messages: [],
    mergedOrder: [],
    lanePositions: [],
    nextCursor: "cursor-empty" as never,
    hasMore: false,
  };
}

describe("SharedOperatorChatNetworkPanel", () => {
  it("mounts inertly and reflects only explicit controller lifecycle changes", async () => {
    let state: "disconnected" | "connecting" | "connected" = "disconnected";
    let resolveConnection!: () => void;
    const pendingConnection = new Promise<void>((resolve) => {
      resolveConnection = resolve;
    });
    const connect = vi.fn(() => {
      state = "connecting";
      return pendingConnection.then(() => {
        state = "connected";
      });
    });
    const disconnect = vi.fn(() => {
      state = "disconnected";
    });
    const command = vi.fn(async () => emptyPage());
    const networkClient = {
      state: () => state,
      connect,
      disconnect,
      command,
      subscribeReplay: vi.fn(),
    } as unknown as CollaborationNetworkClient;
    const composition = createSharedOperatorChatNetworkComposition({
      projectId,
      networkClient,
    });
    const mounted = await render(
      <SharedOperatorChatNetworkPanel
        composition={composition}
        currentUserId={currentUserId}
        participants={participants}
      />,
    );

    try {
      await expect.element(page.getByText("Offline · sends wait safely")).toBeVisible();
      expect(connect).not.toHaveBeenCalled();
      expect(command).not.toHaveBeenCalled();

      const connection = composition.connect();
      await expect.element(page.getByText("Reconnecting · sends wait safely")).toBeVisible();
      resolveConnection();
      await connection;
      await expect.element(page.getByText("Connected")).toBeVisible();
      await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));

      composition.disconnect();
      await expect.element(page.getByText("Offline · sends wait safely")).toBeVisible();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.unmount();
    }
  });
});
