import { useSyncExternalStore } from "react";

let chatWidth: number | null = null;
const listeners = new Set<() => void>();

export function setEmbeddedBrowserChatWidth(width: number | null): void {
  const next = width !== null && Number.isFinite(width) && width > 0 ? width : null;
  if (next === chatWidth) return;
  chatWidth = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A split pane uses the same responsive controls as a narrow app window. */
export function useEmbeddedBrowserChatWidth(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => chatWidth,
    () => null,
  );
}
