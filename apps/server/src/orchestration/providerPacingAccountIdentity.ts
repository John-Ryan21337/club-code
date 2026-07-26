import * as Crypto from "node:crypto";

import type { ServerProvider } from "@cafecode/contracts";

type ProviderAccountIdentityInput = Pick<ServerProvider, "instanceId" | "auth">;

const MINIMUM_SALT_BYTES = 16;
const GENERATED_SALT_BYTES = 32;

function normalizeIdentityPart(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Produces process-local, non-reversible provider account identities.
 *
 * The salt is intentionally not persisted: durable work stores routing
 * identity and resolves the current account again after restart. Raw auth
 * labels and email addresses never leave this boundary.
 */
export class ProviderPacingAccountIdentity {
  readonly #salt: Buffer;

  constructor(salt: Uint8Array = Crypto.randomBytes(GENERATED_SALT_BYTES)) {
    if (salt.byteLength < MINIMUM_SALT_BYTES) {
      throw new RangeError(
        `Provider pacing identity salt must be at least ${MINIMUM_SALT_BYTES} bytes.`,
      );
    }
    this.#salt = Buffer.from(salt);
  }

  forProvider(provider: ProviderAccountIdentityInput): string {
    const email = normalizeIdentityPart(provider.auth.email);
    const label = normalizeIdentityPart(provider.auth.label);
    const type = normalizeIdentityPart(provider.auth.type);
    const authenticatedIdentity =
      provider.auth.status === "authenticated" && (email !== null || label !== null)
        ? JSON.stringify(["authenticated", type, label, email])
        : null;
    const opaqueSource =
      authenticatedIdentity ??
      JSON.stringify(["unresolved", normalizeIdentityPart(String(provider.instanceId))]);
    const prefix = authenticatedIdentity === null ? "unresolved" : "account";
    const digest = Crypto.createHmac("sha256", this.#salt)
      .update(opaqueSource, "utf8")
      .digest("hex");
    return `${prefix}:${digest}`;
  }
}
