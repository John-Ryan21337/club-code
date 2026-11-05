import type { ProviderRuntimeEvent } from "@cafecode/contracts";

export function hasRenderableAssistantText(text: string | undefined): boolean {
  return (text?.trim().length ?? 0) > 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Recover lost deltas only from an intact native completion for this exact item. */
export function isAuthoritativeCodexAssistantCompletion(
  event: ProviderRuntimeEvent,
  messageId: string,
): boolean {
  if (
    event.provider !== "codex" ||
    event.type !== "item.completed" ||
    event.payload.itemType !== "assistant_message" ||
    event.payload.status !== "completed" ||
    event.compaction !== undefined ||
    event.itemId === undefined ||
    messageId !== `assistant:${event.itemId}` ||
    event.raw?.source !== "codex.app-server.notification" ||
    event.raw.method !== "item/completed" ||
    !hasRenderableAssistantText(event.payload.detail)
  )
    return false;

  const data = record(event.payload.data);
  const raw = record(event.raw.payload);
  const item = record(data?.item);
  const rawItem = record(raw?.item);
  return (
    typeof data?.threadId === "string" &&
    data.threadId.length > 0 &&
    data.threadId === raw?.threadId &&
    typeof data.turnId === "string" &&
    data.turnId === event.turnId &&
    data.turnId === raw?.turnId &&
    item?.type === "agentMessage" &&
    rawItem?.type === "agentMessage" &&
    item.id === event.itemId &&
    rawItem.id === event.itemId &&
    item.text === event.payload.detail &&
    rawItem.text === event.payload.detail
  );
}

export function completedAssistantTextDelta(input: {
  readonly projectedText: string | undefined;
  readonly bufferedText: string;
  readonly fallbackText: string | undefined;
  readonly streamObserved?: boolean;
}): string {
  // Upstream Codex TUI 0.144.3 treats a completed assistant item as redundant
  // once its stream controller has observed deltas. Cafe follows that rule for
  // append events: flush only the coalesced tail, then let the separate terminal
  // message event consolidate to cryptographically verified canonical text.
  // Consulting a lagging SQL projection here can append the entire stream a
  // second time when that projection still contains only the first token.
  if (input.streamObserved === true) {
    return input.bufferedText;
  }

  const fallbackText = input.fallbackText;
  if (!hasRenderableAssistantText(fallbackText)) {
    return input.bufferedText;
  }
  const finalFallbackText = fallbackText!;

  const projectedText = input.projectedText ?? "";
  const projectedAndBufferedText = `${projectedText}${input.bufferedText}`;
  if (projectedAndBufferedText.length === 0) {
    return finalFallbackText;
  }

  if (finalFallbackText.startsWith(projectedAndBufferedText)) {
    return `${input.bufferedText}${finalFallbackText.slice(projectedAndBufferedText.length)}`;
  }

  if (input.bufferedText.length > 0) {
    return input.bufferedText;
  }

  // Codex item/completed carries the authoritative final assistant item text.
  // When Cafe has only projected a streamed prefix, append exactly the missing
  // suffix before the terminal marker. Do not append divergent completion text:
  // that would duplicate visible content and corrupt the append-only message
  // event stream. Divergence remains visible through provider/runtime logs.
  return finalFallbackText.startsWith(projectedText)
    ? finalFallbackText.slice(projectedText.length)
    : "";
}

export function assistantCompletionTextFromRuntimeEvent(
  event: ProviderRuntimeEvent,
): string | undefined {
  return event.type === "item.completed" && event.payload.itemType === "assistant_message"
    ? event.payload.detail
    : undefined;
}

export type PrefixSafeAssistantRepair =
  | {
      readonly type: "append";
      readonly suffix: string;
    }
  | {
      readonly type: "unchanged";
    }
  | {
      readonly type: "empty-completion";
    }
  | {
      readonly type: "diverged";
    };

export function prefixSafeAssistantRepairSuffix(input: {
  readonly projectedText: string;
  readonly completionText: string | undefined;
}): PrefixSafeAssistantRepair {
  if (!hasRenderableAssistantText(input.completionText)) {
    return { type: "empty-completion" };
  }

  const completionText = input.completionText!;
  if (!completionText.startsWith(input.projectedText)) {
    return { type: "diverged" };
  }

  const suffix = completionText.slice(input.projectedText.length);
  if (!hasRenderableAssistantText(suffix)) {
    return { type: "unchanged" };
  }
  return {
    type: "append",
    suffix,
  };
}
