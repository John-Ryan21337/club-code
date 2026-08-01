import { useEffect, useId, useMemo, useSyncExternalStore } from "react";

import {
  CoworkCurrentDeviceKeyModel,
  type CoworkCurrentDeviceKeyClient,
  type CoworkCurrentDeviceKeyScope,
} from "./currentDeviceKeyPanel.ts";

export interface CoworkCurrentDeviceKeyPanelProps extends CoworkCurrentDeviceKeyScope {
  readonly client: CoworkCurrentDeviceKeyClient | null;
  readonly createCommandId?: () => string;
}

function defaultCommandId(): string {
  return `device-self-revoke-${globalThis.crypto.randomUUID()}`;
}

function displayTime(value: string | null): string {
  if (value === null) return "Unavailable";
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toLocaleString() : "Unavailable";
}

function Panel({
  model,
  createCommandId = defaultCommandId,
}: {
  readonly model: CoworkCurrentDeviceKeyModel;
  readonly createCommandId: (() => string) | undefined;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const headingId = useId();

  useEffect(() => {
    model.start();
    return () => model.stop();
  }, [model]);

  const hasActiveKey = state.deviceKeyId !== null && state.activatedAt !== null;

  return (
    <section aria-labelledby={headingId} className="min-w-0 overflow-hidden">
      <h2 id={headingId}>This device&apos;s cowork key</h2>
      <p>
        Status is limited to the authenticated device in this shared project. The server derives
        user and device identity; this panel never requests another device.
      </p>
      <dl>
        <dt>Project</dt>
        <dd className="break-all">{state.sharedProjectId}</dd>
        <dt>Current user</dt>
        <dd className="break-all">{state.userId}</dd>
        <dt>Current device</dt>
        <dd className="break-all">{state.deviceId}</dd>
        <dt>Membership epoch</dt>
        <dd>{state.membershipEpoch}</dd>
      </dl>

      <p aria-atomic="true" aria-live="polite" role="status">
        {state.phase === "idle" || state.phase === "loading"
          ? "Checking this device's current key status."
          : state.phase === "unavailable"
            ? "Current device key status is unavailable."
            : state.phase === "enrollment-required"
              ? "This device requires key enrollment for this project."
              : state.phase === "confirming-revoke"
                ? "Self-revocation is awaiting explicit confirmation."
                : state.phase === "prepare-failed"
                  ? "The self-revocation command could not be prepared."
                  : state.phase === "revoking"
                    ? "Submitting the exact self-revocation command."
                    : state.phase === "retry-revoke"
                      ? "The self-revocation acknowledgement is indeterminate."
                      : "This device key is active for this project."}
      </p>

      {hasActiveKey ? (
        <p>
          Device key <span className="break-all">{state.deviceKeyId}</span> activated{" "}
          {displayTime(state.activatedAt)}.
        </p>
      ) : null}

      {state.phase === "unavailable" ? (
        <>
          <p role="alert">
            No key details were admitted. Retry only after confirming the current project and
            authenticated device authority.
          </p>
          <button onClick={() => model.refresh()} type="button">
            Check current device again
          </button>
        </>
      ) : null}

      {state.phase === "active" ? (
        <button onClick={() => model.requestSelfRevoke()} type="button">
          Revoke this device key
        </button>
      ) : null}

      {state.phase === "confirming-revoke" ? (
        <div role="alert">
          <p>
            Revoking this key immediately removes this device&apos;s current project authority. Work
            that requires the key will need a new enrollment. This action targets only the exact key
            shown above.
          </p>
          <button onClick={() => model.confirmSelfRevoke(createCommandId)} type="button">
            Confirm self-revoke
          </button>
          <button onClick={() => model.cancelSelfRevoke()} type="button">
            Keep this device key
          </button>
        </div>
      ) : null}

      {state.phase === "prepare-failed" ? (
        <div role="alert">
          <p>No revocation request was sent. Start the explicit confirmation again to retry.</p>
          <button onClick={() => model.requestSelfRevoke()} type="button">
            Review self-revoke again
          </button>
        </div>
      ) : null}

      {state.phase === "retry-revoke" ? (
        <div role="alert">
          <p>
            Retry reuses the same frozen command identifier, project, and device key. This panel
            will not mint a replacement command while the result is uncertain.
          </p>
          <button onClick={() => model.retrySelfRevoke()} type="button">
            Retry exact self-revocation command
          </button>
        </div>
      ) : null}

      <p>
        This panel never exposes key bytes, enrollment challenges, proof material, receipts, or a
        device list.
      </p>
    </section>
  );
}

export function CoworkCurrentDeviceKeyPanel(props: CoworkCurrentDeviceKeyPanelProps) {
  const model = useMemo(() => {
    if (props.client === null) return null;
    try {
      return new CoworkCurrentDeviceKeyModel(props.client, {
        sharedProjectId: props.sharedProjectId,
        userId: props.userId,
        deviceId: props.deviceId,
        membershipEpoch: props.membershipEpoch,
      });
    } catch {
      return null;
    }
  }, [props.client, props.deviceId, props.membershipEpoch, props.sharedProjectId, props.userId]);
  if (props.client === null) return null;
  if (model === null) {
    return (
      <section aria-label="Current device key panel unavailable" role="alert">
        <h2>This device&apos;s cowork key is unavailable</h2>
        <p>
          No key details were admitted because the current project, device authority, or injected
          client is invalid.
        </p>
      </section>
    );
  }
  return <Panel createCommandId={props.createCommandId} model={model} />;
}
