/** Windows-only foreground capture and guarded Unicode keyboard injection.
 * No clipboard changes, shell interpolation of speech, or recording outside the local session.
 */
import { execFile } from 'node:child_process'

export interface MaohaoForeground {
  readonly hwnd: string
  readonly ownerPath: string
}

const native = String.raw`using System;
using System.Runtime.InteropServices;
public static class MaohaoNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT { public uint msg; public ushort low,high; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", SetLastError=true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static int ForegroundPid(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd, out pid); return (int)pid; }
  public static bool TypeUnicode(string value, long expectedWindow) {
    if (GetForegroundWindow().ToInt64() != expectedWindow || value.Length == 0 || value.Length > 2000) return false;
    var events = new INPUT[value.Length * 2];
    for (int i=0; i<value.Length; i++) {
      events[2*i].type=1; events[2*i].U.ki.wScan=value[i]; events[2*i].U.ki.dwFlags=4;
      events[2*i+1].type=1; events[2*i+1].U.ki.wScan=value[i]; events[2*i+1].U.ki.dwFlags=6;
    }
    return SendInput((uint)events.Length, events, Marshal.SizeOf(typeof(INPUT))) == events.Length;
  }
}`;
const prelude = "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n" + native + "\n'@\n"
function invoke(command: string, envExtra: Record<string, string> = {}): Promise<string> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows only'))
  const program = Buffer.from(prelude + command, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', program], {
      windowsHide: true, timeout: 9000, maxBuffer: 4096, env: { ...process.env, ...envExtra },
    }, (error, stdout) => {
      if (error) reject(new Error('Windows foreground operation failed'))
      else resolve(stdout.trim())
    })
  })
}

/** Captures the Windows HWND and executable path of the application in focus. */
export async function maohaoForeground(): Promise<MaohaoForeground> {
  const result = await invoke(String.raw`
    $w=[MaohaoNative]::GetForegroundWindow()
    $p=[MaohaoNative]::ForegroundPid($w)
    $path=''
    try { if ($p -gt 0) { $path=[Diagnostics.Process]::GetProcessById($p).MainModule.FileName } } catch {}
    [Console]::Out.Write($w.ToInt64().ToString()+'|'+$path)
  `)
  const separator = result.indexOf('|')
  if (separator < 1) throw new Error('Cannot read focused window')
  const hwnd = result.slice(0, separator)
  if (!/^[0-9]{1,20}$/.test(hwnd) || hwnd === '0') throw new Error('No focused application')
  return { hwnd, ownerPath: result.slice(separator + 1) }
}

/** The held focus must still be active. Never paste elsewhere or touch the clipboard. */
export async function maohaoInsertAtFocus(text: string, hwnd: string): Promise<void> {
  if (!text.trim() || text.length > 2000 || !/^[0-9]{1,20}$/.test(hwnd)) throw new Error('Invalid speech text or focus')
  const success = await invoke(String.raw`
    if ([MaohaoNative]::TypeUnicode($env:DSH_MAOHAO_INPUT_TEXT, [long]::Parse($env:DSH_MAOHAO_EXPECTED_WINDOW))) {
      [Console]::Out.Write('ok')
    } else { throw 'Input focus changed or SendInput rejected the text' }
  `, { DSH_MAOHAO_INPUT_TEXT: text, DSH_MAOHAO_EXPECTED_WINDOW: hwnd })
  if (success !== 'ok') throw new Error('Input focus changed or Windows rejected text')
}
