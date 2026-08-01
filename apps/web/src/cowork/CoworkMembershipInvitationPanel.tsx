import {
  COLLABORATION_INVITE_MAX_LIFETIME_MILLIS,
  COLLABORATION_INVITE_MAX_NOT_BEFORE_DELAY_MILLIS,
  COLLABORATION_INVITE_MIN_LIFETIME_MILLIS,
  COLLABORATION_ROLE_PERMISSIONS,
  type CollaborationInvitationId,
  type CollaborationPermission,
  type CollaborationProjectRole,
  type SharedProjectId,
  type UserId,
} from "@cafecode/contracts";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";

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

const roleRank: Readonly<Record<CollaborationProjectRole, number>> = {
  owner: 4,
  admin: 3,
  operator: 2,
  contributor: 1,
  viewer: 0,
};

const inviteRoles = ["admin", "operator", "contributor", "viewer"] as const;

function parseWholeHours(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const hours = Number(value);
  return Number.isSafeInteger(hours) ? hours : null;
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
  const roleId = useId();
  const delayId = useId();
  const lifetimeId = useId();
  const tokenHeadingId = useId();
  const [role, setRole] = useState<CollaborationProjectRole>("viewer");
  const [permissions, setPermissions] = useState<ReadonlyArray<CollaborationPermission>>(
    COLLABORATION_ROLE_PERMISSIONS.viewer,
  );
  const [delayHours, setDelayHours] = useState("0");
  const [lifetimeHours, setLifetimeHours] = useState("24");

  useEffect(() => {
    model.start(sharedProjectId);
    return () => model.stop();
  }, [model, sharedProjectId]);

  const revoke = (invitationId: CollaborationInvitationId) => {
    model.revokeInvitation(invitationId, createCommandId);
  };

  const chooseRole = (nextRole: CollaborationProjectRole) => {
    setRole(nextRole);
    setPermissions(COLLABORATION_ROLE_PERMISSIONS[nextRole]);
  };

  const eligibleRoles = useMemo(
    () =>
      inviteRoles.filter(
        (candidate) => state.actorRole !== null && roleRank[candidate] < roleRank[state.actorRole],
      ),
    [state.actorRole],
  );
  const roleIsEligible = eligibleRoles.some((candidate) => candidate === role);

  useEffect(() => {
    if (roleIsEligible || eligibleRoles.length === 0) return;
    chooseRole(eligibleRoles.at(-1) ?? "viewer");
  }, [eligibleRoles, roleIsEligible]);

  const togglePermission = (permission: CollaborationPermission) => {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((candidate) => candidate !== permission)
        : COLLABORATION_ROLE_PERMISSIONS[role].filter(
            (candidate) => candidate === permission || current.includes(candidate),
          ),
    );
  };

  const parsedDelayHours = parseWholeHours(delayHours);
  const parsedLifetimeHours = parseWholeHours(lifetimeHours);
  const delayMillis = parsedDelayHours === null ? null : parsedDelayHours * 60 * 60_000;
  const lifetimeMillis = parsedLifetimeHours === null ? null : parsedLifetimeHours * 60 * 60_000;
  const formIsValid =
    roleIsEligible &&
    delayMillis !== null &&
    Number.isSafeInteger(delayMillis) &&
    delayMillis >= 0 &&
    delayMillis <= COLLABORATION_INVITE_MAX_NOT_BEFORE_DELAY_MILLIS &&
    lifetimeMillis !== null &&
    Number.isSafeInteger(lifetimeMillis) &&
    lifetimeMillis >= COLLABORATION_INVITE_MIN_LIFETIME_MILLIS &&
    lifetimeMillis <= COLLABORATION_INVITE_MAX_LIFETIME_MILLIS &&
    permissions.length > 0;

  const createInvitation = () => {
    if (!formIsValid || delayMillis === null || lifetimeMillis === null) return;
    model.createInvitation(
      {
        role,
        permissions,
        notBeforeDelayMillis: delayMillis,
        lifetimeMillis,
      },
      createCommandId,
    );
  };

  const creationFieldsLocked = state.creation.status !== "idle";

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
          {state.creation.canCreate || state.creation.status !== "idle" ? (
            <form
              aria-label="Create project invitation"
              onSubmit={(event) => {
                event.preventDefault();
                createInvitation();
              }}
            >
              <h3>Create invitation</h3>
              <p>
                The invitation token is shown once in this panel. It is not copied, saved, logged,
                synchronized, or recoverable.
              </p>
              <label htmlFor={roleId}>Role</label>
              <select
                id={roleId}
                value={role}
                disabled={state.creation.status === "pending" || state.creation.status === "lost"}
                onChange={(event) =>
                  chooseRole(event.currentTarget.value as CollaborationProjectRole)
                }
              >
                {eligibleRoles.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))}
              </select>
              <fieldset disabled={creationFieldsLocked}>
                <legend>Permissions</legend>
                {COLLABORATION_ROLE_PERMISSIONS[role].map((permission) => (
                  <label className="block" key={permission}>
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission)}
                      onChange={() => togglePermission(permission)}
                    />{" "}
                    {permission}
                  </label>
                ))}
              </fieldset>
              <label htmlFor={delayId}>Activation delay in hours (0 to 168)</label>
              <input
                id={delayId}
                type="number"
                min="0"
                max="168"
                step="1"
                value={delayHours}
                disabled={creationFieldsLocked}
                onChange={(event) => setDelayHours(event.currentTarget.value)}
              />
              <label htmlFor={lifetimeId}>Lifetime in hours (1 to 720)</label>
              <input
                id={lifetimeId}
                type="number"
                min="1"
                max="720"
                step="1"
                value={lifetimeHours}
                disabled={creationFieldsLocked}
                onChange={(event) => setLifetimeHours(event.currentTarget.value)}
              />
              <button
                type="submit"
                disabled={
                  !formIsValid ||
                  !state.creation.canCreate ||
                  state.creation.status === "pending" ||
                  state.creation.status === "lost" ||
                  state.creation.status === "presented"
                }
              >
                {state.creation.status === "pending"
                  ? "Creating invitationâ€¦"
                  : state.creation.status === "failed"
                    ? "Retry same invitation request"
                    : state.creation.status === "presented"
                      ? "Create unavailable while token is visible"
                      : "Create invitation"}
              </button>
              {state.creation.status === "failed" ? (
                <p role="alert">
                  Creation was not confirmed. Retry reuses the exact same command and scope.
                </p>
              ) : null}
              {state.creation.status === "lost" ? (
                <p role="alert">
                  This invitation exists, but its one-time token was not recoverable. Revoke
                  invitation {state.creation.invitationId}, then create a new one.
                </p>
              ) : null}
              {state.creation.status === "presented" && state.creation.secret !== null ? (
                <div role="group" aria-labelledby={tokenHeadingId}>
                  <h4 id={tokenHeadingId}>One-time invitation token</h4>
                  <p>
                    Share this token now. It cannot be shown again after dismissal or a context
                    change.
                  </p>
                  <code className="break-all">{state.creation.secret}</code>
                  <button type="button" onClick={() => model.dismissInvitationSecret()}>
                    Dismiss token
                  </button>
                </div>
              ) : null}
            </form>
          ) : null}
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
