# Exercise the *real packaged* per-machine iMaoHao NSIS installer twice on a
# clean Windows Actions runner. This catches mismatched registry hive/key reads
# that a successful packaging-only build never detects.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ArtifactDirectory
)
$ErrorActionPreference = 'Stop'
$installer = @(Get-ChildItem -LiteralPath $ArtifactDirectory -File -Filter 'iMaoHao-dsh-*-win-x64-unsigned.exe')
if ($installer.Count -ne 1) { throw "Expected one branded Windows installer, found $($installer.Count)" }
$programFiles = [Environment]::GetFolderPath('ProgramFiles')
$installPath = Join-Path $programFiles 'iMaoHao\iMaoHao-DSH'
$appExe = Join-Path $installPath '贸号DSH.exe'
$uninstaller = Join-Path $installPath 'Uninstall 贸号DSH.exe'
$sentinelRoot = Join-Path $env:APPDATA '贸号DSH\harness-home'
$sentinel = Join-Path $sentinelRoot 'ci-preserve-user-data.txt'
if (Test-Path -LiteralPath $installPath) {
    throw "CI runner is not clean; refusing to overwrite $installPath"
}
function Invoke-Installer([string]$Path, [string]$Arguments) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Installer '$Path' returned $($process.ExitCode)" }
}
try {
    Invoke-Installer $installer[0].FullName '/S'
    if (-not (Test-Path -LiteralPath $appExe)) { throw "First installation missing $appExe" }
    New-Item -ItemType Directory -Path $sentinelRoot -Force | Out-Null
    Set-Content -LiteralPath $sentinel -Value 'KEEP: user data survives in-place upgrade' -Encoding UTF8
    Write-Host "PASS: first Windows install to $installPath"

    # This failed for the previously shipped build due to reading
    # INSTALL_REGISTRY_KEY instead of UNINSTALL_REGISTRY_KEY.
    Invoke-Installer $installer[0].FullName '/S'
    if (-not (Test-Path -LiteralPath $appExe)) { throw "In-place upgrade lost $appExe" }
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'In-place upgrade deleted user data' }
    $value = Get-Content -LiteralPath $sentinel -Raw
    if (-not $value.Contains('KEEP: user data')) { throw 'In-place upgrade changed user data' }
    $parent = Split-Path -Parent $installPath
    if (@(Get-ChildItem -LiteralPath $parent -Directory -Filter 'iMaoHao-DSH.new-*').Count -gt 0) {
        throw 'Temporary staged directory remains'
    }
    Write-Host 'PASS: second Windows install overwrites existing app and preserves user data'
}
finally {
    if (Test-Path -LiteralPath $uninstaller) {
        try {
            Invoke-Installer $uninstaller '/S /KEEP_APP_DATA'
        } catch {
            Write-Warning "CI smoke cleanup could not uninstall product: $_"
        }
    }
    Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
    # Do not recurse through any real user's profile or remove the whole data root.
}
