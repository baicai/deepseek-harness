/** Separate-process Windows uMouse SDK adapter; native callback faults never run in Electron. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export type MouseBridgeEvent =
  | { kind: 'ready'; version: string }
  | { kind: 'connected' | 'disconnected'; deviceId: string; mode: 0 | 1 }
  | { kind: 'message'; deviceId: string; event: Record<string, unknown> }
  | { kind: 'audio'; deviceId: string; format: 'pcm_s16le'; sampleRate: 16000; data: string }

export interface MouseBridgeStatus {
  readonly phase: 'unavailable' | 'starting' | 'ready' | 'error' | 'stopped'
  readonly version?: string
  readonly connected: number
  readonly devices: readonly { readonly deviceId: string; readonly mode: 0 | 1 }[]
}

/** Owns process lifetime and forwards sanitized, bounded events to a trusted renderer. */
export class MouseBridge {
  private child: ChildProcessWithoutNullStreams | undefined
  private readonly devices = new Map<string, 0 | 1>()
  private status: MouseBridgeStatus = { phase: 'unavailable', connected: 0, devices: [] }
  private stopped = false
  constructor(
    private readonly directory: string,
    private readonly workingDirectory: string,
    private readonly onEvent: (event: MouseBridgeEvent) => void,
    private readonly onStatus: (state: MouseBridgeStatus) => void,
  ) {}
  snapshot(): MouseBridgeStatus { return { ...this.status, devices: this.status.devices.map(device => ({ ...device })) } }
  private update(phase: MouseBridgeStatus['phase'], version?: string): void {
    this.status = { phase, connected: this.devices.size,
      devices: [...this.devices].map(([deviceId, mode]) => ({ deviceId, mode })),
      ...(version === undefined ? {} : { version }) }
    this.onStatus(this.snapshot())
  }
  start(audioEnabled = false): void {
    if (this.child !== undefined || this.stopped) return
    const program = join(this.directory, 'umouse-bridge.exe')
    const dll = join(this.directory, 'uMouseSdk.dll')
    if (!existsSync(program) || !existsSync(dll)) {
      this.update('unavailable')
      return
    }
    this.update('starting')
    const child = spawn(program, audioEnabled ? ['--audio'] : [], {
      cwd: this.workingDirectory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    const decoder = new StringDecoder('utf8')
    let pending = ''
    child.stdout.on('data', (data: Buffer) => {
      pending += decoder.write(data)
      if (pending.length > 262144) { child.kill(); this.update('error'); return }
      let next = pending.indexOf('\n')
      while (next >= 0) {
        const line = pending.slice(0, next)
        pending = pending.slice(next + 1)
        if (line.length > 0) this.consume(line)
        next = pending.indexOf('\n')
      }
    })
    // Never log SDK output containing device serial numbers or audio.
    child.stderr.resume()
    child.on('error', () => { if (!this.stopped) this.update('error') })
    child.on('exit', (code) => {
      this.child = undefined
      this.devices.clear()
      if (!this.stopped) this.update(code === 0 ? 'stopped' : 'error')
    })
  }
  private consume(line: string): void {
    let item: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
      item = parsed as Record<string, unknown>
    } catch { return }
    if (item.kind === 'ready' && typeof item.version === 'string' && item.version.length <= 48) {
      this.update('ready', item.version)
      this.onEvent({ kind: 'ready', version: item.version })
      return
    }
    if (typeof item.deviceId !== 'string' || item.deviceId.length > 128) return
    if ((item.kind === 'connected' || item.kind === 'disconnected') && (item.mode === 0 || item.mode === 1)) {
      if (item.kind === 'connected') this.devices.set(item.deviceId, item.mode)
      else this.devices.delete(item.deviceId)
      this.update('ready', this.status.version)
      this.onEvent({ kind: item.kind, deviceId: item.deviceId, mode: item.mode })
      return
    }
    if (item.kind === 'message' && typeof item.json === 'string' && item.json.length <= 16000) {
      try {
        const message: unknown = JSON.parse(item.json)
        if (message && typeof message === 'object' && !Array.isArray(message)) {
          this.onEvent({ kind: 'message', deviceId: item.deviceId, event: message as Record<string, unknown> })
        }
      } catch { /* corrupted vendor message does not reach renderer */ }
      return
    }
    if (item.kind === 'audio' && item.format === 'pcm_s16le' && item.sampleRate === 16000
      && typeof item.data === 'string' && item.data.length <= 90000 && /^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
      this.onEvent({ kind: 'audio', deviceId: item.deviceId, format: 'pcm_s16le', sampleRate: 16000, data: item.data })
    }
  }
  stop(): void {
    this.stopped = true
    const child = this.child
    this.child = undefined
    if (child !== undefined) {
      child.stdin.end('stop\n')
      // Electron is shutting down; do not hold the main process open for a stuck vendor SDK.
      child.unref()
    }
    this.devices.clear()
    this.update('stopped')
  }
}
