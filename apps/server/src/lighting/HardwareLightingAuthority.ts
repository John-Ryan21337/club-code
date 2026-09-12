import type { ClientSettingsPatch } from "@cafecode/contracts";

/** These are server-observed authentication and transport facts, not renderer claims. */
export function canManageHardwareLighting(role: string, secureTransport: boolean): boolean {
  return role === "owner" && secureTransport;
}

export function changesHardwareLightingSettings(patch: ClientSettingsPatch): boolean {
  return (
    patch.hardwareLightingSyncEnabled !== undefined ||
    patch.hardwareLightingControllerIds !== undefined ||
    patch.hardwareLightingBrightness !== undefined ||
    patch.hardwareLightingRestoreOnDisable !== undefined
  );
}
