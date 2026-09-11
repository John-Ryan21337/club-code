[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [string[]]$CandidatePaths = @()
)

$ErrorActionPreference = "Stop"
Write-Verbose "shortcut-repair:entered"
$resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot).Path
Write-Verbose "shortcut-repair:repo-resolved"
$packageJsonPath = Join-Path $resolvedRepo "package.json"
$launcherPath = Join-Path $resolvedRepo "Start-CafeCode.ps1"
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "Validated Club Code launcher is missing: $launcherPath"
}
$package = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
if ($package.name -ne "@cafecode/monorepo") {
  throw "Refusing shortcut repair because RepoRoot is not a Club Code checkout."
}
Write-Verbose "shortcut-repair:package-validated"

$trustedPowerShell = Join-Path ([Environment]::GetFolderPath("System")) "WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $trustedPowerShell -PathType Leaf)) {
  throw "Trusted Windows PowerShell is missing: $trustedPowerShell"
}
Write-Verbose "shortcut-repair:powershell-validated"
$userProfileRoot = [IO.Path]::GetFullPath([Environment]::GetFolderPath("UserProfile")).TrimEnd('\')
$applicationDataRoot = [Environment]::GetFolderPath("ApplicationData")
Write-Verbose "shortcut-repair:roots-resolved"
$expectedArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`" -Wait"

function Resolve-NormalizedPath {
  param([AllowEmptyString()][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $null
  }
  try {
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
  } catch {
    return $null
  }
}

function Test-LauncherArguments {
  param([AllowEmptyString()][string]$Arguments)
  if ([string]::IsNullOrWhiteSpace($Arguments)) {
    return $false
  }
  $matches = [regex]::Matches($Arguments, '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|(\S+))')
  if ($matches.Count -ne 1) {
    return $false
  }
  $rawPath = if ($matches[0].Groups[1].Success) { $matches[0].Groups[1].Value } else { $matches[0].Groups[2].Value }
  $argumentPath = Resolve-NormalizedPath -Path $rawPath
  return $null -ne $argumentPath -and $argumentPath.Equals($launcherPath, [StringComparison]::OrdinalIgnoreCase)
}

if ($CandidatePaths.Count -eq 0) {
  $CandidatePaths = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Club Code.lnk"),
    (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Club Code.lnk"),
    (Join-Path $applicationDataRoot "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Club Code.lnk"),
    (Join-Path $applicationDataRoot "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Cafe Code.lnk")
  )
}

Write-Verbose "shortcut-repair:com-create"
$shell = New-Object -ComObject WScript.Shell
Write-Verbose "shortcut-repair:com-ready"
try {
  $candidateIndex = 0
  foreach ($path in $CandidatePaths) {
    $candidateIndex++
    Write-Verbose "shortcut-repair:candidate:$candidateIndex`:resolve"
    $candidate = Resolve-NormalizedPath -Path $path
    if (
      $null -eq $candidate -or
      [IO.Path]::GetExtension($candidate) -ine ".lnk" -or
      -not $candidate.StartsWith("$userProfileRoot\", [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $candidate -PathType Leaf)
    ) {
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:invalid"
      continue
    }
    $shortcut = $null
    try {
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:load"
      $shortcut = $shell.CreateShortcut($candidate)
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:loaded"
      $shortcutTarget = Resolve-NormalizedPath -Path $shortcut.TargetPath
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:target-read"
      $shortcutWorkingDirectory = Resolve-NormalizedPath -Path $shortcut.WorkingDirectory
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:working-directory-read"
      $identifiesCheckout =
        ($null -ne $shortcutTarget -and $shortcutTarget.Equals($launcherPath, [StringComparison]::OrdinalIgnoreCase)) -or
        (
          $null -ne $shortcutTarget -and
          $shortcutTarget.Equals($trustedPowerShell, [StringComparison]::OrdinalIgnoreCase) -and
          $null -ne $shortcutWorkingDirectory -and
          $shortcutWorkingDirectory.Equals($resolvedRepo, [StringComparison]::OrdinalIgnoreCase) -and
          (Test-LauncherArguments -Arguments $shortcut.Arguments)
        )
      if (-not $identifiesCheckout) {
        Write-Verbose "shortcut-repair:candidate:$candidateIndex`:foreign"
        Write-Output "Skipped shortcut owned by another checkout or application: $candidate"
        continue
      }
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:update"
      $shortcut.TargetPath = $trustedPowerShell
      $shortcut.Arguments = $expectedArguments
      $shortcut.WorkingDirectory = $resolvedRepo
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:save"
      $shortcut.Save()
      Write-Verbose "shortcut-repair:candidate:$candidateIndex`:saved"
      Write-Output "Updated Club Code shortcut: $candidate"
    } finally {
      if ($null -ne $shortcut) {
        Write-Verbose "shortcut-repair:candidate:$candidateIndex`:release"
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
        Write-Verbose "shortcut-repair:candidate:$candidateIndex`:released"
      }
    }
  }
} finally {
  Write-Verbose "shortcut-repair:com-release"
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
}
Write-Verbose "shortcut-repair:complete"
