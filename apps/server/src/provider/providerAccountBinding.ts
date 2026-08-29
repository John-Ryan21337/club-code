import type { ServerProvider } from "@cafecode/contracts";

/**
 * Account identity as observed by provider probes is free text from the CLI
 * (`codex login status`, Claude account metadata). The same account can be
 * reported with different casing or surrounding whitespace between two
 * probes, so every decision that asks "is this still the same account?" —
 * usage retention inside a managed provider, the registry's rate-limit
 * carry-forward, and cooldown resets — must compare through one
 * normalization or they disagree and the usage widget flickers.
 */
export function normalizedAccountBinding(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function hasProviderAccountBindingChanged(
  previous: ServerProvider["auth"],
  next: ServerProvider["auth"],
): boolean {
  if (previous.status !== next.status) {
    return true;
  }
  if (previous.status !== "authenticated" || next.status !== "authenticated") {
    return false;
  }
  return (
    normalizedAccountBinding(previous.email) !== normalizedAccountBinding(next.email) ||
    normalizedAccountBinding(previous.type) !== normalizedAccountBinding(next.type)
  );
}

/** Same authenticated account on both sides, compared through the shared normalization. */
export function isSameAuthenticatedProviderAccount(
  previous: ServerProvider["auth"],
  next: ServerProvider["auth"],
): boolean {
  return (
    previous.status === "authenticated" &&
    next.status === "authenticated" &&
    normalizedAccountBinding(previous.type) === normalizedAccountBinding(next.type) &&
    normalizedAccountBinding(previous.email) !== undefined &&
    normalizedAccountBinding(previous.email) === normalizedAccountBinding(next.email)
  );
}
