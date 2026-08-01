import { useSyncExternalStore } from "react";

import {
  SharedOperatorChatPanel,
  type SharedOperatorChatPanelProps,
} from "./SharedOperatorChatPanel.tsx";
import type { SharedOperatorChatNetworkComposition } from "./SharedOperatorChatNetworkComposition.ts";

const compositionKeys = new WeakMap<SharedOperatorChatNetworkComposition, number>();
let nextCompositionKey = 1;

function compositionKey(composition: SharedOperatorChatNetworkComposition): number {
  const existing = compositionKeys.get(composition);
  if (existing !== undefined) return existing;
  const key = nextCompositionKey;
  nextCompositionKey += 1;
  compositionKeys.set(composition, key);
  return key;
}

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
      key={compositionKey(composition)}
      {...panelProps}
      client={composition.client}
      connectionState={connectionState}
      projectId={composition.projectId}
    />
  );
}
