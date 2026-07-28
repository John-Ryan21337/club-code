import assert from "node:assert/strict";

import { CodexSettings, ProviderInstanceId } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { describe, it } from "vitest";

import { resolveCodexRuntimeEnvironment, withDefaultCodexShadowHome } from "./CodexDriver.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

describe("withDefaultCodexShadowHome", () => {
  it("isolates the default Codex instance in a Cafe Code shadow home", () => {
    const config = decodeCodexSettings({});

    const resolved = withDefaultCodexShadowHome({
      instanceId: ProviderInstanceId.make("codex"),
      config,
    });

    assert.equal(resolved.homePath, "");
    assert.equal(resolved.shadowHomePath, "~/.cafe-code/codex-homes/codex");
  });

  it("preserves explicit Codex home settings", () => {
    const explicitHome = decodeCodexSettings({ homePath: "~/.codex-work" });
    const explicitShadow = decodeCodexSettings({ shadowHomePath: "~/.codex-cafe-work" });

    assert.equal(
      withDefaultCodexShadowHome({
        instanceId: ProviderInstanceId.make("codex"),
        config: explicitHome,
      }),
      explicitHome,
    );
    assert.equal(
      withDefaultCodexShadowHome({
        instanceId: ProviderInstanceId.make("codex"),
        config: explicitShadow,
      }),
      explicitShadow,
    );
  });

  it("uses stable provider instance ids in default shadow paths", () => {
    const config = decodeCodexSettings({});

    const resolved = withDefaultCodexShadowHome({
      instanceId: ProviderInstanceId.make("codex_personal-prod"),
      config,
    });

    assert.equal(resolved.shadowHomePath, "~/.cafe-code/codex-homes/codex_personal-prod");
  });
});

describe("resolveCodexRuntimeEnvironment", () => {
  it("scopes a normalized LAN endpoint to an LM Studio provider instance", () => {
    const original = { KEEP_ME: "yes", CODEX_OSS_BASE_URL: "http://stale.invalid/v1" };
    const resolved = resolveCodexRuntimeEnvironment(
      decodeCodexSettings({
        ossMode: true,
        ossBaseUrl: "http://192.168.30.25:1234/",
      }),
      original,
    );

    assert.deepEqual(resolved, {
      KEEP_ME: "yes",
      CODEX_OSS_BASE_URL: "http://192.168.30.25:1234/v1",
    });
    assert.equal(original.CODEX_OSS_BASE_URL, "http://stale.invalid/v1");
  });

  it("does not inject the LM Studio endpoint into a cloud Codex instance", () => {
    const environment = { KEEP_ME: "yes" };
    assert.equal(resolveCodexRuntimeEnvironment(decodeCodexSettings({}), environment), environment);
  });
});
