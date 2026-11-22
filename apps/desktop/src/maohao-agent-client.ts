/** Desktop-side IPC client: the independent agent, not Electron, owns the mouse SDK. */
import { spawn } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { MAOHAO_AGENT_FLAG, mouseAgentEndpoint, readMouseAgentToken } from './maohao-agent-ipc.ts'
import type { MouseBridgeEvent, MouseBridgeStatus } from './umouse-bridge.ts'

export class MaohaoAgentClient {
  private socket: Socket | undefined
  private stopped = false
  private started = false
  private launchAttempted = false
  private retry: ReturnType<typeof setTimeout> | undefined
  private state: MouseBridgeStatus = { phase: 'starting', connected: 0, devices: [] }
  constructor(
    private readonly userData: string,
    private readonly onEvent: (event: MouseBridgeEvent) => void,
    private readonly onStatus: (state: MouseBridgeStatus) => void,
  ) {}
  snapshot(): MouseBridgeStatus { return { ...this.state, devices: this.state.devices.map(item => ({ ...item })) } }
  private update(state: MouseBridgeStatus): void {
    this.state = state
    this.onStatus(this.snapshot())
  }
  start(_audioEnabled = true): void {
    if (this.stopped || this.started) return
    this.started = true
    this.launch()
    this.tryConnect()
  }
  private launch(): void {
    if (this.launchAttempted) return
    this.launchAttempted = true
    const child = spawn(process.execPath, [MAOHAO_AGENT_FLAG], {
      detached: true, windowsHide: true, stdio: 'ignore',
    })
    child.once('error', () => { this.launchAttempted = false })
    child.unref()
  }
  private scheduleRetry(): void {
    if (this.stopped || this.retry !== undefined) return
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.tryConnect()
    }, 750)
  }
  private tryConnect(): void {
    if (this.stopped || this.socket !== undefined) return
    let token: string
    try { token = readMouseAgentToken(this.userData) }
    catch { this.scheduleRetry(); return }
    const socket = connect(mouseAgentEndpoint(this.userData))
    this.socket = socket
    let buffer = ''
    socket.on('connect', () => { socket.write(JSON.stringify({ token }) + '\n') })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.length > 2 * 1024 * 1024) { socket.destroy(); return }
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const packet = JSON.parse(line) as { kind?: unknown; state?: MouseBridgeStatus; event?: MouseBridgeEvent }
          if (packet.kind === 'status' && packet.state !== undefined
            && Array.isArray(packet.state.devices) && typeof packet.state.connected === 'number') {
            this.update(packet.state)
          } else if (packet.kind === 'event' && packet.event !== undefined) {
            // The agent itself already normalizes and bounds vendor SDK callback data.
            this.onEvent(packet.event)
          }
        } catch { /* Ignore malformed frames. */ }
        newline = buffer.indexOf('\n')
      }
    })
    socket.on('error', () => { /* One reconnect path on close. */ })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined
      if (!this.stopped) {
        this.update({ phase: 'starting', connected: 0, devices: [] })
        this.scheduleRetry()
      }
    })
  }
  stop(): void {
    this.stopped = true
    if (this.retry !== undefined) clearTimeout(this.retry)
    this.retry = undefined
    this.socket?.destroy()
    this.socket = undefined
    this.update({ phase: 'stopped', connected: 0, devices: [] })
  }
}
