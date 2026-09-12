import type { ProviderDaemonRpcRequest, ThreadId } from "@cafecode/contracts";

/**
 * Identify every immutable Cafe thread referenced by one decoded daemon RPC.
 *
 * Historical JSON must be schema-decoded before it reaches this function; raw
 * string searches are never deletion authority. Fork operations deliberately
 * bind both source and target because either conversation can carry private
 * provider state in the durable command response.
 */
export function providerDaemonRequestThreadIds(
  request: ProviderDaemonRpcRequest,
): ReadonlyArray<ThreadId> {
  switch (request.method) {
    case "agentBrowserGrant":
    case "startSession":
    case "sendTurn":
    case "steerTurn":
    case "interruptTurn":
    case "respondToRequest":
    case "respondToUserInput":
    case "respondToInteraction":
    case "resolveInteractionUrl":
    case "snoozeUserInput":
    case "stopSession":
    case "quiesceThreadForHardDelete":
    case "getGoal":
    case "setGoal":
    case "clearGoal":
    case "rollbackConversation":
    case "readSubagentDetail":
      return [request.payload.threadId];
    case "agentBrowserRevoke":
      return request.payload.threadId ? [request.payload.threadId] : [];
    // These transient controls contain no caller-selected provider identity.
    // The broker owns the queued request identity and checks its live capability.
    case "agentBrowserPoll":
    case "agentBrowserComplete":
      return [];
    case "forkSession":
      return [request.payload.sourceThreadId, request.payload.targetThreadId];
    case "discardSessionFork":
      // The discard payload embeds the complete fork result, including both
      // Cafe identities. Its response/request body is therefore private state
      // owned by both conversations, just like fork creation itself.
      return [request.payload.fork.sourceThreadId, request.payload.fork.targetThreadId];
    case "restartProviderRuntime":
    case "listSessions":
    case "getCapabilities":
    case "getInstanceInfo":
      return [];
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}
