import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, it } from "vitest";

const startCafeCodeScript = fileURLToPath(new URL("../Start-CafeCode.ps1", import.meta.url));
const execFileAsync = promisify(execFile);
const nativePowerShellTimeoutMs = 15_000;
const nativePowerShellTestTimeoutMs = 20_000;

function toPowerShellLiteralPath(path: string): string {
  return path.replaceAll("'", "''");
}

function resolvePowerShell(): string | null {
  // Discover without starting native processes during test collection. A found
  // executable must pass the actual helper tests; a broken installation is not a skip.
  const candidates = process.platform === "win32" ? ["pwsh.exe", "powershell.exe"] : ["pwsh"];
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const executable of candidates) {
    for (const directory of directories) {
      const candidate = join(directory, executable);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Try the next explicit PATH candidate.
      }
    }
  }
  return null;
}

const powerShellExecutable = resolvePowerShell();

async function runPowerShell(script: string): Promise<string> {
  const executable = powerShellExecutable;
  assert.notEqual(executable, null);
  if (executable === null) {
    throw new Error("PowerShell is unavailable.");
  }
  const result = execFileAsync(
    executable,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);\n" +
        script,
    ],
    {
      encoding: "utf8",
      timeout: nativePowerShellTimeoutMs,
      windowsHide: true,
      maxBuffer: 64 * 1_024,
    },
  );
  // A bounded async child lets the test runner enforce its own outer deadline.
  result.child.stdin?.end();
  return (await result).stdout.trim();
}

const powerShellIt = powerShellExecutable === null ? it.skip : it;

describe("Start-CafeCode PowerShell helpers", () => {
  powerShellIt(
    "selects the first Node executable when Get-Command returns multiple matches",
    async () => {
      const selectedPath = await runPowerShell(`
. '${toPowerShellLiteralPath(startCafeCodeScript)}'
function Get-Command {
  param([string]$Name, [string]$CommandType, [object]$ErrorAction)

  if ($Name -eq "node.exe") {
    return @(
      [pscustomobject]@{ Path = "C:\\hostedtoolcache\\windows\\node\\24.13.1\\x64\\node.exe" },
      [pscustomobject]@{ Path = "C:\\Program Files\\nodejs\\node.exe" }
    )
  }

  return $null
}

$resolved = Resolve-FirstApplicationPath -Names @("node.exe", "node")
[Console]::Out.Write($resolved)
`);

      assert.equal(selectedPath, "C:\\hostedtoolcache\\windows\\node\\24.13.1\\x64\\node.exe");
    },
    nativePowerShellTestTimeoutMs,
  );

  powerShellIt(
    "falls back to the next candidate name when the first one is absent",
    async () => {
      const selectedPath = await runPowerShell(`
. '${toPowerShellLiteralPath(startCafeCodeScript)}'
function Get-Command {
  param([string]$Name, [string]$CommandType, [object]$ErrorAction)

  if ($Name -eq "node") {
    return [pscustomobject]@{ Path = "C:\\Program Files\\nodejs\\node.exe" }
  }

  return $null
}

$resolved = Resolve-FirstApplicationPath -Names @("node.exe", "node")
[Console]::Out.Write($resolved)
`);

      assert.equal(selectedPath, "C:\\Program Files\\nodejs\\node.exe");
    },
    nativePowerShellTestTimeoutMs,
  );

  powerShellIt(
    "removes a missing inherited OpenSSL config only for the launch process",
    async () => {
      const result = JSON.parse(
        await runPowerShell(`
. '${toPowerShellLiteralPath(startCafeCodeScript)}'
$env:OPENSSL_CONF = Join-Path ([IO.Path]::GetTempPath()) ("missing-openssl-" + [Guid]::NewGuid().ToString("N") + ".cnf")
$removed = Remove-MissingOpenSslConfigOverride
[pscustomobject]@{
  Removed = $removed
  StillPresent = Test-Path Env:OPENSSL_CONF
} | ConvertTo-Json -Compress
`),
      ) as { Removed: boolean; StillPresent: boolean };

      assert.deepEqual(result, {
        Removed: true,
        StillPresent: false,
      });
    },
    nativePowerShellTestTimeoutMs,
  );

  powerShellIt(
    "preserves an inherited OpenSSL config that names an existing file",
    async () => {
      const result = JSON.parse(
        await runPowerShell(`
. '${toPowerShellLiteralPath(startCafeCodeScript)}'
$env:OPENSSL_CONF = '${toPowerShellLiteralPath(startCafeCodeScript)}'
$removed = Remove-MissingOpenSslConfigOverride
[pscustomobject]@{
  Removed = $removed
  Value = $env:OPENSSL_CONF
} | ConvertTo-Json -Compress
`),
      ) as { Removed: boolean; Value: string };

      assert.deepEqual(result, {
        Removed: false,
        Value: startCafeCodeScript,
      });
    },
    nativePowerShellTestTimeoutMs,
  );
});
