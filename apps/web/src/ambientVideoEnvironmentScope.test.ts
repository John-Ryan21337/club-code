import { EnvironmentId } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  resolveAmbientVideoEnvironmentScope,
  UNASSIGNED_AMBIENT_VIDEO_ENVIRONMENT_SCOPE,
} from "./ambientVideoEnvironmentScope";

const PRIMARY_ENVIRONMENT_ID = EnvironmentId.make("environment-primary");
const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("environment-remote");
const SECOND_REMOTE_ENVIRONMENT_ID = EnvironmentId.make("environment-remote-2");

describe("resolveAmbientVideoEnvironmentScope", () => {
  it("uses the routed thread environment instead of the primary active environment", () => {
    expect(
      resolveAmbientVideoEnvironmentScope({
        routeEnvironmentId: REMOTE_ENVIRONMENT_ID,
        retainedRouteEnvironmentId: null,
        activeEnvironmentId: PRIMARY_ENVIRONMENT_ID,
        settingsRouteActive: false,
      }),
    ).toEqual({
      scopeKey: REMOTE_ENVIRONMENT_ID,
      retainedRouteEnvironmentId: REMOTE_ENVIRONMENT_ID,
    });
  });

  it("retains the exact routed environment only while Settings hides route parameters", () => {
    const routed = resolveAmbientVideoEnvironmentScope({
      routeEnvironmentId: REMOTE_ENVIRONMENT_ID,
      retainedRouteEnvironmentId: null,
      activeEnvironmentId: PRIMARY_ENVIRONMENT_ID,
      settingsRouteActive: false,
    });
    const settings = resolveAmbientVideoEnvironmentScope({
      routeEnvironmentId: null,
      retainedRouteEnvironmentId: routed.retainedRouteEnvironmentId,
      activeEnvironmentId: PRIMARY_ENVIRONMENT_ID,
      settingsRouteActive: true,
    });

    expect(settings).toEqual({
      scopeKey: REMOTE_ENVIRONMENT_ID,
      retainedRouteEnvironmentId: REMOTE_ENVIRONMENT_ID,
    });
    expect(
      resolveAmbientVideoEnvironmentScope({
        routeEnvironmentId: SECOND_REMOTE_ENVIRONMENT_ID,
        retainedRouteEnvironmentId: settings.retainedRouteEnvironmentId,
        activeEnvironmentId: PRIMARY_ENVIRONMENT_ID,
        settingsRouteActive: false,
      }),
    ).toEqual({
      scopeKey: SECOND_REMOTE_ENVIRONMENT_ID,
      retainedRouteEnvironmentId: SECOND_REMOTE_ENVIRONMENT_ID,
    });
    expect(
      resolveAmbientVideoEnvironmentScope({
        routeEnvironmentId: null,
        retainedRouteEnvironmentId: settings.retainedRouteEnvironmentId,
        activeEnvironmentId: PRIMARY_ENVIRONMENT_ID,
        settingsRouteActive: false,
      }),
    ).toEqual({
      scopeKey: PRIMARY_ENVIRONMENT_ID,
      retainedRouteEnvironmentId: null,
    });
  });

  it("uses the active environment for a direct Settings load and handles an empty store", () => {
    expect(
      resolveAmbientVideoEnvironmentScope({
        routeEnvironmentId: null,
        retainedRouteEnvironmentId: null,
        activeEnvironmentId: PRIMARY_ENVIRONMENT_ID,
        settingsRouteActive: true,
      }),
    ).toEqual({
      scopeKey: PRIMARY_ENVIRONMENT_ID,
      retainedRouteEnvironmentId: null,
    });
    expect(
      resolveAmbientVideoEnvironmentScope({
        routeEnvironmentId: null,
        retainedRouteEnvironmentId: null,
        activeEnvironmentId: null,
        settingsRouteActive: true,
      }),
    ).toEqual({
      scopeKey: UNASSIGNED_AMBIENT_VIDEO_ENVIRONMENT_SCOPE,
      retainedRouteEnvironmentId: null,
    });
  });
});
