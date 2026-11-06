import type { OrchestrationEvent } from "@cafecode/contracts";

export type OutboundEventClassification =
  | { readonly kind: "protected" }
  | { readonly kind: "replaceable"; readonly key: string };

/**
 * Conservative overload policy for queued orchestration events.
 *
 * Unknown and lifecycle-shaped events are protected. Only complete state
 * snapshots with a stable identity are replaceable. Streaming
 * message text is an append fragment; replacing it discards words even when
 * the durable message is intact. Keep each fragment as a protected barrier.
 * Keep this classification at the routing boundary so new event types cannot
 * acquire lossy behavior without an explicit policy change.
 */
export function classifyOutboundOrchestrationEvent(
  event: OrchestrationEvent,
): OutboundEventClassification {
  switch (event.type) {
    case "thread.session-set":
      return {
        kind: "replaceable",
        key: `thread-session:${event.aggregateId}`,
      };
    default:
      return { kind: "protected" };
  }
}
