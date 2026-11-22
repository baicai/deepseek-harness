/** Independent Windows user-session agent: the only process owning the uMouse SDK. */
import { spawn } from 'node:child_process'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { app, Notification } from 'electron'
import { MaohaoAgentASR } from './maohao-agent-asr.ts'
import { MaohaoVoiceCommands } from './maohao-voice-commands.ts'
import { maohaoForeground, maohaoInsertAtFocus, type MaohaoForeground } from './maohao-window-input.ts'
import { MouseBridge, type MouseBridgeEvent, type MouseBridgeStatus } from './umouse-bridge.ts'
import { createMouseAgentToken, isMouseAgentTokenMatch, mouseAgentEndpoint } from './maohao-agent-ipc.ts'

type Packet = { kind: 'status'; state: MouseBridgeStatus } | { kind: 'event'; event: MouseBridgeEvent }

export async function runMaohaoMouseAgent(mainUserData: string): Promise<void> {
  const expected = createMouseAgentToken(mainUserData)
  const clients = new Set<Socket>()
  type Capture = {
    readonly key: 'speech' | 'ai'
    readonly started: number
    readonly focus: Promise<MaohaoForeground | undefined>
    readonly chunks: Buffer[]
    readonly queued: MouseBridgeEvent[]
    readonly timer: ReturnType<typeof setTimeout>
    bytes: number
    ended: boolean
    route: 'pending' | 'desktop' | 'agent'
  }
  const capturing = new Map<string, Capture>()
  const offline = new MaohaoAgentASR()
  const commands = new MaohaoVoiceCommands()
  const notify = (body: string): void => {
    try { if (Notification.isSupported()) new Notification({ title: 'DSH-maohao', body, silent: true }).show() }
    catch { /* Windows toast availability must never interrupt recognition. */ }
  }
  const transcribeBackground = async (capture: Capture): Promise<void> => {
    if (capture.bytes < 6400 || Date.now() - capture.started < 250) return
    try {
      notify('正在识别语音…')
      const text = await offline.transcribe(Buffer.concat(capture.chunks))
      if (!text) { notify('没有识别到有效语音'); return }
      const matched = await commands.handle(text)
      if (matched.matched) {
        notify('已执行指令：' + (matched.command ?? text))
        return
      }
      const focused = await capture.focus
      if (!focused) throw new Error('录音开始时没有可用的输入窗口')
      await maohaoInsertAtFocus(text, focused.hwnd)
      notify('语音文字已输入')
    } catch (error) {
      const message = error instanceof Error ? error.message : '语音识别或指令执行失败'
      notify(message.length > 120 ? '语音识别或指令执行失败' : message)
    } finally {
      capture.chunks.length = 0
    }
  }
  const routeEvent = (capture: Capture, event: MouseBridgeEvent): void => {
    if (capture.route === 'desktop') broadcast({ kind: 'event', event })
    else if (capture.route === 'pending') capture.queued.push(event)
  }
  const endCapture = (deviceId: string, capture: Capture): void => {
    clearTimeout(capture.timer)
    capturing.delete(deviceId)
    capture.ended = true
    if (capture.route === 'agent') void transcribeBackground(capture)
  }
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
        const deviceId = event.deviceId
        if (event.event.action === 'click') {
          if (key === 'ai') wakeDesktop()
          return
        }
        if (event.event.action === 'down') {
          if (capturing.has(deviceId)) return
          const focus = maohaoForeground().catch(() => undefined)
          const capture: Capture = { key, started: Date.now(), focus, chunks: [], queued: [], bytes: 0,
            route: 'pending', ended: false, timer: setTimeout(() => { capturing.delete(deviceId) }, 120_000) }
          capturing.set(deviceId, capture)
          routeEvent(capture, { ...event, event: { ...event.event, hardwareAt: capture.started } })
          void focus.then(window => {
            // Forward to the ordinary DSH composer only when the DSH app itself
            // had focus at key-down. Otherwise the agent owns ASR and insertion.
            const ownWindow = window?.ownerPath.toLocaleLowerCase() === process.execPath.toLocaleLowerCase()
            capture.route = ownWindow && clients.size > 0 ? 'desktop' : 'agent'
            if (capture.route === 'desktop') {
              for (const queued of capture.queued) broadcast({ kind: 'event', event: queued })
            } else if (capture.ended) {
              void transcribeBackground(capture)
            }
            capture.queued.length = 0
          })
          return
        }
        if (event.event.action === 'up') {
          const capture = capturing.get(deviceId)
          if (!capture || capture.key !== key) return
          routeEvent(capture, event)
          endCapture(deviceId, capture)
          return
        }
      }
      if (event.kind === 'disconnected') {
        const capture = capturing.get(event.deviceId)
        if (capture) { clearTimeout(capture.timer); capturing.delete(event.deviceId) }
      }
      if (event.kind === 'audio') {
        const capture = capturing.get(event.deviceId)
        if (!capture) return
        const bytes = Buffer.from(event.data, 'base64')
        if (bytes.length === 0 || bytes.length % 2 !== 0 || capture.bytes + bytes.length > 3_800_000) {
          clearTimeout(capture.timer)
          capturing.delete(event.deviceId)
          notify('鼠标语音录制超出限制')
          return
        }
        capture.bytes += bytes.length
        capture.chunks.push(bytes)
        routeEvent(capture, event)
        return
      }
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
    offline.stop()
    for (const capture of capturing.values()) clearTimeout(capture.timer)
    capturing.clear()
    for (const client of clients) client.destroy()
    server.close()
  })
}
