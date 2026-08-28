export interface HardwareLightingPublisherIdentity {
  readonly browser: string | undefined;
  readonly ipAddress: string | undefined;
  readonly role: "owner" | "client";
}

function isLoopbackAddress(value: string | undefined): boolean {
  return value === "::1" || value === "127.0.0.1" || value?.startsWith("127.") === true;
}

/**
 * Physical writes require the owner Electron renderer on the host machine.
 * Remote WebUI clients remain able to configure the persisted opt-in and
 * controller selection, but cannot impersonate the palette publisher.
 */
export function canPublishHardwareLightingFrame(
  identity: HardwareLightingPublisherIdentity,
): boolean {
  return (
    identity.role === "owner" &&
    identity.browser === "Electron" &&
    isLoopbackAddress(identity.ipAddress)
  );
}
