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

import { CoworkCurrentDeviceKeyPanel } from "../../cowork/CoworkCurrentDeviceKeyPanel.tsx";
import type { CoworkCurrentDeviceKeyClient } from "../../cowork/currentDeviceKeyPanel.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodeUserId = Schema.decodeUnknownSync(UserId);
const decodeDeviceId = Schema.decodeUnknownSync(DeviceId);
const decodeMembershipEpoch = Schema.decodeUnknownSync(CollaborationMembershipEpoch);
const scope = {
  sharedProjectId: decodeProjectId("browser-status-project"),
  userId: decodeUserId("browser-status-user"),
  deviceId: decodeDeviceId("browser-status-device"),
  membershipEpoch: decodeMembershipEpoch(11),
};
const DEVICE_KEY_ID = "browser-status-device-key";
const ACTIVATED_AT = "2026-08-01T12:00:00.000Z";
const PUBLIC_KEY = "B".repeat(59);

type Mounted = Awaited<ReturnType<typeof render>>;
let mounted: Mounted | null = null;

function activeStatus(overrides: Record<string, unknown> = {}) {
  return {
    ...scope,
    status: "active",
    activeKey: { deviceKeyId: DEVICE_KEY_ID, activatedAt: ACTIVATED_AT },
    ...overrides,
  };
}

function revoked() {
  return {
    disposition: "revoked",
    key: {
      ...scope,
      deviceKeyId: DEVICE_KEY_ID,
      publicKeySpkiDer: PUBLIC_KEY,
      activatedAt: ACTIVATED_AT,
      revokedAt: "2026-08-01T13:00:00.000Z",
    },
  };
}

function harness(input?: {
  readonly status?: CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"];
  readonly revoke?: CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"];
}) {
  const getCurrentDeviceKeyStatus = vi.fn(input?.status ?? (async () => activeStatus()));
  const revokeCurrentDeviceKey = vi.fn(input?.revoke ?? (async () => revoked()));
  return {
    client: { getCurrentDeviceKeyStatus, revokeCurrentDeviceKey },
    getCurrentDeviceKeyStatus,
    revokeCurrentDeviceKey,
  };
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("CoworkCurrentDeviceKeyPanel", () => {
  it("is inert without an explicitly injected client", async () => {
    const h = harness();
    mounted = await render(<CoworkCurrentDeviceKeyPanel {...scope} client={null} />);
    expect(document.body.textContent?.trim()).toBe("");
    expect(h.getCurrentDeviceKeyStatus).not.toHaveBeenCalled();
    expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();
  });

  it("requests only the project and presents exactly the active current device", async () => {
    const h = harness();
    mounted = await render(<CoworkCurrentDeviceKeyPanel {...scope} client={h.client} />);
    await expect.element(page.getByRole("status")).toHaveTextContent("key is active");
    await expect.element(page.getByText(DEVICE_KEY_ID)).toBeVisible();
    expect(h.getCurrentDeviceKeyStatus).toHaveBeenCalledWith({
      sharedProjectId: scope.sharedProjectId,
    });
    expect(Reflect.ownKeys(h.getCurrentDeviceKeyStatus.mock.calls[0]![0])).toEqual([
      "sharedProjectId",
    ]);
    expect(document.body.textContent).not.toContain(PUBLIC_KEY);
    await expect
      .element(page.getByRole("button", { name: "Revoke this device key" }))
      .toBeVisible();
  });

  it("presents enrollment-required without exposing a revoke action", async () => {
    const h = harness({
      status: async () => ({ ...scope, status: "enrollment-required", activeKey: null }),
    });
    mounted = await render(<CoworkCurrentDeviceKeyPanel {...scope} client={h.client} />);
    await expect.element(page.getByRole("status")).toHaveTextContent("requires key enrollment");
    expect(page.getByRole("button", { name: "Revoke this device key" }).query()).toBeNull();
    expect(document.body.textContent).not.toContain(DEVICE_KEY_ID);
  });

  it("requires destructive confirmation and never renders mutation key bytes", async () => {
    const h = harness();
    const createCommandId = vi.fn(() => "browser-self-revoke-command");
    mounted = await render(
      <CoworkCurrentDeviceKeyPanel
        {...scope}
        client={h.client}
        createCommandId={createCommandId}
      />,
    );
    await expect.element(page.getByText(DEVICE_KEY_ID)).toBeVisible();
    await page.getByRole("button", { name: "Revoke this device key" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("immediately removes");
    expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Keep this device key" }).click();
    expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Revoke this device key" }).click();
    await page.getByRole("button", { name: "Confirm self-revoke" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("requires key enrollment");
    expect(createCommandId).toHaveBeenCalledOnce();
    expect(h.revokeCurrentDeviceKey).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(PUBLIC_KEY);
    expect(document.body.textContent).not.toContain("browser-self-revoke-command");
  });

  it("offers only an exact retry after an indeterminate acknowledgement", async () => {
    const revoke = vi
      .fn<CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"]>()
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce(revoked());
    const h = harness({ revoke });
    const createCommandId = vi.fn(() => "browser-indeterminate-command");
    mounted = await render(
      <CoworkCurrentDeviceKeyPanel
        {...scope}
        client={h.client}
        createCommandId={createCommandId}
      />,
    );
    await expect.element(page.getByText(DEVICE_KEY_ID)).toBeVisible();
    await page.getByRole("button", { name: "Revoke this device key" }).click();
    await page.getByRole("button", { name: "Confirm self-revoke" }).click();
    const retry = page.getByRole("button", { name: "Retry exact self-revocation command" });
    await expect.element(retry).toBeVisible();
    const originalRequest = revoke.mock.calls[0]![0];
    await retry.click();
    await expect.element(page.getByRole("status")).toHaveTextContent("requires key enrollment");
    expect(revoke.mock.calls[1]![0]).toBe(originalRequest);
    expect(createCommandId).toHaveBeenCalledOnce();
  });

  it("conceals malformed current-device responses", async () => {
    const h = harness({
      status: async () => ({
        ...activeStatus(),
        activeKey: { ...activeStatus().activeKey, publicKeySpkiDer: PUBLIC_KEY },
      }),
    });
    mounted = await render(<CoworkCurrentDeviceKeyPanel {...scope} client={h.client} />);
    await expect.element(page.getByRole("status")).toHaveTextContent("status is unavailable");
    await expect.element(page.getByRole("alert")).toHaveTextContent("No key details were admitted");
    expect(document.body.textContent).not.toContain(DEVICE_KEY_ID);
    expect(document.body.textContent).not.toContain(PUBLIC_KEY);
    expect(h.revokeCurrentDeviceKey).not.toHaveBeenCalled();
  });

  it("clears prior key details when a replacement client is invalid", async () => {
    const first = harness();
    mounted = await render(<CoworkCurrentDeviceKeyPanel {...scope} client={first.client} />);
    await expect.element(page.getByText(DEVICE_KEY_ID)).toBeVisible();

    const invalidClient = {
      revokeCurrentDeviceKey: vi.fn(async () => revoked()),
    } as unknown as CoworkCurrentDeviceKeyClient;
    await mounted.rerender(<CoworkCurrentDeviceKeyPanel {...scope} client={invalidClient} />);

    expect(document.body.textContent).not.toContain(DEVICE_KEY_ID);
    await expect
      .element(page.getByRole("alert", { name: "Current device key panel unavailable" }))
      .toHaveTextContent("No key details were admitted");
    expect(first.getCurrentDeviceKeyStatus).toHaveBeenCalledOnce();
  });

  it("clears prior key details when replacement scope validation fails", async () => {
    const h = harness();
    mounted = await render(<CoworkCurrentDeviceKeyPanel {...scope} client={h.client} />);
    await expect.element(page.getByText(DEVICE_KEY_ID)).toBeVisible();

    await mounted.rerender(
      <CoworkCurrentDeviceKeyPanel
        {...scope}
        client={h.client}
        membershipEpoch={"invalid-epoch" as unknown as typeof scope.membershipEpoch}
      />,
    );

    expect(document.body.textContent).not.toContain(DEVICE_KEY_ID);
    await expect
      .element(page.getByRole("alert", { name: "Current device key panel unavailable" }))
      .toHaveTextContent("No key details were admitted");
    expect(h.getCurrentDeviceKeyStatus).toHaveBeenCalledOnce();
  });

  it("drops a late pending revoke when membership authority changes", async () => {
    const nextStatus = new Promise<unknown>(() => undefined);
    let statusRead = 0;
    let resolveRevoke!: (value: unknown) => void;
    const h = harness({
      status: () => {
        statusRead += 1;
        return statusRead === 1 ? Promise.resolve(activeStatus()) : nextStatus;
      },
      revoke: () => new Promise((resolve) => (resolveRevoke = resolve)),
    });
    mounted = await render(
      <CoworkCurrentDeviceKeyPanel
        {...scope}
        client={h.client}
        createCommandId={() => "browser-pending-command"}
      />,
    );
    await expect.element(page.getByText(DEVICE_KEY_ID)).toBeVisible();
    await page.getByRole("button", { name: "Revoke this device key" }).click();
    await page.getByRole("button", { name: "Confirm self-revoke" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("Submitting the exact");

    await mounted.rerender(
      <CoworkCurrentDeviceKeyPanel
        {...scope}
        client={h.client}
        createCommandId={() => "browser-next-command"}
        membershipEpoch={decodeMembershipEpoch(12)}
      />,
    );
    expect(document.body.textContent).not.toContain(DEVICE_KEY_ID);
    await expect.element(page.getByRole("status")).toHaveTextContent("Checking this device");
    resolveRevoke(revoked());
    await Promise.resolve();
    await Promise.resolve();
    expect(document.body.textContent).not.toContain(DEVICE_KEY_ID);
    await expect.element(page.getByRole("status")).toHaveTextContent("Checking this device");
  });

  it("synchronously clears retry presentation on every authority and client drift", async () => {
    const driftCases = [
      {
        scopeOverride: {
          sharedProjectId: decodeProjectId("browser-next-project"),
        },
        replaceClient: false,
      },
      {
        scopeOverride: { userId: decodeUserId("browser-next-user") },
        replaceClient: false,
      },
      {
        scopeOverride: { deviceId: decodeDeviceId("browser-next-device") },
        replaceClient: false,
      },
      {
        scopeOverride: {
          membershipEpoch: decodeMembershipEpoch(12),
        },
        replaceClient: false,
      },
      { scopeOverride: {}, replaceClient: true },
    ] as const;

    for (const testCase of driftCases) {
      const nextStatus = new Promise<unknown>(() => undefined);
      let firstStatusRead = true;
      const first = harness({
        status: () => {
          if (firstStatusRead) {
            firstStatusRead = false;
            return Promise.resolve(activeStatus());
          }
          return nextStatus;
        },
        revoke: async () => Promise.reject(new Error("indeterminate")),
      });
      const second = harness({ status: () => nextStatus });
      mounted = await render(
        <CoworkCurrentDeviceKeyPanel
          {...scope}
          client={first.client}
          createCommandId={() => "browser-drift-command"}
        />,
      );
      await expect.element(page.getByText(DEVICE_KEY_ID)).toBeVisible();
      await page.getByRole("button", { name: "Revoke this device key" }).click();
      await page.getByRole("button", { name: "Confirm self-revoke" }).click();
      await expect
        .element(page.getByRole("button", { name: "Retry exact self-revocation command" }))
        .toBeVisible();

      await mounted.rerender(
        <CoworkCurrentDeviceKeyPanel
          {...scope}
          {...testCase.scopeOverride}
          client={testCase.replaceClient ? second.client : first.client}
          createCommandId={() => "browser-next-command"}
        />,
      );
      expect(document.body.textContent).not.toContain(DEVICE_KEY_ID);
      expect(
        page.getByRole("button", { name: "Retry exact self-revocation command" }).query(),
      ).toBeNull();
      await expect.element(page.getByRole("status")).toHaveTextContent("Checking this device");
      if (testCase.replaceClient) {
        expect(second.getCurrentDeviceKeyStatus).toHaveBeenCalledOnce();
        expect(first.getCurrentDeviceKeyStatus).toHaveBeenCalledOnce();
      } else {
        expect(second.getCurrentDeviceKeyStatus).not.toHaveBeenCalled();
        expect(first.getCurrentDeviceKeyStatus).toHaveBeenCalledTimes(2);
      }

      await mounted.unmount();
      mounted = null;
      document.body.innerHTML = "";
    }
  });
});
