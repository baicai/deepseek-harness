/** Independent Windows user-session agent: the only process owning the uMouse SDK. */
import { spawn } from 'node:child_process'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'
import { MouseBridge, type MouseBridgeEvent, type MouseBridgeStatus } from './umouse-bridge.ts'
import { createMouseAgentToken, isMouseAgentTokenMatch, mouseAgentEndpoint } from './maohao-agent-ipc.ts'

type Packet = { kind: 'status'; state: MouseBridgeStatus } | { kind: 'event'; event: MouseBridgeEvent }

export async function runMaohaoMouseAgent(mainUserData: string): Promise<void> {
  const expected = createMouseAgentToken(mainUserData)
  const clients = new Set<Socket>()
  const capturing = new Map<string, Set<'speech' | 'ai'>>()
  const send = (socket: Socket, packet: Packet): void => {
    if (socket.destroyed) return
    // A slow client must not retain an unlimited amount of microphone PCM in memory.
    if (socket.writableLength > 1024 * 1024) { socket.destroy(); return }
    socket.write(JSON.stringify(packet) + '\n')
  }
  const broadcast = (packet: Packet): void => {
    for (const socket of clients) send(socket, packet)
  }
  let lastLaunch = 0
  const wakeDesktop = (): void => {
    if (clients.size > 0 || Date.now() - lastLaunch < 3000) return
    lastLaunch = Date.now()
    // The desktop's existing single-instance lock handles a concurrent launch.
    const launched = spawn(process.execPath, [], { detached: true, stdio: 'ignore', windowsHide: true })
    launched.once('error', () => { /* The next AI press may retry. */ })
    launched.unref()
  }

  const bridge = new MouseBridge(join(process.resourcesPath, 'umouse-sdk'), app.getPath('logs'),
    (event) => {
      if (event.kind === 'message' && event.event.type === 'keyEvent'
        && (event.event.key === 'speech' || event.event.key === 'ai')) {
        const key = event.event.key
        if (event.event.action === 'down') {
          const held = capturing.get(event.deviceId) ?? new Set<'speech' | 'ai'>()
          held.add(key)
          capturing.set(event.deviceId, held)
          if (key === 'ai') wakeDesktop()
        } else if (event.event.action === 'up') {
          const held = capturing.get(event.deviceId)
          held?.delete(key)
          if (held?.size === 0) capturing.delete(event.deviceId)
        } else if (key === 'ai' && event.event.action === 'click') wakeDesktop()
      }
      if (event.kind === 'disconnected') capturing.delete(event.deviceId)
      if (event.kind === 'audio' && (!capturing.has(event.deviceId) || clients.size === 0)) return
      broadcast({ kind: 'event', event })
    },
    (state) => { broadcast({ kind: 'status', state }) },
  )

  const server = createServer((socket) => {
    socket.setNoDelay(true)
    socket.setTimeout(4000)
    let received = ''
    let authenticated = false
    const reject = (): void => { socket.destroy() }
    socket.on('timeout', () => { if (!authenticated) reject() })
    socket.on('data', (buf: Buffer) => {
      if (authenticated) {
        // One-way IPC by design: the desktop cannot command the agent to record
        // or launch anything; hardware is the only trigger.
        if (buf.length > 0) reject()
        return
      }
      received += buf.toString('utf8')
      if (received.length > 512) { reject(); return }
      const newline = received.indexOf('\n')
      if (newline < 0) return
      let credential: unknown
      try { credential = (JSON.parse(received.slice(0, newline)) as { token?: unknown }).token }
      catch { reject(); return }
      if (!isMouseAgentTokenMatch(expected, credential)) { reject(); return }
      // No client commands may accompany the credential.
      if (received.slice(newline + 1).trim() !== '') { reject(); return }
      authenticated = true
      received = ''
      socket.setTimeout(0)
      clients.add(socket)
      send(socket, { kind: 'status', state: bridge.snapshot() })
    })
    socket.on('close', () => { clients.delete(socket) })
    socket.on('error', () => { clients.delete(socket) })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(mouseAgentEndpoint(mainUserData), () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  bridge.start(true)
  app.on('before-quit', () => {
    bridge.stop()
    for (const client of clients) client.destroy()
    server.close()
  })
}
