import type { CollaborationNetworkClient } from "@cafecode/client-runtime";
import { describe, expect, it, vi } from "vitest";

import { coworkCurrentDeviceKeyClientFromNetwork } from "./collaborationCurrentDeviceKeyClient.ts";
import type { CoworkCurrentDeviceKeyClient } from "./currentDeviceKeyPanel.ts";

function networkClient(
  status = vi.fn<CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"]>(async () => ({
    status: "active",
  })),
  revoke = vi.fn<CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"]>(async () => ({
    disposition: "revoked",
  })),
) {
  return {
    getCurrentDeviceKeyStatus: status,
    revokeCurrentDeviceKey: revoke,
  } as unknown as CollaborationNetworkClient;
}

describe("coworkCurrentDeviceKeyClientFromNetwork", () => {
  it("forwards only the project status request and preserves exact revoke reuse", async () => {
    const status = vi.fn<CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"]>(async () => ({
      status: "active",
    }));
    const revoke = vi.fn<CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"]>(async () => ({
      disposition: "revoked",
    }));
    const adapter = coworkCurrentDeviceKeyClientFromNetwork(networkClient(status, revoke));
    const statusRequest = Object.freeze({ sharedProjectId: "project-1" }) as never;
    const revokeRequest = Object.freeze({
      commandId: "command-1",
      sharedProjectId: "project-1",
      deviceKeyId: "device-key-1",
    }) as never;
    const statusOptions = Object.freeze({ signal: new AbortController().signal });
    const revokeOptions = Object.freeze({ signal: new AbortController().signal });

    await adapter.getCurrentDeviceKeyStatus(statusRequest, statusOptions);
    await adapter.revokeCurrentDeviceKey(revokeRequest, revokeOptions);
    await adapter.revokeCurrentDeviceKey(revokeRequest, revokeOptions);

    expect(status).toHaveBeenCalledWith(statusRequest, statusOptions);
    expect(Reflect.ownKeys(status.mock.calls[0]![0] as object)).toEqual(["sharedProjectId"]);
    expect(revoke.mock.calls[0]![0]).toBe(revokeRequest);
    expect(revoke.mock.calls[1]![0]).toBe(revokeRequest);
    expect(revoke.mock.calls[0]![1]).toBe(revokeOptions);
    expect(revoke.mock.calls[1]![1]).toBe(revokeOptions);
    expect(Object.isFrozen(adapter)).toBe(true);
  });

  it("rejects inherited, accessor, and missing network methods without invoking them", () => {
    const inherited = Object.create(networkClient()) as CollaborationNetworkClient;
    expect(() => coworkCurrentDeviceKeyClientFromNetwork(inherited)).toThrow(/own callable/);

    const accessor = {} as CollaborationNetworkClient;
    Object.defineProperty(accessor, "getCurrentDeviceKeyStatus", {
      get: () => vi.fn(),
    });
    Object.defineProperty(accessor, "revokeCurrentDeviceKey", { value: vi.fn() });
    expect(() => coworkCurrentDeviceKeyClientFromNetwork(accessor)).toThrow(/own callable/);

    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("SECRET_PROXY_TRAP_DETAIL");
        },
      },
    ) as CollaborationNetworkClient;
    expect(() => coworkCurrentDeviceKeyClientFromNetwork(hostile)).toThrow(
      /could not be inspected safely/,
    );
    expect(() => coworkCurrentDeviceKeyClientFromNetwork(hostile)).not.toThrow(
      /SECRET_PROXY_TRAP_DETAIL/,
    );
  });
});
