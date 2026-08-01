import type { CollaborationInvitationId, SharedProjectId, UserId } from "@cafecode/contracts";
import { useEffect, useId, useMemo, useSyncExternalStore } from "react";

import {
  type MembershipInvitationClient,
  MembershipInvitationPanelModel,
} from "./membershipInvitationPanel.ts";

export interface CoworkMembershipInvitationPanelProps {
  readonly client: MembershipInvitationClient | null;
  readonly sharedProjectId: SharedProjectId;
  readonly actorUserId: UserId;
  readonly createCommandId?: () => string;
}

function defaultCommandId(): string {
  return `membership-${globalThis.crypto.randomUUID()}`;
}

function displayTime(value: string): string {
  const epochMillis = Date.parse(value);
  return Number.isFinite(epochMillis) ? new Date(epochMillis).toLocaleString() : "Unavailable";
}

function MembershipInvitationPanelInner({
  client,
  sharedProjectId,
  actorUserId,
  createCommandId = defaultCommandId,
}: Omit<CoworkMembershipInvitationPanelProps, "client"> & {
  readonly client: MembershipInvitationClient;
}) {
  const model = useMemo(
    () => new MembershipInvitationPanelModel(client, actorUserId, sharedProjectId),
    [actorUserId, client, sharedProjectId],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const headingId = useId();

  useEffect(() => {
    model.start(sharedProjectId);
    return () => model.stop();
  }, [model, sharedProjectId]);

  const revoke = (invitationId: CollaborationInvitationId) => {
    model.revokeInvitation(invitationId, createCommandId);
  };

  return (
    <section className="min-w-0 overflow-hidden" aria-labelledby={headingId}>
      <h2 id={headingId}>Project access</h2>
      <p aria-live="polite" aria-atomic="true" role="status">
        {state.status === "loading"
          ? "Loading project access"
          : state.status === "unavailable"
            ? "Project access is unavailable"
            : `${state.members.length} ${state.members.length === 1 ? "member" : "members"}, epoch ${state.epoch}`}
      </p>

      {state.status === "ready" ? (
        <>
          <p>
            Current role: <strong>{state.actorRole}</strong>. Read revision {state.revision}, cursor{" "}
            {state.nextCursor}.
          </p>
          <h3>Members</h3>
          <ul className="min-w-0" aria-label="Project members">
            {state.members.map((member) => (
              <li className="min-w-0 break-words" key={member.userId}>
                <span>{member.displayName}</span>{" "}
                <span className="break-all">({member.userId})</span>: {member.role}
              </li>
            ))}
          </ul>

          <h3>Pending invitations</h3>
          {state.invitations.length === 0 ? (
            <p>No pending invitations.</p>
          ) : (
            <ul className="min-w-0" aria-label="Pending invitations">
              {state.invitations.map((invitation) => (
                <li className="min-w-0 break-words" key={invitation.invitationId}>
                  <p className="min-w-0">
                    <span>{invitation.role}</span> invitation{" "}
                    <span className="break-all">{invitation.invitationId}</span>
                  </p>
                  <p className="min-w-0 break-words">
                    Created by <span className="break-all">{invitation.createdByUserId}</span>;
                    valid {displayTime(invitation.notBefore)} to {displayTime(invitation.expiresAt)}
                    ; {invitation.permissionCount} permissions.
                  </p>
                  {invitation.canRevoke ? (
                    <button
                      type="button"
                      aria-label={
                        invitation.revokeStatus === "pending"
                          ? `Revoking invitation ${invitation.invitationId}`
                          : invitation.revokeStatus === "refreshing"
                            ? `Refreshing access for invitation ${invitation.invitationId}`
                            : invitation.revokeBlocked
                              ? `Wait to revoke invitation ${invitation.invitationId}`
                              : invitation.revokeStatus === "failed"
                                ? `Retry revoke invitation ${invitation.invitationId}`
                                : `Revoke invitation ${invitation.invitationId}`
                      }
                      disabled={
                        invitation.revokeStatus === "pending" ||
                        invitation.revokeStatus === "refreshing" ||
                        invitation.revokeBlocked
                      }
                      onClick={() => revoke(invitation.invitationId)}
                    >
                      {invitation.revokeStatus === "pending"
                        ? "Revoking…"
                        : invitation.revokeStatus === "refreshing"
                          ? "Refreshing access…"
                          : invitation.revokeBlocked
                            ? "Wait for active revoke"
                            : invitation.revokeStatus === "failed"
                              ? "Retry revoke"
                              : "Revoke invitation"}
                    </button>
                  ) : null}
                  {invitation.revokeStatus === "failed" ? (
                    <p role="alert">Revocation was not confirmed. Retry uses the same command.</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {state.hasMore ? <p>More pending invitations are available.</p> : null}
        </>
      ) : null}
    </section>
  );
}

export function CoworkMembershipInvitationPanel(props: CoworkMembershipInvitationPanelProps) {
  if (props.client === null) return null;
  return <MembershipInvitationPanelInner {...props} client={props.client} />;
}
