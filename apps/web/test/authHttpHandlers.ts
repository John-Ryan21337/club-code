import {
  EnvironmentId,
  type ExecutionEnvironmentDescriptor,
  type ServerAuthDescriptor,
} from "@cafecode/contracts";
import { HttpResponse, http } from "msw";

// Keep this deterministic but well beyond the supported test horizon. A fixed
// 2026 expiry silently prevented every browser fixture from opening its RPC
// socket once the wall clock passed that date.
const TEST_SESSION_EXPIRES_AT = "2099-05-01T12:00:00.000Z";
const TEST_ENVIRONMENT_DESCRIPTOR: ExecutionEnvironmentDescriptor = {
  environmentId: EnvironmentId.make("environment-local"),
  label: "Local environment",
  platform: {
    os: "darwin",
    arch: "arm64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
};

export function createAuthenticatedSessionHandlers(getAuthDescriptor: () => ServerAuthDescriptor) {
  return [
    http.get("*/.well-known/cafe-code/environment", () =>
      HttpResponse.json(TEST_ENVIRONMENT_DESCRIPTOR),
    ),
    http.get("*/api/auth/session", () =>
      HttpResponse.json({
        authenticated: true,
        auth: getAuthDescriptor(),
        sessionMethod: "browser-session-cookie",
        expiresAt: TEST_SESSION_EXPIRES_AT,
      }),
    ),
    http.post("*/api/auth/bootstrap", () =>
      HttpResponse.json({
        authenticated: true,
        sessionMethod: "browser-session-cookie",
        expiresAt: TEST_SESSION_EXPIRES_AT,
      }),
    ),
    http.post("*/api/auth/ws-token", () =>
      HttpResponse.json({
        token: "browser-test-websocket-token",
        expiresAt: TEST_SESSION_EXPIRES_AT,
      }),
    ),
  ] as const;
}
