import { useSyncExternalStore } from "react";

import {
  SharedOperatorChatPanel,
  type SharedOperatorChatPanelProps,
} from "./SharedOperatorChatPanel.tsx";
import type { SharedOperatorChatNetworkComposition } from "./SharedOperatorChatNetworkComposition.ts";

export interface SharedOperatorChatNetworkPanelProps extends Omit<
  SharedOperatorChatPanelProps,
  "client" | "connectionState" | "projectId"
> {
  readonly composition: SharedOperatorChatNetworkComposition;
}

/**
 * Renderer-only composition. Mounting does not connect, retry, poll, or launch a listener.
 * The host retains explicit control through the injected composition controller.
 */
export function SharedOperatorChatNetworkPanel({
  composition,
  ...panelProps
}: SharedOperatorChatNetworkPanelProps) {
  const connectionState = useSyncExternalStore(
    composition.subscribe,
    composition.getSnapshot,
    composition.getSnapshot,
  );
  return (
    <SharedOperatorChatPanel
      {...panelProps}
      client={composition.client}
      connectionState={connectionState}
      projectId={composition.projectId}
    />
  );
}
