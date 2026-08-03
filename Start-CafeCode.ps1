param(
  [switch]$Wait,
  [string[]]$DesktopArgs = @()
)

$ErrorActionPreference = "Stop"
$script:StartCafeCodeRepoRoot = $PSScriptRoot

# The desktop app loads these at runtime. If any is missing (for example after a
# clean) Electron shows a bare "Error" window while every log still reports
# success, so the launcher must confirm them before spawning the process.
$script:StartCafeCodeRequiredArtifacts = @(
  "apps/desktop/dist-electron/main.cjs",
  "apps/server/dist/bin.mjs",
  "apps/web/dist/index.html"
)

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

function Get-HeadCommitTimeUtc {
  param(
    [string]$RepoRoot
  )

  $gitPath = Resolve-FirstApplicationPath -Names @("git.exe", "git")
  if ([string]::IsNullOrWhiteSpace($gitPath)) {
    return $null
  }

  try {
    $unixTimeText = @(& $gitPath -C $RepoRoot log -1 --format=%ct) | Select-Object -First 1
  } catch {
    return $null
  }
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($unixTimeText)) {
    return $null
  }

  $unixSeconds = [long]0
  if (-not [long]::TryParse(([string]$unixTimeText).Trim(), [ref]$unixSeconds)) {
    return $null
  }

  return [DateTimeOffset]::FromUnixTimeSeconds($unixSeconds).UtcDateTime
}

function Get-HeadCommitSha {
  param(
    [string]$RepoRoot
  )

  $gitPath = Resolve-FirstApplicationPath -Names @("git.exe", "git")
  if ([string]::IsNullOrWhiteSpace($gitPath)) {
    return $null
  }

  try {
    $shaText = @(& $gitPath -C $RepoRoot rev-parse HEAD) | Select-Object -First 1
  } catch {
    return $null
  }
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($shaText)) {
    return $null
  }
  return ([string]$shaText).Trim()
}

function Get-StaleBuildArtifactReasons {
  param(
    [string]$RepoRoot,
    [AllowNull()]
    [Nullable[datetime]]$HeadCommitTimeUtc
  )

  # An artifact is stale when it is missing or older than the current HEAD
  # commit. When git or the commit time is unavailable the caller passes $null
  # and only existence is checked.
  $reasons = @()
  foreach ($relativePath in $script:StartCafeCodeRequiredArtifacts) {
    $artifactPath = Join-Path $RepoRoot $relativePath
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
      $reasons += "$relativePath is missing"
      continue
    }

    if ($null -ne $HeadCommitTimeUtc) {
      $artifactTimeUtc = (Get-Item -LiteralPath $artifactPath).LastWriteTimeUtc
      if ($artifactTimeUtc -lt $HeadCommitTimeUtc) {
        $reasons += "$relativePath (written $($artifactTimeUtc.ToString('u'))) is older than the HEAD commit ($($HeadCommitTimeUtc.ToString('u')))"
      }
    }
  }

  return $reasons
}

function Show-CafeCodeLauncherError {
  param(
    [string]$Message
  )

  # The defect this launcher guards against was a silent failure: Electron shows
  # a bare "Error" window while the logs report success. Surface build problems
  # somewhere the operator will actually see them, not only in the log file.
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    [void][System.Windows.Forms.MessageBox]::Show(
      $Message,
      "Cafe Code launcher",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    )
  } catch {
    # No interactive desktop or WinForms unavailable; the caller still throws,
    # so a console host prints the failure and the launcher log has the details.
  }
}

function Invoke-CafeCodeBuild {
  param(
    [string]$RepoRoot,
    [string]$BuildStdoutLog,
    [string]$BuildStderrLog
  )

  # corepack ships with Node; plain `yarn` is not guaranteed to be on PATH.
  $corepackPath = Resolve-FirstApplicationPath -Names @("corepack.cmd", "corepack.exe", "corepack")
  if ([string]::IsNullOrWhiteSpace($corepackPath)) {
    throw "corepack was not found on PATH, so the stale Club Code build cannot be refreshed. Run 'corepack yarn build' in $RepoRoot manually."
  }

  $buildProcess = Start-Process `
    -FilePath $corepackPath `
    -ArgumentList @("yarn", "build") `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $BuildStdoutLog `
    -RedirectStandardError $BuildStderrLog `
    -WindowStyle Hidden `
    -Wait `
    -PassThru

  return $buildProcess.ExitCode
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

  $headCommitTimeUtc = Get-HeadCommitTimeUtc -RepoRoot $repo
  if ($null -eq $headCommitTimeUtc) {
    "Could not read the HEAD commit time from git; checking build artifacts for existence only." |
      Add-Content -LiteralPath $launcherLog
  }

  # Cached monorepo builds legitimately leave artifact mtimes older than HEAD
  # (an unchanged task's output is not rewritten), which would make the mtime
  # rule rebuild on every launch forever. A marker recording the HEAD sha of
  # the last verified-good build breaks that loop: if the marker matches HEAD
  # and every artifact exists, the build is current regardless of mtimes.
  $buildMarkerPath = Join-Path $logDir "last-verified-build-head.txt"
  $headCommitSha = Get-HeadCommitSha -RepoRoot $repo
  $markerMatchesHead = $false
  if ($null -ne $headCommitSha -and (Test-Path -LiteralPath $buildMarkerPath -PathType Leaf)) {
    $markerSha = (Get-Content -LiteralPath $buildMarkerPath -ErrorAction SilentlyContinue |
      Select-Object -First 1)
    if ($markerSha -eq $headCommitSha) {
      $missingOnly = @(Get-StaleBuildArtifactReasons -RepoRoot $repo -HeadCommitTimeUtc $null)
      $markerMatchesHead = $missingOnly.Count -eq 0
    }
  }

  $staleReasons = @(Get-StaleBuildArtifactReasons -RepoRoot $repo -HeadCommitTimeUtc $headCommitTimeUtc)
  if ($markerMatchesHead -and $staleReasons.Count -gt 0) {
    "Build marker matches HEAD $headCommitSha and all artifacts exist; skipping rebuild despite older artifact timestamps (cached build)." |
      Add-Content -LiteralPath $launcherLog
    $staleReasons = @()
  }
  if ($staleReasons.Count -gt 0) {
    $buildStdoutLog = Join-Path $logDir "build.stdout.log"
    $buildStderrLog = Join-Path $logDir "build.stderr.log"

    "Build artifacts are missing or stale; running 'corepack yarn build' before launch (output: $buildStdoutLog):" |
      Add-Content -LiteralPath $launcherLog
    foreach ($reason in $staleReasons) {
      "  - $reason" | Add-Content -LiteralPath $launcherLog
    }

    $buildExitCode = $null
    $buildErrorMessage = $null
    try {
      $buildExitCode = Invoke-CafeCodeBuild `
        -RepoRoot $repo `
        -BuildStdoutLog $buildStdoutLog `
        -BuildStderrLog $buildStderrLog
    } catch {
      $buildErrorMessage = $_.Exception.Message
    }

    # Verify by effect: the build must have left all three artifacts on disk.
    # A zero exit code alone is not proof the desktop app can start.
    $missingAfterBuild = @(Get-StaleBuildArtifactReasons -RepoRoot $repo -HeadCommitTimeUtc $null)
    if ($null -ne $buildErrorMessage -or $buildExitCode -ne 0 -or $missingAfterBuild.Count -gt 0) {
      $failureLines = @("Club Code build failed; not launching the desktop app.")
      if ($null -ne $buildErrorMessage) {
        $failureLines += $buildErrorMessage
      } elseif ($buildExitCode -ne 0) {
        $failureLines += "'corepack yarn build' exited with code $buildExitCode."
      }
      foreach ($reason in $missingAfterBuild) {
        $failureLines += "After the build, $reason."
      }
      $failureLines += "See $launcherLog and $buildStderrLog for details."

      $failureMessage = $failureLines -join [Environment]::NewLine
      $failureMessage | Add-Content -LiteralPath $launcherLog
      Show-CafeCodeLauncherError -Message $failureMessage
      throw $failureMessage
    }

    # Cached builds can succeed without rewriting an unchanged artifact, so an
    # old timestamp after a verified successful build is informational only.
    $staleAfterBuild = @(Get-StaleBuildArtifactReasons -RepoRoot $repo -HeadCommitTimeUtc $headCommitTimeUtc)
    if ($staleAfterBuild.Count -gt 0) {
      "Build succeeded and all artifacts exist, but some timestamps still predate HEAD (likely a cached build); launching anyway." |
        Add-Content -LiteralPath $launcherLog
    } else {
      "Build succeeded; all required artifacts verified present." |
        Add-Content -LiteralPath $launcherLog
    }
    if ($null -ne $headCommitSha) {
      # Record the verified-good build so the next launch skips the rebuild.
      Set-Content -LiteralPath $buildMarkerPath -Value $headCommitSha -Encoding ascii
    }
  } else {
    "Build artifacts are present and current with the HEAD commit; launching without rebuilding." |
      Add-Content -LiteralPath $launcherLog
    if ($null -ne $headCommitSha) {
      Set-Content -LiteralPath $buildMarkerPath -Value $headCommitSha -Encoding ascii
    }
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
