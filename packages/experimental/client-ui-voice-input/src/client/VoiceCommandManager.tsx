/** Maohao speech commands: user-managed triggers with optional local WAV examples. */
import { useEffect, useRef, useState } from 'react'
import type { VoiceInputInjected } from './VoiceInput.tsx'
import type { SpeechSelection } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { audioBase64 } from './audio.ts'

interface Command {
  readonly id: string
  readonly name: string
  readonly aliases: readonly string[]
  readonly action: 'open-app' | 'open-url' | 'close-app'
  readonly target: string
  readonly enabled: boolean
}
interface NativeCommands {
  list(): Promise<Command[]>
  save(commands: readonly Command[]): Promise<void>
  test(id: string, confirmed: boolean): Promise<void>
  recording(id: string): Promise<string | null>
  saveRecording(id: string, wavBase64: string): Promise<void>
  removeRecording(id: string): Promise<void>
}
function commandsApi(): NativeCommands | undefined {
  return (window as Window & { dshDesktop?: { mouse?: { commands?: NativeCommands } } }).dshDesktop?.mouse?.commands
}
type Props = Pick<VoiceInputInjected, 'transcribe' | 'createRecording'> & {
  readonly selection?: SpeechSelection
  readonly maxDurationSeconds?: number
}
const emptyCommand = (): Command => ({ id: crypto.randomUUID(), name: '', aliases: [],
  action: 'open-app', target: 'notepad.exe', enabled: true })

export function VoiceCommandManager({ transcribe, createRecording, selection, maxDurationSeconds }: Props) {
  const [items, setItems] = useState<Command[]>([])
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Command>(emptyCommand)
  const [aliases, setAliases] = useState('')
  const [sample, setSample] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const capture = useRef<ReturnType<Props['createRecording']> | null>(null)
  const api = commandsApi()
  useEffect(() => {
    if (!api) return
    let alive = true
    void api.list().then(value => { if (alive) setItems(value) })
      .catch(error => { if (alive) setMessage(String(error)) })
    return () => { alive = false; void capture.current?.dispose(); capture.current = null }
  }, [])
  if (!api) return null
  const apply = async (next: Command[]): Promise<void> => {
    setBusy(true); setMessage('')
    try { await api.save(next); setItems(next); setMessage('语音指令已保存') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const edit = async (command?: Command): Promise<void> => {
    setDraft(command ? { ...command } : emptyCommand())
    setEditId(command?.id ?? null)
    setAliases(command?.aliases.join('\n') ?? '')
    setSample(null)
    setOpen(true)
    if (command) {
      try { setSample(await api.recording(command.id)) }
      catch (error) { setMessage(String(error)) }
    }
  }
  const stopRecording = async (): Promise<void> => {
    const current = capture.current
    if (!current) return
    capture.current = null
    setBusy(true); setMessage('正在通过本地语音服务识别示例录音…')
    try {
      const audio = await current.stop(Math.min(45, maxDurationSeconds ?? 45))
      const encoded = audioBase64(audio)
      setSample(encoded)
      if (selection) {
        const controller = new AbortController()
        const result = await transcribe({ audioBase64: encoded, ...selection }, controller.signal)
        if (result.ok && result.value.text.trim()) {
          setDraft(previous => ({ ...previous, name: result.value.text.trim() }))
          setMessage('录音成功，识别文字已填入触发词')
        } else setMessage('录音已保存；未识别到文字，可手动填写触发词')
      } else setMessage('录音已保存；请手动填写触发词')
    } catch (error) { setMessage('语音录制失败：' + String(error)) }
    finally { await current.dispose(); setBusy(false) }
  }
  const toggleRecording = async (): Promise<void> => {
    if (capture.current) { await stopRecording(); return }
    setMessage('')
    const current = createRecording()
    capture.current = current
    try {
      await current.start()
      if (capture.current === current) setMessage('正在录音…再次点击停止（最多45秒）')
    } catch (error) {
      capture.current = null; setMessage('无法开始录音：' + String(error))
      await current.dispose()
    }
  }
  const persistDraft = async (): Promise<void> => {
    const nextCommand: Command = { ...draft, name: draft.name.trim(),
      aliases: aliases.split(/\r?\n/).map(x => x.trim()).filter(Boolean),
      target: draft.target.trim() }
    const next = editId === null ? [...items, nextCommand] : items.map(x => x.id === editId ? nextCommand : x)
    setBusy(true); setMessage('')
    try {
      await api.save(next)
      if (sample !== null) await api.saveRecording(nextCommand.id, sample)
      setItems(next); setOpen(false); setMessage('指令和语音样本已保存')
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  const playback = async (encoded: string | null): Promise<void> => {
    if (!encoded) { setMessage('没有已录制的语音样本'); return }
    try { await new Audio('data:audio/wav;base64,' + encoded).play() }
    catch { setMessage('无法播放语音样本') }
  }
  return <section aria-label="贸号语音指令管理" style={{ marginTop: 24, padding: 12, border: '1px solid var(--color-border, #ddd)', borderRadius: 8 }}>
    <h3>贸号语音指令</h3>
    <p>长按鼠标语音键说出触发词，松开后识别。优先执行匹配的本地指令，其他内容继续发送到 DSH 对话。</p>
    <label>搜索指令 <input value={query} onChange={event => { setQuery(event.target.value) }} placeholder="指令名称或别名" /></label>
    <button type="button" onClick={() => { void edit() }}>新增指令</button>
    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      {items.filter(x => [x.name, ...x.aliases].join(' ').includes(query)).map(command =>
        <div key={command.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid #ddd', paddingBottom: 6 }}>
          <strong>{command.name}</strong><small>{command.aliases.join('、')}</small>
          <small>{command.action === 'open-app' ? '启动应用' : command.action === 'close-app' ? '关闭应用' : '访问网址'}：{command.target}</small>
          <label><input type="checkbox" checked={command.enabled} disabled={busy}
            onChange={event => { void apply(items.map(x => x.id === command.id ? { ...x, enabled: event.target.checked } : x)) }} />启用</label>
          <button type="button" onClick={() => { void edit(command) }}>编辑</button>
          <button type="button" onClick={() => { void api.recording(command.id).then(playback).catch(setMessage) }}>试听</button>
          <button type="button" onClick={() => {
            if (command.action === 'close-app' && !window.confirm('确定关闭目标应用窗口？')) return
            void api.test(command.id, command.action !== 'close-app' || true).then(() => { setMessage('指令已执行') }).catch(error => { setMessage(String(error)) })
          }}>测试</button>
          <button type="button" onClick={() => {
            if (!window.confirm('删除语音指令：' + command.name + '？')) return
            void api.save(items.filter(x => x.id !== command.id))
              .then(async () => { await api.removeRecording(command.id); setItems(items.filter(x => x.id !== command.id)); setMessage('指令已删除') })
              .catch(error => { setMessage(String(error)) })
          }}>删除</button>
        </div>)}
    </div>
    {open && <div style={{ borderTop: '1px solid #ddd', marginTop: 12, paddingTop: 12, display: 'grid', gap: 8 }}>
      <h4>{editId === null ? '新增指令' : '编辑指令'}</h4>
      <label>触发词 <input value={draft.name} onChange={e => { setDraft({ ...draft, name: e.target.value }) }} /></label>
      <label>别名（每行一个） <textarea rows={3} value={aliases} onChange={e => { setAliases(e.target.value) }} /></label>
      <label>操作类型 <select value={draft.action} onChange={e => { setDraft({ ...draft, action: e.target.value as Command['action'],
        target: e.target.value === 'open-url' ? 'https://' : 'notepad.exe' }) }}>
        <option value="open-app">启动或置前应用</option><option value="open-url">访问网址</option><option value="close-app">关闭应用</option>
      </select></label>
      <label>{draft.action === 'open-url' ? 'HTTP/HTTPS 网址' : 'EXE 程序名或绝对路径'}
        <input value={draft.target} onChange={e => { setDraft({ ...draft, target: e.target.value }) }} /></label>
      <label><input type="checkbox" checked={draft.enabled} onChange={e => { setDraft({ ...draft, enabled: e.target.checked }) }} />启用</label>
      <div><button type="button" disabled={busy} onClick={() => { void toggleRecording() }}>{capture.current ? '停止录音' : '录制语音样本'}</button>
        <button type="button" onClick={() => { void playback(sample) }}>试听录音</button></div>
      <div><button type="button" disabled={busy} onClick={() => { void persistDraft() }}>保存</button>
        <button type="button" onClick={() => { void capture.current?.dispose(); capture.current = null; setOpen(false) }}>取消</button></div>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>
}
