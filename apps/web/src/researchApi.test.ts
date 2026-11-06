import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentId } from "@cafecode/contracts";
import { researchRequest } from "./researchApi";
import {
  getPrimaryKnownEnvironment,
  resolvePrimaryEnvironmentHttpUrl,
} from "./environments/primary";
import {
  resolveEnvironmentHttpUrl,
  readSavedEnvironmentBearerToken,
} from "./environments/runtime/catalog";

vi.mock("./environments/primary", () => ({
  getPrimaryKnownEnvironment: vi.fn(),
  resolvePrimaryEnvironmentHttpUrl: vi.fn(),
}));
vi.mock("./environments/runtime/catalog", () => ({
  resolveEnvironmentHttpUrl: vi.fn(),
  readSavedEnvironmentBearerToken: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("sends a remote research key only to that environment with its own bearer session", async () => {
  const remote = EnvironmentId.make("remote");
  vi.mocked(resolveEnvironmentHttpUrl).mockReturnValue(
    "https://research-server.example/api/research",
  );
  vi.mocked(readSavedEnvironmentBearerToken).mockResolvedValue("remote-session-fixture");
  const transport = vi.fn().mockResolvedValue(Response.json({ configured: true, jobs: [] }));
  vi.stubGlobal("fetch", transport);
  await researchRequest(remote, { action: "configure", key: "sk-fixture-not-a-real-key" });
  expect(resolveEnvironmentHttpUrl).toHaveBeenCalledWith({
    environmentId: remote,
    pathname: "/api/research",
  });
  expect(transport).toHaveBeenCalledWith(
    "https://research-server.example/api/research",
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer remote-session-fixture",
      },
    }),
  );
  expect(resolvePrimaryEnvironmentHttpUrl).not.toHaveBeenCalled();
});

it("does not fall back to the primary server when a remote session is missing", async () => {
  vi.mocked(readSavedEnvironmentBearerToken).mockResolvedValue(null);
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  await expect(
    researchRequest(EnvironmentId.make("remote"), { action: "list", scope: "*" }),
  ).rejects.toThrow("Connect to this server");
  expect(transport).not.toHaveBeenCalled();
  expect(getPrimaryKnownEnvironment).toHaveBeenCalled();
});
