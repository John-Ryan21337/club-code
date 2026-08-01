import type { CollaborationNetworkClient } from "@cafecode/client-runtime";

import type { CoworkCurrentDeviceKeyClient } from "./currentDeviceKeyPanel.ts";

function ownCallable<Key extends "getCurrentDeviceKeyStatus" | "revokeCurrentDeviceKey">(
  client: CollaborationNetworkClient,
  key: Key,
): CollaborationNetworkClient[Key] {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(client, key);
  } catch {
    throw new Error("collaboration network client could not be inspected safely");
  }
  if (
    !descriptor ||
    !Object.hasOwn(descriptor, "value") ||
    typeof descriptor.value !== "function"
  ) {
    throw new Error(`collaboration network client requires own callable ${key}`);
  }
  return descriptor.value as CollaborationNetworkClient[Key];
}

/**
 * Narrow web composition for the current-device panel. It forwards only the
 * two fixed device commands and preserves the exact revoke request object when
 * the panel retries an indeterminate acknowledgement.
 */
export function coworkCurrentDeviceKeyClientFromNetwork(
  client: CollaborationNetworkClient,
): CoworkCurrentDeviceKeyClient {
  const status = ownCallable(client, "getCurrentDeviceKeyStatus");
  const revoke = ownCallable(client, "revokeCurrentDeviceKey");
  return Object.freeze({
    getCurrentDeviceKeyStatus: (
      request: Parameters<CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"]>[0],
      options?: Parameters<CoworkCurrentDeviceKeyClient["getCurrentDeviceKeyStatus"]>[1],
    ) => Reflect.apply(status, client, [request, options]),
    revokeCurrentDeviceKey: (
      request: Parameters<CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"]>[0],
      options?: Parameters<CoworkCurrentDeviceKeyClient["revokeCurrentDeviceKey"]>[1],
    ) => Reflect.apply(revoke, client, [request, options]),
  });
}
