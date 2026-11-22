/** Standalone offline SenseVoice recognition for the Maohao background mouse agent.
 * Reuses the release-pinned model in the DSH home. Never starts a download.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

interface Worker { readonly process: ChildProcessWithoutNullStreams; readonly port: number; readonly token: string }
const assets = [
  ['models/sensevoice-onnx/model.int8.onnx', 239233841, 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51'],
  ['models/sensevoice-onnx/tokens.txt', 315894, 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc'],
  ['models/silero/silero_vad.onnx', 1807522, 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28'],
] as const

async function validFile(path: string, expectedLength: number, expectedSha: string): Promise<boolean> {
  try {
    if ((await stat(path)).size !== expectedLength) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
    return hash.digest('hex') === expectedSha
  } catch { return false }
}
function wave(pcm: Buffer): Buffer {
  const result = Buffer.allocUnsafe(44 + pcm.length)
  result.write('RIFF', 0, 'ascii'); result.writeUInt32LE(36 + pcm.length, 4)
  result.write('WAVEfmt ', 8, 'ascii'); result.writeUInt32LE(16, 16)
  result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22)
  result.writeUInt32LE(16_000, 24); result.writeUInt32LE(32_000, 28)
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34)
  result.write('data', 36, 'ascii'); result.writeUInt32LE(pcm.length, 40)
  pcm.copy(result, 44)
  return result
}

export class MaohaoAgentASR {
  private worker?: Worker
  private starting?: Promise<Worker>
  private idle?: ReturnType<typeof setTimeout>
  private stopped = false
  private readonly modelHome = dshHomePath('speech-to-text', 'sensevoice')

  private async begin(): Promise<Worker> {
    const files = assets.map(([name]) => join(this.modelHome, ...name.split('/')))
    for (const [index, [, size, digest]] of assets.entries()) {
      if (!await validFile(files[index]!, size, digest)) {
        throw new Error('SenseVoice 离线模型未准备完成，请从 DSH 语音输入设置下载')
      }
    }
    const packageWorker = join('dsh', 'node_modules', '@deepseek-ai', 'dsh-experimental-speech-to-text-sensevoice', 'lib', 'worker.js')
    const candidates = [join(app.getAppPath(), packageWorker),
      join(process.resourcesPath, 'app.asar.unpacked', packageWorker)]
    const entry = candidates.find(existsSync)
    if (!entry) throw new Error('安装包缺少离线语音推理运行时')
    const token = randomBytes(32).toString('hex')
    const config = { dataRoot: this.modelHome, precision: 'int8',
      model: files[0], tokens: files[1], vad: files[2], maxAudioBytes: 4 * 1024 * 1024 }
    await mkdir(this.modelHome, { recursive: true })
    const subprocess = spawn(process.execPath, [entry, JSON.stringify(config)], {
      cwd: this.modelHome, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_SPEECH_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let done = false, header = ''
        const finish = (error?: Error, value?: number): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          subprocess.stdout.off('data', onData)
          subprocess.off('exit', onExit)
          subprocess.off('error', onError)
          if (error) reject(error)
          else resolve(value!)
        }
        const onData = (chunk: Buffer): void => {
          header += chunk.toString('utf8')
          if (header.length > 2048) { finish(new Error('离线语音服务启动失败')); return }
          const end = header.indexOf('\n')
          if (end < 0) return
          try {
            const packet = JSON.parse(header.slice(0, end)) as { port?: unknown }
            if (typeof packet.port !== 'number' || !Number.isInteger(packet.port) || packet.port < 1 || packet.port > 65535) throw new Error()
            finish(undefined, Number(packet.port))
          } catch { finish(new Error('离线语音服务启动失败')) }
        }
        const onExit = (): void => { finish(new Error('离线语音服务退出')) }
        const onError = (): void => { finish(new Error('无法启动离线语音服务')) }
        const timer = setTimeout(() => { finish(new Error('离线语音模型加载超时')) }, 75_000)
        subprocess.stdout.on('data', onData)
        subprocess.on('exit', onExit)
        subprocess.on('error', onError)
        subprocess.stderr.resume()
      })
      subprocess.on('exit', () => { if (this.worker?.process === subprocess) this.worker = undefined })
      return { process: subprocess, port, token }
    } catch (error) {
      subprocess.kill()
      throw error
    }
  }

  private async ensure(): Promise<Worker> {
    if (this.stopped) throw new Error('语音服务已退出')
    if (this.worker && this.worker.process.exitCode === null) return this.worker
    this.starting ??= this.begin()
    try { this.worker = await this.starting; return this.worker }
    finally { this.starting = undefined }
  }

  async transcribe(pcm: Buffer): Promise<string> {
    if (pcm.length < 3200 || pcm.length > 3_800_000 || pcm.length % 2 !== 0) throw new Error('录音时长或数据无效')
    clearTimeout(this.idle)
    const worker = await this.ensure()
    try {
      const timeout = AbortSignal.timeout(120_000)
      const response = await fetch(`http://127.0.0.1:${worker.port}/transcribe?language=auto`, {
        method: 'POST', signal: timeout, headers: { authorization: `Bearer ${worker.token}`, 'content-type': 'audio/wav' },
        body: wave(pcm),
      })
      if (!response.ok) throw new Error('离线语音识别失败')
      const result = await response.json() as { text?: unknown }
      if (typeof result.text !== 'string') throw new Error('语音识别结果无效')
      return result.text.trim()
    } finally {
      if (!this.stopped) this.idle = setTimeout(() => {
        this.worker?.process.kill()
        this.worker = undefined
      }, 300_000)
    }
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.idle)
    this.worker?.process.kill()
    this.worker = undefined
  }
}
