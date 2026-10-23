# Launch the installed Electron app and verify that the *visible* login window
# belongs to iMaoHao, not to upstream DeepSeek. Do not trust filename or installer name.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstalledExe)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $InstalledExe)) { throw "Installed app missing: $InstalledExe" }

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ImaaHaoWindowProbe {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr value);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr value);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
  public static string[] Titles(uint wanted) {
    var titles = new List<string>();
    EnumWindows((h, arg) => {
      uint process;
      GetWindowThreadProcessId(h, out process);
      if (process == wanted && IsWindowVisible(h)) {
        var text = new StringBuilder(300);
        GetWindowText(h, text, text.Capacity);
        if (text.Length > 0) titles.Add(text.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return titles.ToArray();
  }
}
'@
$desktop = Start-Process -FilePath $InstalledExe -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  $seen = @()
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($desktop.HasExited) { throw "贸号 client exited before branded login appeared (exit=$($desktop.ExitCode))" }
    $seen = @([ImaaHaoWindowProbe]::Titles([uint32]$desktop.Id))
    if (@($seen | Where-Object { $_ -match 'DeepSeek|深度求索' }).Count -gt 0) {
      throw "DeepSeek login appeared in branded executable: $($seen -join ' | ')"
    }
    # A previous candidate showed BOTH the expected branded login AND an
    # '贸号DSH is unavailable' fatal crash dialog. The old test returned PASS
    # as soon as it saw login, allowing a broken package to ship.
    if (@($seen | Where-Object { $_ -match 'is unavailable|启动失败|could not start|stopped unexpectedly' }).Count -gt 0) {
      throw "Branded executable opened a fatal crash dialog alongside login: $($seen -join ' | ')"
    }
    if (@($seen | Where-Object { ($_ -like '*贸号DSH*演示账号登录*' -or $_ -like '*贸号DSH*Mock*登录*') }).Count -gt 0) {
      # Do not call the candidate healthy at first paint: asynchronous Cordis
      # client initialization can fail after the login window appears.
      for ($stableCheck = 0; $stableCheck -lt 6; $stableCheck++) {
        Start-Sleep -Seconds 2
        if ($desktop.HasExited) { throw '贸号 client terminated during login startup stability check' }
        $stableTitles = @([ImaaHaoWindowProbe]::Titles([uint32]$desktop.Id))
        if (@($stableTitles | Where-Object { $_ -match 'is unavailable|启动失败|could not start|stopped unexpectedly|DeepSeek|深度求索' }).Count -gt 0) {
          throw "Branded login was accompanied by fatal startup dialog: $($stableTitles -join ' | ')"
        }
      }
      Write-Host "PASS: installed Windows client shows 贸号 login without a concurrent fatal crash dialog"
      return
    }
    Start-Sleep -Seconds 2
  }
  throw "贸号 Mock login window did not appear within startup gate. Visible titles: $($seen -join ' | ')"
} finally {
  & taskkill.exe /PID $desktop.Id /T /F *> $null
}
