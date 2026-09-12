import type { EnvironmentId } from "@cafecode/contracts";

export const UNASSIGNED_AMBIENT_VIDEO_ENVIRONMENT_SCOPE = "unassigned-environment";

export interface AmbientVideoEnvironmentScopeResolution {
  readonly scopeKey: string;
  readonly retainedRouteEnvironmentId: EnvironmentId | null;
}

/**
 * Resolve the identity boundary for a long-lived ambient player.
 *
 * Settings removes thread route parameters, so it inherits only the most
 * recently committed thread environment. Other routes fall back to the
 * primary/active environment and clear that retained thread identity.
 */
export function resolveAmbientVideoEnvironmentScope(input: {
  readonly routeEnvironmentId: EnvironmentId | null;
  readonly retainedRouteEnvironmentId: EnvironmentId | null;
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly settingsRouteActive: boolean;
}): AmbientVideoEnvironmentScopeResolution {
  if (input.routeEnvironmentId !== null) {
    return {
      scopeKey: input.routeEnvironmentId,
      retainedRouteEnvironmentId: input.routeEnvironmentId,
    };
  }

  if (input.settingsRouteActive) {
    return {
      scopeKey:
        input.retainedRouteEnvironmentId ??
        input.activeEnvironmentId ??
        UNASSIGNED_AMBIENT_VIDEO_ENVIRONMENT_SCOPE,
      retainedRouteEnvironmentId: input.retainedRouteEnvironmentId,
    };
  }

  return {
    scopeKey: input.activeEnvironmentId ?? UNASSIGNED_AMBIENT_VIDEO_ENVIRONMENT_SCOPE,
    retainedRouteEnvironmentId: null,
  };
}
