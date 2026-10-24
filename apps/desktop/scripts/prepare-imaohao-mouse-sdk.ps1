# Vendor-pinned uMouse SDK + isolated Windows native helper.
# Demo redistribution requires commercial permission from SDK vendor.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..\native\umouse-bridge.cpp')).Path
$sha = 'b2a7355bb117d77a3c72c7d090f3852d947bd47c'
$blob = '37e379497987ff23b4c84831a5c20de843bf3ecc'
$zipName = 'uMouseSdk_0.4.20_Windows_10-11_x64.zip'
$uri = "https://raw.githubusercontent.com/baicai/mouse-sdk/$sha/packages/$zipName"
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$archive = Join-Path $env:RUNNER_TEMP $zipName
$unpacked = Join-Path $env:RUNNER_TEMP 'imaohao-mouse-sdk-unpacked'
Invoke-WebRequest -Uri $uri -OutFile $archive
$actual = ((& git hash-object $archive) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $actual -ne $blob) {
  throw "Pinned uMouse SDK archive checksum mismatch (expected $blob, got $actual)"
}
if (Test-Path -LiteralPath $unpacked) { Remove-Item -LiteralPath $unpacked -Recurse -Force }
Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
$dll = @(Get-ChildItem -LiteralPath $unpacked -Filter 'uMouseSdk.dll' -File -Recurse)
if ($dll.Count -ne 1) { throw "Expected one uMouseSdk.dll, found $($dll.Count)" }
Copy-Item -Path (Join-Path $dll[0].DirectoryName '*') -Destination $OutputDirectory -Recurse -Force
foreach ($file in @('THIRD_PARTY_LICENSES.txt','COPYING.LGPLv2.1','LICENSE.hidapi-bsd')) {
  $url = "https://raw.githubusercontent.com/baicai/mouse-sdk/$sha/$file"
  Invoke-WebRequest -Uri $url -OutFile (Join-Path $OutputDirectory $file)
}
$vswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'MSVC Build Tools not found' }
$installation = ((& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) | Out-String).Trim()
if (-not $installation) { throw 'Cannot find VC++ x64 compiler' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars)) { throw "vcvars64 not found: $vcvars" }
$exe = Join-Path $OutputDirectory 'umouse-bridge.exe'
$command = 'call "' + $vcvars + '" >nul && cl.exe /nologo /std:c++17 /EHsc /O2 /W4 /Fe:"' + $exe + '" "' + $source + '"'
Push-Location $OutputDirectory
try {
  & $env:ComSpec /d /s /c $command
  if ($LASTEXITCODE -ne 0) { throw "uMouse helper compilation failed ($LASTEXITCODE)" }
} finally { Pop-Location }
if (-not (Test-Path -LiteralPath $exe)) { throw "Native SDK bridge not found: $exe" }
$version = (& $exe --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -notmatch '"version":"0\.4\.20"') {
  throw "uMouse DLL load / ABI check failed: $version"
}
Write-Host "PASS: SDK 0.4.20 pinned Git blob and Windows native bridge version handshake"
Write-Host "SDK directory: $OutputDirectory"
