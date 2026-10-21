# Runs only on an isolated Windows CI machine with administrative installation rights.
# Reproduces user-reported custom D:\Program Files + legacy uninstall registry mismatch.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ArtifactDirectory)
$ErrorActionPreference = 'Stop'
$exe = @(Get-ChildItem -LiteralPath $ArtifactDirectory -File -Filter 'iMaoHao-dsh-*-win-x64-unsigned.exe')
if ($exe.Count -ne 1) { throw "Expected one Windows installer, got $($exe.Count)" }
$drive = if (Test-Path -LiteralPath 'D:\') { 'D:\' } else { [IO.Path]::GetPathRoot($env:RUNNER_TEMP) }
$parent = Join-Path $drive 'Program Files\iMaoHao'
$target = Join-Path $parent 'iMaoHao-DSH'
$program = Join-Path $target '贸号DSH.exe'
$uninstaller = Join-Path $target 'Uninstall 贸号DSH.exe'
$sentinelRoot = Join-Path $env:APPDATA 'iMaoHao-DSH-smoke'
$sentinel = Join-Path $sentinelRoot 'preserve-user-data.txt'
$roots = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
if (Test-Path -LiteralPath $target) { throw "Target must be absent before test: $target" }
function Invoke-Setup([string]$Arguments, [int]$Expected) {
  $proc = Start-Process -FilePath $exe[0].FullName -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
  if ($proc.ExitCode -ne $Expected) { throw "Setup $Arguments returned $($proc.ExitCode), expected $Expected" }
}
try {
  Invoke-Setup ('/S /D=' + $target) 0
  if (-not (Test-Path -LiteralPath $program)) {
    $roots = @('C:\Program Files\iMaoHao\iMaoHao-DSH', $target,
      (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) '贸号DSH'))
    $evidence = @($roots | ForEach-Object {
      $_ + ': exists=' + (Test-Path -LiteralPath $_) + ', executable='
        + (Test-Path -LiteralPath (Join-Path $_ '贸号DSH.exe'))
    })
    throw "Custom-path initial install did not create executable at '$target'. Checked: $($evidence -join '; ')"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $target 'resources\app.asar'))) {
    throw 'Custom-path initial install did not create Electron payload'
  }
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Branded uninstaller missing' }
  Write-Host "PASS: custom drive directory first install to $target"
  New-Item -ItemType Directory -Path $sentinelRoot -Force | Out-Null
  Set-Content -LiteralPath $sentinel -Value 'keep-this-customer-data' -Encoding UTF8

  # Reproduce the old installer that did not register InstallLocation in the
  # correct hive/key. Leave other registry values untouched.
  $removed = 0
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($entry in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
      try {
        $record = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction Stop
        if ($record.InstallLocation -and $record.InstallLocation.TrimEnd('\') -ieq $target) {
          Remove-ItemProperty -LiteralPath $entry.PSPath -Name InstallLocation -ErrorAction Stop
          $removed++
        }
      } catch {
        if ($_.Exception.Message -match 'Access is denied') { throw }
      }
    }
  }
  Write-Host "Removed $removed matching legacy InstallLocation value(s)"

  Invoke-Setup ('/S /D=' + $target) 0
  if (-not (Test-Path -LiteralPath $program)) { throw 'Legacy in-place upgrade lost executable' }
  if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Legacy upgrade deleted user data' }
  Write-Host 'PASS: custom-path legacy upgrade works without matching registry InstallLocation'

  # A similarly named, foreign non-empty directory must still be rejected.
  $foreign = Join-Path $drive 'iMaoHao-DSH-smoke-foreign\iMaoHao-DSH'
  if (Test-Path -LiteralPath $foreign) { throw "Foreign smoke path already exists: $foreign" }
  New-Item -ItemType Directory -Path $foreign -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $foreign 'foreign-data.txt') -Value 'do-not-touch'
  Invoke-Setup ('/S /D=' + $foreign) 2
  if ((Get-Content -LiteralPath (Join-Path $foreign 'foreign-data.txt')) -ne 'do-not-touch') {
    throw 'Foreign folder content was modified'
  }
  Write-Host 'PASS: non-owned folder remains blocked'
  Remove-Item -LiteralPath (Split-Path -Parent $foreign) -Recurse -Force
} finally {
  if (Test-Path -LiteralPath $uninstaller) {
    $proc = Start-Process -FilePath $uninstaller -ArgumentList '/S /KEEP_APP_DATA' -Wait -PassThru -WindowStyle Hidden
    if ($proc.ExitCode -ne 0) { Write-Warning "Smoke test uninstaller returned $($proc.ExitCode)" }
  }
  Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
}
