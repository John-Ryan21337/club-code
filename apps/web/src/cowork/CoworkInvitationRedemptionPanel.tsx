import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";

import {
  type CoworkInvitationRedemptionClient,
  type CoworkInvitationRedemptionIdentity,
  CoworkInvitationRedemptionPanelModel,
} from "./invitationRedemptionPanel.ts";

export interface CoworkInvitationRedemptionPanelProps {
  readonly client: CoworkInvitationRedemptionClient | null;
  readonly identity: CoworkInvitationRedemptionIdentity;
  readonly createCommandId?: () => string;
}

function defaultCommandId(): string {
  return `membership-redeem-${globalThis.crypto.randomUUID()}`;
}

function InvitationRedemptionPanelInner({
  client,
  identity,
  createCommandId = defaultCommandId,
}: Omit<CoworkInvitationRedemptionPanelProps, "client"> & {
  readonly client: CoworkInvitationRedemptionClient;
}) {
  const model = useMemo(
    () => new CoworkInvitationRedemptionPanelModel(client, identity),
    [client, identity],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const headingId = useId();
  const projectId = useId();
  const secretId = useId();
  const displayNameId = useId();
  const [sharedProjectId, setSharedProjectId] = useState("");
  const [secret, setSecret] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    // Replacing the client or authenticated pre-membership identity is a new
    // authority context. Clear every form reference before closing the old
    // model so a capability cannot silently cross that boundary.
    setSharedProjectId("");
    setSecret("");
    setDisplayName("");
    model.start();
    return () => model.stop();
  }, [model]);

  const locked =
    state.status === "pending" ||
    state.status === "indeterminate" ||
    state.status === "succeeded" ||
    state.status === "unavailable";

  const submit = () => {
    model.redeem({ sharedProjectId, secret, displayName }, createCommandId);
    // The immutable command owns the sole required in-memory retry reference
    // from this point. Remove the extra React/DOM copy immediately.
    setSecret("");
  };

  return (
    <section className="min-w-0 overflow-hidden" aria-labelledby={headingId}>
      <h2 id={headingId}>Join shared project</h2>
      <p>
        Enter the project identifier and one-time invitation token explicitly. Club Code does not
        read invitation tokens from links, browser history, storage, or the clipboard.
      </p>
      <p aria-live="polite" aria-atomic="true" role="status">
        {state.status === "pending"
          ? "Redeeming invitation"
          : state.status === "indeterminate"
            ? "Redemption acknowledgement was not received"
            : state.status === "rejected"
              ? "Invitation redemption was rejected"
              : state.status === "succeeded"
                ? "Invitation redeemed"
                : state.status === "unavailable"
                  ? "Invitation redemption is unavailable"
                  : "Ready to redeem invitation"}
      </p>

      {state.status !== "succeeded" ? (
        <form
          aria-label="Redeem project invitation"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor={projectId}>Shared project ID</label>
          <input
            id={projectId}
            type="text"
            maxLength={128}
            autoComplete="off"
            value={sharedProjectId}
            disabled={locked}
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (next !== sharedProjectId) setSecret("");
              setSharedProjectId(next);
            }}
          />
          <label htmlFor={secretId}>One-time invitation token</label>
          <input
            id={secretId}
            type="password"
            minLength={43}
            maxLength={43}
            autoComplete="off"
            spellCheck={false}
            value={secret}
            disabled={locked}
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
          <label htmlFor={displayNameId}>Display name</label>
          <input
            id={displayNameId}
            type="text"
            maxLength={128}
            autoComplete="off"
            value={displayName}
            disabled={locked}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
          <button type="submit" disabled={!state.canSubmit || locked}>
            {state.status === "rejected" ? "Try a new redemption request" : "Redeem invitation"}
          </button>
        </form>
      ) : null}

      {state.status === "pending" ? (
        <p>The one-time token has been removed from the form while the request is pending.</p>
      ) : null}
      {state.status === "indeterminate" ? (
        <div role="group" aria-label="Indeterminate redemption recovery">
          <p role="alert">
            The server may already have applied this command. Retry sends the exact same immutable
            identity, project, token, display name, and command ID.
          </p>
          <button type="button" onClick={() => model.retry()}>
            Retry exact redemption command
          </button>
          <button
            type="button"
            onClick={() => {
              model.discardIndeterminate();
              setSharedProjectId("");
              setSecret("");
              setDisplayName("");
            }}
          >
            Discard retry capability
          </button>
        </div>
      ) : null}
      {state.status === "rejected" ? (
        <p role="alert">
          The response or input failed strict validation. The token and retry command were removed;
          enter a new token to try again.
        </p>
      ) : null}
      {state.status === "succeeded" && state.member !== null ? (
        <div role="group" aria-label="Joined project membership">
          <h3>Project membership created</h3>
          <p>
            {state.member.displayName} ({state.member.userId}) joined as {state.member.role} at
            membership epoch {state.member.membershipEpoch} with {state.member.permissionCount}
            permissions.
          </p>
        </div>
      ) : null}
      <p>
        JavaScript strings cannot be securely zeroed. This panel removes references promptly but
        cannot guarantee physical memory erasure.
      </p>
    </section>
  );
}

export function CoworkInvitationRedemptionPanel(props: CoworkInvitationRedemptionPanelProps) {
  if (props.client === null) return null;
  return <InvitationRedemptionPanelInner {...props} client={props.client} />;
}
