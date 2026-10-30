# Stops only the current user's Maohao mouse-agent process owned by the
# exact installation being upgraded/uninstalled. Never touches main DSH,
# other DSH installs, or processes from other executable paths.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExecutablePath,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath($ExecutablePath)
$filename = [IO.Path]::GetFileName($expected)
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'DSH-maohao Mouse Agent'

if ($Uninstall) {
  $launch = Get-ItemPropertyValue -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  if ($launch -is [string] -and
      $launch.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $launch.Contains('--maohao-agent')) {
    Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  }
}

$targets = @(
  Get-CimInstance Win32_Process -Filter "Name='$($filename.Replace("'", "''"))'" -ErrorAction Stop |
  Where-Object {
    $_.ExecutablePath -and
    [string]::Equals($_.ExecutablePath, $expected, [StringComparison]::OrdinalIgnoreCase) -and
    $_.CommandLine -match '(?i)(?:^|\s)--maohao-agent(?:\s|$)'
  }
)
foreach ($target in $targets) {
  try {
    Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
  } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
    # A process may have exited on its own after the WMI snapshot.
  } catch [System.ArgumentException] {
    # The process may no longer exist.
  }
}
foreach ($target in $targets) {
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 100
  }
}
