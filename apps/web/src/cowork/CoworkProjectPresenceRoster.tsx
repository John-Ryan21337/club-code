import type { SharedProjectId } from "@cafecode/contracts";
import { useEffect, useId, useMemo, useSyncExternalStore } from "react";

import {
  type ProjectPresenceSubscriptionClient,
  ProjectPresenceRosterModel,
} from "./projectPresenceRoster.ts";

export interface ProjectPresenceRosterProps {
  readonly client: ProjectPresenceSubscriptionClient | null;
  readonly sharedProjectId: SharedProjectId;
}

function statusText(status: ReturnType<ProjectPresenceRosterModel["getSnapshot"]>): string {
  switch (status.status) {
    case "loading":
      return "Loading collaborator presence";
    case "unavailable":
      return "Collaborator presence is unavailable";
    case "resync-required":
      return "Collaborator presence needs to resync";
    case "ready": {
      const count = status.participants.length + status.overflowCount;
      return `${count} ${count === 1 ? "collaborator" : "collaborators"}`;
    }
  }
}

function capabilityLabel(capability: "operator-chat" | "shared-context"): string {
  return capability === "operator-chat" ? "operator chat" : "shared context";
}

export function ProjectPresenceRoster({ client, sharedProjectId }: ProjectPresenceRosterProps) {
  const model = useMemo(() => new ProjectPresenceRosterModel(client), [client]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const headingId = useId();

  useEffect(() => {
    model.start(sharedProjectId);
    return () => model.stop();
  }, [model, sharedProjectId]);

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Collaborators</h2>
      <p aria-live="polite" aria-atomic="true" role="status">
        {statusText(state)}
      </p>
      {state.status === "ready" && state.participants.length > 0 ? (
        <ul aria-label="Current collaborators">
          {state.participants.map((participant) => (
            <li key={participant.userId}>
              <span>{participant.userId}</span>: <span>{participant.state}</span>
              {participant.capabilities.length > 0 ? (
                <span>
                  {" ("}
                  {participant.capabilities.map(capabilityLabel).join(", ")}
                  {")"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.status === "ready" && state.overflowCount > 0 ? (
        <p>{state.overflowCount} more collaborators are available.</p>
      ) : null}
    </section>
  );
}
