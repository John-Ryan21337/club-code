import assert from "node:assert/strict";

import {
  CodexSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@cafecode/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";
import { describe, it } from "vitest";

import {
  CODEX_PROBE_POLICY,
  resolveCodexRuntimeEnvironment,
  resolveCodexShadowHomeAuthSource,
  withDefaultCodexShadowHome,
} from "./CodexDriver.ts";
import {
  CODEX_CLI_LOGIN_STATUS_TIMEOUT_MESSAGE,
  isCodexCliLoginStatusProbeInconclusive,
  makeCodexHealthProbeCommand,
} from "../Layers/CodexProvider.ts";
import { terminateProbeChild } from "../providerSnapshot.ts";

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

describe("resolveCodexShadowHomeAuthSource", () => {
  it("keeps LM Studio shadow homes free of cloud credentials", () => {
    assert.equal(
      resolveCodexShadowHomeAuthSource(
        decodeCodexSettings({
          ossMode: true,
          homePath: "",
          shadowHomePath: "~/.cafe-code/codex-homes/lmstudio",
        }),
      ),
      "none",
    );
  });

  it("preserves the existing cloud auth source rules", () => {
    assert.equal(
      resolveCodexShadowHomeAuthSource(
        decodeCodexSettings({
          homePath: "",
          shadowHomePath: "~/.cafe-code/codex-homes/work",
        }),
      ),
      "shadow",
    );
    assert.equal(
      resolveCodexShadowHomeAuthSource(
        decodeCodexSettings({
          homePath: "~/.codex",
          shadowHomePath: "~/.cafe-code/codex-homes/work",
        }),
      ),
      "shared",
    );
  });
});

describe("CODEX_PROBE_POLICY", () => {
  it("delegates initial admission to the registry and bounds inconclusive retention", () => {
    assert.equal(CODEX_PROBE_POLICY.initialRefresh, "external");
    assert.equal(CODEX_PROBE_POLICY.inconclusiveFailureThreshold, 3);
    assert.equal(CODEX_PROBE_POLICY.isInconclusiveSnapshot, isCodexCliLoginStatusProbeInconclusive);
  });

  it("classifies only the bounded login-status timeout as inconclusive", () => {
    const timeoutSnapshot = {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: "0.133.0",
      status: "warning",
      auth: { status: "unknown" },
      checkedAt: "2026-04-10T00:00:00.000Z",
      message: CODEX_CLI_LOGIN_STATUS_TIMEOUT_MESSAGE,
      models: [],
      slashCommands: [],
      skills: [],
    } as const satisfies ServerProvider;

    assert.equal(CODEX_PROBE_POLICY.isInconclusiveSnapshot(timeoutSnapshot), true);
    // A conclusive signed-out answer must stay visible immediately.
    assert.equal(
      CODEX_PROBE_POLICY.isInconclusiveSnapshot({
        ...timeoutSnapshot,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Codex CLI is not authenticated.",
      }),
      false,
    );
    // A missing CLI is not a timeout either.
    assert.equal(
      CODEX_PROBE_POLICY.isInconclusiveSnapshot({
        ...timeoutSnapshot,
        installed: false,
        message: "Codex CLI (`codex`) is not installed or not on PATH.",
      }),
      false,
    );
    // Another driver reusing the same wording must not borrow Codex's policy.
    assert.equal(
      CODEX_PROBE_POLICY.isInconclusiveSnapshot({
        ...timeoutSnapshot,
        driver: ProviderDriverKind.make("claudeAgent"),
      }),
      false,
    );
  });
});

describe("Codex CLI health probe command", () => {
  it("isolates POSIX descendants and gives scope cleanup a SIGKILL backstop", () => {
    const command = makeCodexHealthProbeCommand(
      decodeCodexSettings({
        binaryPath: "/opt/codex/bin/codex",
        homePath: "/private/codex-home",
      }),
      ["--version"],
      { PATH: "/usr/bin" },
    );

    assert.equal(command.command, "/opt/codex/bin/codex");
    assert.deepEqual([...command.args], ["--version"]);
    // Windows keeps the platform default so the spawner's child-tree
    // termination path (taskkill) still owns descendant cleanup.
    assert.equal(command.options.detached, process.platform !== "win32");
    assert.equal(command.options.shell, process.platform === "win32");
    assert.equal(command.options.killSignal, "SIGKILL");
    assert.equal(command.options.env?.PATH, "/usr/bin");
    assert.equal(command.options.env?.CODEX_HOME, "/private/codex-home");
  });

  it("waits for graceful exit before escalating a stubborn probe to SIGKILL", async () => {
    const signals: Array<string> = [];
    const child = {
      isRunning: Effect.succeed(true),
      kill: (options?: ChildProcess.KillOptions) => {
        signals.push(options?.killSignal ?? "SIGTERM");
        return options?.killSignal === "SIGTERM" ? Effect.never : Effect.void;
      },
    };

    const timedOut = await Effect.runPromise(
      Effect.never.pipe(
        Effect.ensuring(terminateProbeChild(child, Duration.millis(5))),
        Effect.timeoutOption(Duration.millis(5)),
      ),
    );

    assert.equal(timedOut._tag, "None");
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  });

  it("never signals a probe child that already exited", async () => {
    const signals: Array<string> = [];
    const child = {
      isRunning: Effect.succeed(false),
      kill: (options?: ChildProcess.KillOptions) => {
        signals.push(options?.killSignal ?? "SIGTERM");
        return Effect.void;
      },
    };

    await Effect.runPromise(terminateProbeChild(child, Duration.millis(5)));

    assert.deepEqual(signals, []);
  });

  it("still escalates when the running check itself fails", async () => {
    const signals: Array<string> = [];
    const child = {
      isRunning: Effect.fail(new Error("handle closed")),
      kill: (options?: ChildProcess.KillOptions) => {
        signals.push(options?.killSignal ?? "SIGTERM");
        return Effect.void;
      },
      // A well-behaved process leaves promptly after SIGTERM, so no SIGKILL
      // follows. (A handle without an exit signal is treated as never exiting.)
      exitCode: Effect.void,
    };

    await Effect.runPromise(terminateProbeChild(child, Duration.millis(5)));

    assert.deepEqual(signals, ["SIGTERM"]);
  });
});
