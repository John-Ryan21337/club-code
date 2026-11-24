import type { EnvironmentId, ResearchAction, ResearchState } from "@cafecode/contracts";
import {
  getPrimaryKnownEnvironment,
  resolvePrimaryEnvironmentHttpUrl,
} from "./environments/primary";
import {
  resolveEnvironmentHttpUrl,
  readSavedEnvironmentBearerToken,
} from "./environments/runtime/catalog";

export async function researchRequest(
  environmentId: EnvironmentId,
  action: ResearchAction,
): Promise<ResearchState> {
  const primary = getPrimaryKnownEnvironment()?.environmentId === environmentId;
  const token = primary ? null : await readSavedEnvironmentBearerToken(environmentId);
  if (!primary && !token) throw new Error("Connect to this server before using API research.");
  const url = primary
    ? resolvePrimaryEnvironmentHttpUrl("/api/research")
    : resolveEnvironmentHttpUrl({ environmentId, pathname: "/api/research" });
  const response = await fetch(url, {
    method: "POST",
    credentials: primary ? "include" : "omit",
    redirect: "error",
    signal: AbortSignal.timeout(75000),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    let message = `API research request failed (HTTP ${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.error === "string") message = body.error;
    } catch {
      /* Keep the status when the server is older or unavailable. */
    }
    throw new Error(message);
  }
  return response.json();
}
