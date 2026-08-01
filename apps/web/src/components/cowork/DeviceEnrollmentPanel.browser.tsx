import "../../index.css";

import {
  CollaborationMembershipEpoch,
  DeviceId,
  SharedProjectId,
  UserId,
} from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { CoworkDeviceEnrollmentPanel } from "../../cowork/CoworkDeviceEnrollmentPanel.tsx";
import type {
  CoworkDeviceEnrollmentClient,
  CoworkDeviceEnrollmentSigner,
} from "../../cowork/deviceEnrollmentPanel.ts";

const PUBLIC_KEY = "MCowBQYDK2VwAyEAeYSfBObPytF2-WlIwwrI8R_xYnamhwUiIEA-PouMC38";
const NONCE = "N".repeat(43);
const SIGNATURE = "A".repeat(86);
const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const scope = {
  sharedProjectId: decodeProjectId("browser-device-project"),
  userId: Schema.decodeUnknownSync(UserId)("browser-device-user"),
  deviceId: Schema.decodeUnknownSync(DeviceId)("browser-device-id"),
  membershipEpoch: Schema.decodeUnknownSync(CollaborationMembershipEpoch)(4),
};

type Mounted = Awaited<ReturnType<typeof render>>;
let mounted: Mounted | null = null;

function challenge() {
  return {
    challengeId: "browser-device-challenge",
    ...scope,
    deviceKeyId: "browser-device-key",
    publicKeySpkiDer: PUBLIC_KEY,
    issuedAt: "2026-08-01T12:00:00.000Z",
    expiresAt: "2026-08-01T12:05:00.000Z",
  };
}

function harness() {
  const beginEnrollment = vi.fn<CoworkDeviceEnrollmentClient["beginEnrollment"]>(async () => ({
    disposition: "created",
    challenge: challenge(),
    nonce: NONCE,
  }));
  const completeEnrollment = vi.fn<CoworkDeviceEnrollmentClient["completeEnrollment"]>(
    async () => ({
      disposition: "activated",
      key: {
        ...scope,
        deviceKeyId: "browser-device-key",
        publicKeySpkiDer: PUBLIC_KEY,
        activatedAt: "2026-08-01T12:01:00.000Z",
        revokedAt: null,
      },
    }),
  );
  const getPublicIdentity = vi.fn(async () => ({ ...scope, publicKeySpkiDer: PUBLIC_KEY }));
  const signEnrollmentProof = vi.fn<CoworkDeviceEnrollmentSigner["signEnrollmentProof"]>(
    async () => SIGNATURE,
  );
  return {
    client: { beginEnrollment, completeEnrollment },
    signer: { getPublicIdentity, signEnrollmentProof },
    beginEnrollment,
    completeEnrollment,
    getPublicIdentity,
    signEnrollmentProof,
  };
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("CoworkDeviceEnrollmentPanel", () => {
  it("renders nothing and performs no work when either capability is absent", async () => {
    const h = harness();
    mounted = await render(
      <CoworkDeviceEnrollmentPanel {...scope} client={null} signer={h.signer} />,
    );
    expect(document.body.textContent?.trim()).toBe("");
    expect(h.getPublicIdentity).not.toHaveBeenCalled();
    await mounted.unmount();
    mounted = await render(
      <CoworkDeviceEnrollmentPanel {...scope} client={h.client} signer={null} />,
    );
    expect(document.body.textContent?.trim()).toBe("");
    expect(h.beginEnrollment).not.toHaveBeenCalled();
  });

  it("enrolls only after explicit action without rendering nonce, proof, or private material", async () => {
    const h = harness();
    const createCommandId = vi
      .fn()
      .mockReturnValueOnce("browser-begin-command")
      .mockReturnValueOnce("browser-complete-command");
    mounted = await render(
      <CoworkDeviceEnrollmentPanel
        {...scope}
        client={h.client}
        signer={h.signer}
        createCommandId={createCommandId}
      />,
    );
    expect(h.getPublicIdentity).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Enroll this device" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("This device key is active");
    await expect.element(page.getByText(/browser-device-key/)).toBeVisible();
    expect(document.body.textContent).not.toContain(NONCE);
    expect(document.body.textContent).not.toContain(SIGNATURE);
    expect(document.body.textContent?.toLowerCase()).not.toContain("private key bytes");
    expect(h.signEnrollmentProof).toHaveBeenCalledTimes(1);
    expect(h.completeEnrollment).toHaveBeenCalledTimes(1);
  });

  it("makes a lost begin acknowledgement explicit and never signs a replay without its nonce", async () => {
    const h = harness();
    h.beginEnrollment.mockRejectedValueOnce(new Error("connection closed")).mockResolvedValueOnce({
      disposition: "already-applied",
      challenge: challenge(),
      nonce: null,
    });
    const createCommandId = vi.fn(() => "browser-begin-command");
    mounted = await render(
      <CoworkDeviceEnrollmentPanel
        {...scope}
        client={h.client}
        signer={h.signer}
        createCommandId={createCommandId}
      />,
    );
    await page.getByRole("button", { name: "Enroll this device" }).click();
    const retry = page.getByRole("button", { name: "Retry exact enrollment command" });
    await expect.element(retry).toBeVisible();
    await retry.click();
    await expect.element(page.getByRole("status")).toHaveTextContent("nonce is unrecoverable");
    await expect.element(page.getByRole("alert")).toHaveTextContent("cannot reconstruct it");
    expect(h.beginEnrollment.mock.calls[1]![0]).toBe(h.beginEnrollment.mock.calls[0]![0]);
    expect(h.signEnrollmentProof).not.toHaveBeenCalled();
    expect(createCommandId).toHaveBeenCalledTimes(1);
  });

  it("clears the lost attempt only through explicit discard", async () => {
    const h = harness();
    h.beginEnrollment.mockResolvedValueOnce({
      disposition: "already-applied",
      challenge: challenge(),
      nonce: null,
    });
    mounted = await render(
      <CoworkDeviceEnrollmentPanel
        {...scope}
        client={h.client}
        signer={h.signer}
        createCommandId={() => "browser-begin-command"}
      />,
    );
    await page.getByRole("button", { name: "Enroll this device" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("nonce is unrecoverable");
    await expect.element(page.getByRole("button", { name: "Enroll this device" })).toBeDisabled();
    await page.getByRole("button", { name: "Discard attempt" }).click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("ready for explicit enrollment");
    await expect.element(page.getByRole("button", { name: "Enroll this device" })).toBeEnabled();
  });

  it("drops an old project's late challenge when the exact scope is replaced", async () => {
    const h = harness();
    let resolveOld!: (value: unknown) => void;
    h.beginEnrollment.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOld = resolve)),
    );
    mounted = await render(
      <CoworkDeviceEnrollmentPanel
        {...scope}
        client={h.client}
        signer={h.signer}
        createCommandId={() => "browser-begin-command"}
      />,
    );
    await page.getByRole("button", { name: "Enroll this device" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Requesting one");

    const replacementScope = {
      ...scope,
      sharedProjectId: decodeProjectId("browser-device-project-next"),
    };
    await mounted.rerender(
      <CoworkDeviceEnrollmentPanel
        {...replacementScope}
        client={h.client}
        signer={h.signer}
        createCommandId={() => "browser-next-command"}
      />,
    );
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("ready for explicit enrollment");
    resolveOld({ disposition: "created", challenge: challenge(), nonce: NONCE });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.signEnrollmentProof).not.toHaveBeenCalled();
    await expect.element(page.getByText("browser-device-project-next")).toBeVisible();
    expect(document.body.textContent).not.toContain("browser-device-key");
  });
});
