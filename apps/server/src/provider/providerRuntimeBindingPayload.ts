import { ModelSelection } from "@cafecode/contracts";
import * as Schema from "effect/Schema";

import type { ProviderRuntimeBinding } from "./Services/ProviderSessionDirectory.ts";

/**
 * Readers for the durable provider session binding payload.
 *
 * `ProviderService` writes this JSON blob once per session (`cwd`,
 * `additionalDirectories`, `model`, `modelSelection`, `activeTurnId`, the owner
 * lease, ...). It is decoded in two places that must agree: `ProviderService`
 * when it re-materializes a session from its binding, and
 * `ProviderCommandReactor` when it decides whether a projected session can be
 * routed to without re-running that materialization. A hand-copied reader in
 * either place would drift from the other and silently turn "settings still
 * match" into a false positive, so both import these.
 */

const isModelSelection = Schema.is(ModelSelection);

function readPayloadRecord(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): Readonly<Record<string, unknown>> | undefined {
  return runtimePayload !== null &&
    runtimePayload !== undefined &&
    typeof runtimePayload === "object" &&
    !Array.isArray(runtimePayload)
    ? (runtimePayload as Readonly<Record<string, unknown>>)
    : undefined;
}

export function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  const raw = readPayloadRecord(runtimePayload)?.modelSelection;
  return isModelSelection(raw) ? raw : undefined;
}

/** The provider turn the binding was last written for, or `undefined` when idle or absent. */
export function readPersistedActiveTurnId(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  const raw = readPayloadRecord(runtimePayload)?.activeTurnId;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  const rawCwd = readPayloadRecord(runtimePayload)?.cwd;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readPersistedAdditionalDirectories(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ReadonlyArray<string> | undefined {
  const rawDirectories = readPayloadRecord(runtimePayload)?.additionalDirectories;
  if (!Array.isArray(rawDirectories)) {
    return undefined;
  }
  return rawDirectories.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}
