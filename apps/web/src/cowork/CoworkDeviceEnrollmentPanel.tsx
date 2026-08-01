import { useEffect, useId, useMemo, useSyncExternalStore } from "react";

import {
  CoworkDeviceEnrollmentModel,
  type CoworkDeviceEnrollmentClient,
  type CoworkDeviceEnrollmentScope,
  type CoworkDeviceEnrollmentSigner,
} from "./deviceEnrollmentPanel.ts";

export interface CoworkDeviceEnrollmentPanelProps extends CoworkDeviceEnrollmentScope {
  readonly client: CoworkDeviceEnrollmentClient | null;
  readonly signer: CoworkDeviceEnrollmentSigner | null;
  readonly createCommandId?: () => string;
}

function defaultCommandId(): string {
  return `device-enrollment-${globalThis.crypto.randomUUID()}`;
}

function displayTime(value: string | null): string {
  if (value === null) return "Unavailable";
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toLocaleString() : "Unavailable";
}

function Panel({
  client,
  signer,
  sharedProjectId,
  userId,
  deviceId,
  membershipEpoch,
  createCommandId = defaultCommandId,
}: CoworkDeviceEnrollmentPanelProps & {
  readonly client: CoworkDeviceEnrollmentClient;
  readonly signer: CoworkDeviceEnrollmentSigner;
}) {
  const model = useMemo(
    () =>
      new CoworkDeviceEnrollmentModel(client, signer, {
        sharedProjectId,
        userId,
        deviceId,
        membershipEpoch,
      }),
    [client, deviceId, membershipEpoch, sharedProjectId, signer, userId],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const headingId = useId();

  useEffect(() => {
    model.start();
    return () => model.stop();
  }, [model]);

  const working = ["reading-signer", "beginning", "signing", "completing"].includes(state.status);
  const retrying = state.status.startsWith("retry-");
  const buttonLabel =
    state.status === "activated"
      ? "Rotate this device key"
      : state.status === "prepare-failed"
        ? "Retry enrollment setup"
        : retrying
          ? "Retry exact enrollment command"
          : working
            ? "Enrolling this device…"
            : "Enroll this device";

  return (
    <section className="min-w-0 overflow-hidden" aria-labelledby={headingId}>
      <h2 id={headingId}>This device’s cowork key</h2>
      <p>
        Enroll only the current authenticated device for this project. The private key stays inside
        the injected device signer and is never received by this panel.
      </p>
      <dl>
        <dt>Project</dt>
        <dd className="break-all">{state.sharedProjectId}</dd>
        <dt>User</dt>
        <dd className="break-all">{state.userId}</dd>
        <dt>Device</dt>
        <dd className="break-all">{state.deviceId}</dd>
        <dt>Membership epoch</dt>
        <dd>{state.membershipEpoch}</dd>
      </dl>
      <p aria-live="polite" aria-atomic="true" role="status">
        {state.status === "idle"
          ? "This device is ready for explicit enrollment."
          : state.status === "prepare-failed"
            ? "The device signing identity or enrollment command could not be prepared."
            : state.status === "reading-signer"
              ? "Reading this device’s public signing identity."
              : state.status === "beginning"
                ? "Requesting one fixed-lifetime server challenge."
                : state.status === "signing"
                  ? "The device signer is proving possession without exporting its private key."
                  : state.status === "completing"
                    ? "Submitting the exact challenge proof."
                    : state.status === "retry-begin"
                      ? "The challenge acknowledgement is indeterminate."
                      : state.status === "retry-sign"
                        ? "The local proof was not produced."
                        : state.status === "retry-complete"
                          ? "The activation acknowledgement is indeterminate."
                          : state.status === "lost-nonce"
                            ? "The challenge exists, but its one-time nonce is unrecoverable."
                            : "This device key is active."}
      </p>

      {state.deviceKeyId !== null ? (
        <p>
          Device key <span className="break-all">{state.deviceKeyId}</span>
          {state.activatedAt === null ? null : ` activated ${displayTime(state.activatedAt)}`}.
        </p>
      ) : null}
      {state.challengeExpiresAt !== null && state.status !== "activated" ? (
        <p>Server challenge expires {displayTime(state.challengeExpiresAt)}.</p>
      ) : null}

      {state.status === "lost-nonce" ? (
        <p role="alert">
          An exact begin replay correctly returned no nonce. Club Code cannot reconstruct it or
          silently mint a replacement. Discard this attempt, then explicitly start a new challenge.
        </p>
      ) : null}
      {state.status === "prepare-failed" ? (
        <p role="alert">
          No enrollment request was sent. Verify this device's signer, then retry explicitly.
        </p>
      ) : null}
      {retrying ? (
        <p role="alert">
          Retry preserves the exact immutable request and command identifier. Discard only if you
          accept starting a separate enrollment attempt.
        </p>
      ) : null}

      <button
        type="button"
        disabled={working || state.status === "lost-nonce"}
        onClick={() => model.enroll(createCommandId)}
      >
        {buttonLabel}
      </button>
      {state.status === "lost-nonce" || retrying ? (
        <button type="button" disabled={working} onClick={() => model.discardAndRestart()}>
          Discard attempt
        </button>
      ) : null}
      <p>
        This slice does not list or revoke keys: PR #20 exposes no authenticated current-key listing
        authority. A successful rotation revokes the prior key atomically on the server.
      </p>
    </section>
  );
}

export function CoworkDeviceEnrollmentPanel(props: CoworkDeviceEnrollmentPanelProps) {
  if (props.client === null || props.signer === null) return null;
  return <Panel {...props} client={props.client} signer={props.signer} />;
}
