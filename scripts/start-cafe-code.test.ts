import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

const startCafeCodeScript = fileURLToPath(new URL("../Start-CafeCode.ps1", import.meta.url));

function toPowerShellLiteralPath(path: string): string {
  return path.replaceAll("'", "''");
}

function resolvePowerShell(): string | null {
  for (const executable of ["pwsh", "powershell.exe"]) {
    const result = spawnSync(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion"],
      {
        encoding: "utf8",
      },
    );
    if (result.error === undefined && result.status === 0) {
      return executable;
    }
  }
  return null;
}

const powerShellExecutable = resolvePowerShell();

function runPowerShell(script: string): string {
  const executable = powerShellExecutable;
  assert.notEqual(executable, null);
  if (executable === null) {
    throw new Error("PowerShell is unavailable.");
  }
  return execFileSync(
    executable,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
    },
  ).trim();
}

const powerShellIt = powerShellExecutable === null ? it.skip : it;

describe("Start-CafeCode PowerShell helpers", () => {
  powerShellIt(
    "selects the first Node executable when Get-Command returns multiple matches",
    () => {
      const selectedPath = runPowerShell(`
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
  );

  powerShellIt("falls back to the next candidate name when the first one is absent", () => {
    const selectedPath = runPowerShell(`
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
  });

  powerShellIt("removes a missing inherited OpenSSL config only for the launch process", () => {
    const result = JSON.parse(
      runPowerShell(`
. '${toPowerShellLiteralPath(startCafeCodeScript)}'
$env:OPENSSL_CONF = "Z:\\definitely-missing\\openssl.cnf"
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
  });

  powerShellIt("preserves an inherited OpenSSL config that names an existing file", () => {
    const result = JSON.parse(
      runPowerShell(`
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
  });
});
