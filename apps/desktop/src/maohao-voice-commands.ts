/** Local-only, explicitly configured voice commands for the Maohao Windows edition.
 * The text recognizer has no privilege to execute arbitrary shell commands.
 */
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { shell } from 'electron'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

export interface MaohaoVoiceCommand {
  readonly id: string
  readonly name: string
  readonly aliases: readonly string[]
  readonly action: 'open-app' | 'open-url' | 'close-app'
  readonly target: string
  readonly enabled: boolean
}

const defaults: readonly MaohaoVoiceCommand[] = [
  { id: 'calculator', name: '打开计算器', aliases: ['启动计算器', '开启计算器'], action: 'open-app', target: 'calc.exe', enabled: true },
  { id: 'notepad', name: '打开记事本', aliases: ['启动记事本', '开启记事本'], action: 'open-app', target: 'notepad.exe', enabled: true },
  { id: 'wechat', name: '打开微信', aliases: ['启动微信', '开启微信'], action: 'open-app', target: 'WeChat.exe', enabled: true },
  { id: 'baidu', name: '访问百度', aliases: ['打开百度', '访问百度网站'], action: 'open-url', target: 'https://www.baidu.com/', enabled: true },
  { id: 'close-wechat', name: '关闭微信', aliases: ['退出微信'], action: 'close-app', target: 'WeChat.exe', enabled: false },
]
const safeName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\.exe$/i
const normalized = (value: string): string => value.trim().toLocaleLowerCase().replace(/[。！!，,？?\s]+$/gu, '')
const commandFile = (): string => dshHomePath('speech-to-text', 'maohao-commands.json')
const recordingDir = (): string => dshHomePath('speech-to-text', 'maohao-command-recordings')
const recordingPath = (id: string): string => {
  if (!/^[\\w-]{1,100}$/.test(id)) throw new Error('Invalid voice command id')
  return join(recordingDir(), id + '.wav')
}

function validate(commands: unknown): asserts commands is MaohaoVoiceCommand[] {
  if (!Array.isArray(commands) || commands.length > 300) throw new Error('语音指令数量不能超过300')
  const ids = new Set<string>(), phrases = new Set<string>()
  for (const item of commands) {
    if (!item || typeof item !== 'object') throw new Error('语音指令格式错误')
    const command = item as Partial<MaohaoVoiceCommand>
    if (typeof command.id !== 'string' || !/^[\w-]{1,100}$/.test(command.id)
      || ids.has(command.id) || typeof command.name !== 'string' || !command.name.trim()
      || command.name.length > 150 || !Array.isArray(command.aliases)
      || command.aliases.length > 20 || typeof command.enabled !== 'boolean') throw new Error('指令名称、ID、别名或启用状态无效')
    ids.add(command.id)
    for (const phrase of [command.name, ...command.aliases]) {
      if (typeof phrase !== 'string' || !normalized(phrase) || phrase.length > 150
        || phrases.has(normalized(phrase))) throw new Error('指令触发词重复或无效')
      phrases.add(normalized(phrase))
    }
    if (command.action === 'open-url') {
      if (typeof command.target !== 'string') throw new Error('网址无效')
      let url: URL
      try { url = new URL(command.target) } catch { throw new Error('网址无效') }
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('仅允许 HTTP/HTTPS 网址')
    } else if (command.action === 'open-app' || command.action === 'close-app') {
      if (typeof command.target !== 'string' || command.target.length > 1024
        || !(safeName.test(command.target) || (isAbsolute(command.target) && ['.exe', '.lnk'].includes(extname(command.target).toLowerCase())))) {
        throw new Error('目标必须是 EXE 程序名、绝对 EXE 或快捷方式路径')
      }
      if (command.action === 'close-app' && !safeName.test(basename(command.target))) throw new Error('关闭操作仅允许 EXE')
    } else throw new Error('不支持的语音操作')
  }
}

function windowsProcess(executable: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], { windowsHide: true, timeout: 12_000 }, (error) => {
      if (error) reject(new Error('系统操作未完成'))
      else resolve()
    })
  })
}

async function execute(command: MaohaoVoiceCommand): Promise<void> {
  if (process.platform !== 'win32') throw new Error('系统语音指令仅支持 Windows')
  if (command.action === 'open-url') {
    await shell.openExternal(command.target)
    return
  }
  if (command.action === 'close-app') {
    // No /F. taskkill asks the target application to close; test execution requires confirmation.
    await windowsProcess('taskkill.exe', ['/IM', basename(command.target)])
    return
  }
  const target = command.target
  if (isAbsolute(target)) {
    await access(target)
    const error = await shell.openPath(target)
    if (error) throw new Error('无法启动应用程序')
    return
  }
  // System executable names are passed as argv, never to cmd.exe or a shell.
  // PowerShell's Start-Process can resolve installed applications using the system PATH.
  await windowsProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Start-Process -FilePath ' + JSON.stringify(target)])
}

/** In-memory result is never interpreted as an Agent/LLM instruction. */
export class MaohaoVoiceCommands {
  async list(): Promise<MaohaoVoiceCommand[]> {
    let commands: unknown
    try { commands = JSON.parse(await readFile(commandFile(), 'utf8')) as unknown }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults.map(x => ({ ...x, aliases: [...x.aliases] }))
      throw new Error('无法读取本地语音指令配置')
    }
    validate(commands)
    return commands
  }
  async save(input: unknown): Promise<void> {
    validate(input)
    const path = commandFile()
    await mkdir(dirname(path), { recursive: true })
    const temporary = join(dirname(path), `maohao-commands-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(input, null, 2), { mode: 0o600, flag: 'wx' })
      await rename(temporary, path)
    } catch {
      throw new Error('无法保存本地语音指令')
    }
  }
  async recording(id: string): Promise<string | null> {
    if (!(await this.list()).some(x => x.id === id)) throw new Error('指令不存在')
    try { return (await readFile(recordingPath(id))).toString('base64') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('无法读取语音样本')
    }
  }
  async saveRecording(id: string, encoded: string): Promise<void> {
    if (!(await this.list()).some(x => x.id === id)) throw new Error('指令不存在')
    if (typeof encoded !== 'string' || encoded.length > 2_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new Error('语音样本格式错误')
    }
    const wav = Buffer.from(encoded, 'base64')
    if (wav.toString('base64') !== encoded || wav.length < 46 || wav.length > 1_500_000
      || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
      || wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(40) !== wav.length - 44
      || wav.readUInt32LE(24) !== 16_000 || wav.readUInt16LE(22) !== 1
      || wav.readUInt16LE(34) !== 16) throw new Error('需要16kHz单声道PCM WAV语音样本')
    await mkdir(recordingDir(), { recursive: true })
    const path = recordingPath(id)
    const temporary = path + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, wav, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  }
  async removeRecording(id: string): Promise<void> {
    await rm(recordingPath(id), { force: true })
  }
  async handle(text: string): Promise<{ matched: boolean; command?: string }> {
    if (typeof text !== 'string' || text.length > 500) return { matched: false }
    const match = (await this.list()).find(command => command.enabled &&
      [command.name, ...command.aliases].some(phrase => normalized(phrase) === normalized(text)))
    if (!match) return { matched: false }
    await execute(match)
    return { matched: true, command: match.name }
  }
  async test(id: string, confirmed: boolean): Promise<void> {
    const item = (await this.list()).find(command => command.id === id)
    if (!item) throw new Error('指令不存在')
    if (item.action === 'close-app' && confirmed !== true) throw new Error('关闭指令需要确认')
    await execute(item)
  }
}
