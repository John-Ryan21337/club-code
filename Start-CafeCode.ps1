param(
  [switch]$Wait,
  [string[]]$DesktopArgs = @()
)

$ErrorActionPreference = "Stop"
$script:StartCafeCodeRepoRoot = $PSScriptRoot

function Select-FirstApplicationPath {
  param(
    [AllowNull()]
    [object[]]$Commands
  )

  foreach ($command in @($Commands)) {
    if ($null -eq $command) {
      continue
    }

    $path = $command.Path
    if (-not [string]::IsNullOrWhiteSpace($path)) {
      return $path
    }
  }

  return $null
}

function Resolve-FirstApplicationPath {
  param(
    [string[]]$Names
  )

  foreach ($name in $Names) {
    # GitHub Windows runners can expose more than one matching Node application
    # on PATH (for example actions/setup-node plus the preinstalled Node path).
    # PowerShell returns both entries, so select a single executable path before
    # probing the version or launching the desktop process.
    $path = Select-FirstApplicationPath -Commands (
      Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue
    )
    if (-not [string]::IsNullOrWhiteSpace($path)) {
      return $path
    }
  }

  return $null
}

function Remove-MissingOpenSslConfigOverride {
  $configuredPath = $env:OPENSSL_CONF
  if ([string]::IsNullOrWhiteSpace($configuredPath)) {
    return $false
  }

  $normalizedPath = $configuredPath.Trim().Trim('"')
  if (Test-Path -LiteralPath $normalizedPath -PathType Leaf) {
    return $false
  }

  # OPENSSL_CONF is sometimes left behind by an uninstalled database or SDK.
  # Remove only this launcher's inherited copy: the machine/user environment is
  # untouched, while OpenSSL can fall back to its own valid default config.
  Remove-Item Env:OPENSSL_CONF -ErrorAction SilentlyContinue
  return $true
}

function Invoke-StartCafeCode {
  param(
    [switch]$Wait,
    [string[]]$DesktopArgs = @()
  )

  $repo = $script:StartCafeCodeRepoRoot
  $logDir = Join-Path $env:USERPROFILE ".cafe-code\launcher-logs"
  $launcherLog = Join-Path $logDir "launcher.log"
  $stdoutLog = Join-Path $logDir "desktop-start.stdout.log"
  $stderrLog = Join-Path $logDir "desktop-start.stderr.log"

  New-Item -ItemType Directory -Force -Path $logDir | Out-Null

  $nodePath = Resolve-FirstApplicationPath -Names @("node.exe", "node")
  if ([string]::IsNullOrWhiteSpace($nodePath)) {
    throw "Node.js 24.13.1 or newer in the Node 24 release line was not found on PATH."
  }

  $nodeVersionText = (& $nodePath --version).Trim().TrimStart("v")
  $nodeVersion = [Version]$nodeVersionText
  if ($nodeVersion.Major -ne 24 -or $nodeVersion -lt [Version]"24.13.1") {
    throw "Club Code requires Node.js ^24.13.1; found $nodeVersionText at $nodePath."
  }

  # The current dev build defaults local HTTPS on. Source installs on Windows do
  # not always have OpenSSL available on PATH, so only disable backend HTTPS when
  # the helper the backend uses to mint the local certificate is not discoverable.
  # Use CommandType Application so aliases/functions cannot spoof this readiness
  # check; if OpenSSL exists, let the normal desktop settings/exposure flow decide.
  $removedMissingOpenSslConfig = Remove-MissingOpenSslConfigOverride
  if ($removedMissingOpenSslConfig) {
    "Inherited OPENSSL_CONF did not name an existing file; ignored it for this Club Code launch." |
      Add-Content -LiteralPath $launcherLog
  }

  $opensslPath = Resolve-FirstApplicationPath -Names @("openssl.exe", "openssl")

  if ([string]::IsNullOrWhiteSpace($opensslPath)) {
    $env:CAFE_CODE_HTTPS_ENABLED = "false"
    "OpenSSL was not found on PATH; starting Club Code with local backend HTTPS disabled." |
      Add-Content -LiteralPath $launcherLog
  } else {
    "OpenSSL was found on PATH; preserving Club Code local backend HTTPS defaults." |
      Add-Content -LiteralPath $launcherLog
  }

  $desktopProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList (@("apps/desktop/scripts/start-electron.mjs") + $DesktopArgs) `
    -WorkingDirectory $repo `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden `
    -PassThru

  if ($Wait) {
    $desktopProcess.WaitForExit()
    exit $desktopProcess.ExitCode
  }
}

if ($MyInvocation.InvocationName -ne ".") {
  Invoke-StartCafeCode -Wait:$Wait -DesktopArgs $DesktopArgs
}
