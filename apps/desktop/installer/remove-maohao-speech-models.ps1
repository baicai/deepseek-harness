# Delete only the managed offline SenseVoice model cache at final uninstall.
# Fail closed on unsafe or reparse-point paths. Never touch sessions or user settings.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
try {
  $home = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    Join-Path $env:USERPROFILE '.dsh'
  } else {
    [Environment]::ExpandEnvironmentVariables($env:DSH_HOME)
  }
  if (-not [IO.Path]::IsPathRooted($home)) { throw 'DSH_HOME must be an absolute path' }
  $root = [IO.Path]::GetFullPath($home).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  if ([string]::IsNullOrWhiteSpace($root) -or
      [string]::Equals($root, [IO.Path]::GetPathRoot($root).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing filesystem root'
  }
  $suffix = @('speech-to-text', 'sensevoice', 'models')
  $current = $root
  # Reject any junction or symlink in the existing path, including DSH_HOME.
  foreach ($part in @('') + $suffix) {
    if ($part -ne '') { $current = Join-Path $current $part }
    if (-not (Test-Path -LiteralPath $current)) { return }
    $info = Get-Item -LiteralPath $current -Force
    if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing reparse point: $current"
    }
    if (-not $info.PSIsContainer) { throw "Expected directory: $current" }
  }
  # Do not recursively follow links inside the cache. Remove link entries as links.
  $target = $current
  $entries = @(Get-ChildItem -LiteralPath $target -Force)
  foreach ($entry in $entries) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      $entry.Delete()
    } else {
      Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction Stop
    }
  }
  Remove-Item -LiteralPath $target -Force
  Write-Output 'SenseVoice offline models deleted'
  exit 0
} catch {
  Write-Error ('Could not safely delete SenseVoice offline models: ' + $_.Exception.Message)
  exit 1
}
