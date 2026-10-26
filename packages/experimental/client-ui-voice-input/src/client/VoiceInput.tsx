/** Click-to-record toolbar activity; transcripts remain in the original Session draft. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenSpan, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranscriptionRequest } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSelection, SpeechSelectionPatch, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { audioBase64, type Recording } from './audio.ts'
import { failureText } from './failure-text.ts'
import type { MicrophoneDevice } from './microphone-device.ts'
import type { SpeechReadiness } from './readiness.ts'
import { Waveform } from './Waveform.tsx'
import { VoiceSetupDialog } from './VoiceSetupDialog.tsx'
import { NS } from './locales.ts'
import { Button, IconCloseOutlineRegular, IconStopFillRegular, IconMicrophoneOutlineRegular, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './VoiceInput.module.css'

/** Host calls injected without exposing a Cordis Context to React. */
export interface VoiceInputActions {
  /** Open the voice bundle details without starting preparation. */
  openSettings: () => void
  /** @returns one microphone operation owned by the plugin lifecycle. */
  createRecording: () => Recording
  /** Remember the browser microphone used by previews and subsequent recordings. */
  selectMicrophone: (device: MicrophoneDevice) => void
  transcribe: (request: TranscriptionRequest, signal: AbortSignal) => Promise<RemoteResult<Transcript>>
  prepare: (providerId: SpeechProviderId, options?: SpeechPreparationOptions) => Promise<void>
  cancelPreparation: (providerId: SpeechProviderId) => Promise<void>
  configure: (patch: SpeechSelectionPatch) => Promise<void>
}

/** Entry-injected Host readiness and microphone operations. */
export interface VoiceInputInjected extends VoiceInputActions {
  hooks: { speechReadiness: HostObservable<SpeechReadiness>; microphoneDevice: HostObservable<MicrophoneDevice> }
}

/** Composer-owned expansion and draft actions; preferences stay in plugin settings. */
export type VoiceInputProps = Pick<PropsRuntime<'conversation.input.activity'>, 'sessionId' | 'inputActions' | 'useInput' | 'locked' | 'onActiveChange'>
  & PropsLocale<typeof NS> & InjectFace<VoiceInputInjected>

type PhysicalMouseEvent =
  | { kind: 'ready'; version: string }
  | { kind: 'connected' | 'disconnected'; deviceId: string; mode: 0 | 1 }
  | { kind: 'message'; deviceId: string; event: Record<string, unknown> }
  | { kind: 'audio'; deviceId: string; format: 'pcm_s16le'; sampleRate: 16000; data: string }

interface PhysicalMouse {
  subscribe(listener: (event: PhysicalMouseEvent) => void): () => void
}

function physicalMouse(): PhysicalMouse | undefined {
  // The trusted Electron preload installs this only for the owning DSH app window.
  return (window as Window & { dshDesktop?: { mouse?: PhysicalMouse } }).dshDesktop?.mouse
}

/** uMouse's decoded mono 16 kHz PCM bytes are already in the format expected by DSH. */
function pcmWave(chunks: readonly Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(44 + length)
  const view = new DataView(result.buffer)
  const word = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) result[at + i] = value.charCodeAt(i)
  }
  word(0, 'RIFF'); view.setUint32(4, result.length - 8, true)
  word(8, 'WAVE'); word(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  word(36, 'data'); view.setUint32(40, length, true)
  let offset = 44
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

interface MouseRecording {
  readonly id: string
  readonly at: number
  readonly span: TokenSpan
  readonly abort: AbortController
  readonly chunks: Uint8Array[]
  bytes: number
  timeout: ReturnType<typeof setTimeout>
}

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'feedback'
interface ActiveRecording {
  readonly capture: Recording
  readonly abort: AbortController
  readonly span: TokenSpan
  readonly selection: SpeechSelection
  readonly maxDurationSeconds: number
  readonly maxAudioBytes: number
  phase: 'requesting' | 'recording' | 'transcribing'
  timer?: ReturnType<typeof setTimeout> | undefined
}

async function disposeRecording(capture: Recording): Promise<void> {
  try { await capture.dispose() } catch (_error) {
    // Tracks stop before AudioContext.close(); a close failure must not hide the recording result.
  }
}

/** Render a compact microphone or an expanded capture, transcription, or retry row. */
export function VoiceInput({ sessionId, inputActions, useInput, locked, onActiveChange,
  createRecording, transcribe, openSettings, useSpeechReadiness, t }: VoiceInputProps) {
  const inputState = useInput((value: InputState) => value)
  const inputRef = useRef(inputState)
  inputRef.current = inputState
  const [mouseMessage, setMouseMessage] = useState('')
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  const provider = catalog?.providers.find(item => item.id === catalog.selection.providerId)
  const usable = readiness.connected && (provider?.preparation.phase === 'ready' || provider?.preparation.phase === 'standby'
    || provider?.preparation.phase === 'waking')
  const [phase, setPhase] = useState<Phase>('idle'), [message, setMessage] = useState(''), [pending, setPending] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)
  useEffect(() => { if (usable) setSetupOpen(false) }, [usable])
  const current = useRef<ActiveRecording>(), generation = useRef(0)

  // Hardware-only command path. Physical button events are not synthesized from the web page.
  // The native helper remains separate from Electron; no audio is persisted to disk.
  useEffect(() => {
    const mouse = physicalMouse()
    if (!mouse) return
    let active: MouseRecording | undefined
    let generation = 0
    let disposed = false
    const maxAudioBytes = Math.min(catalog?.maxAudioBytes ?? 0, 4 * 1024 * 1024)
    const maxDurationSeconds = Math.min(catalog?.maxDurationSeconds ?? 0, 120)
    const reset = (message = ''): void => {
      generation++
      if (active) { clearTimeout(active.timeout); active.abort.abort(); active = undefined }
      if (!disposed) setMouseMessage(message)
    }
    const start = (deviceId: string): void => {
      if (active) return
      if (!usable || !catalog) {
        setMouseMessage('请先在 DSH 插件中准备 Voice Input 语音识别模型')
        return
      }
      const input = inputRef.current
      // Do not replace an existing draft or submit an attachment/command the user never spoke.
      if (locked || input.phase !== 'plain' || input.draft.trim() !== '' || input.attachmentIds.length !== 0) {
        setMouseMessage('当前输入框已有内容，请先处理后再使用鼠标 AI 键')
        return
      }
      const id = ++generation
      const timeout = setTimeout(() => {
        if (id === generation) reset('鼠标语音录制已达到时长限制')
      }, maxDurationSeconds * 1000)
      active = { id: deviceId, at: Date.now(), span: inputActions.captureInsertion(),
        abort: new AbortController(), chunks: [], bytes: 0, timeout }
      setMouseMessage('贸号 AI 鼠标正在聆听，松开 AI 键自动提交')
    }
    const finish = (deviceId: string): void => {
      const recording = active
      if (!recording || recording.id !== deviceId) return
      active = undefined
      clearTimeout(recording.timeout)
      const id = ++generation
      if (Date.now() - recording.at < 250 || recording.bytes < 6400) {
        recording.abort.abort()
        setMouseMessage('')
        return
      }
      setMouseMessage('正在识别鼠标语音…')
      void (async () => {
        try {
          const wave = pcmWave(recording.chunks, recording.bytes)
          recording.chunks.length = 0
          const outcome = await transcribe({ audioBase64: audioBase64(wave), ...catalog!.selection }, recording.abort.signal)
          if (disposed || id !== generation || recording.abort.signal.aborted) return
          if (!outcome.ok) { setMouseMessage('语音识别失败，请重试'); return }
          const text = outcome.value.text.trim()
          if (!text) { setMouseMessage('未识别到有效语音'); return }
          const now = inputRef.current
          if (locked || now.phase !== 'plain' || now.draft.trim() !== '' || now.attachmentIds.length !== 0
            || !inputActions.insertText(text, recording.span)) {
            setMouseMessage('输入状态已经改变，未自动提交，请重新录音')
            return
          }
          // Submit through DSH's ordinary composer path; all Agent permissions remain in force.
          inputActions.submit()
          setMouseMessage('')
        } catch (_error) {
          if (!disposed && id === generation) setMouseMessage('鼠标语音处理失败，请重试')
        }
      })()
    }
    const onEvent = (event: PhysicalMouseEvent): void => {
      if (event.kind === 'disconnected' && active?.id === event.deviceId) {
        reset('贸号鼠标已断开，本次录音取消')
        return
      }
      if (event.kind === 'audio') {
        if (!active || active.id !== event.deviceId) return
        try {
          const binary = atob(event.data)
          if (binary.length === 0 || binary.length % 2 !== 0 || active.bytes + binary.length + 44 > maxAudioBytes) {
            reset('鼠标音频超出限制，本次录音取消')
            return
          }
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          active.chunks.push(bytes)
          active.bytes += bytes.length
        } catch (_error) { reset('鼠标音频数据异常，请重试') }
        return
      }
      if (event.kind !== 'message' || event.event.type !== 'keyEvent' || event.event.key !== 'ai') return
      if (event.event.action === 'down') start(event.deviceId)
      else if (event.event.action === 'up') finish(event.deviceId)
      // click is handled in Electron to focus the existing DSH window.
    }
    const unsubscribe = mouse.subscribe(onEvent)
    return () => {
      disposed = true
      reset()
      unsubscribe()
    }
  }, [sessionId, inputActions, usable, locked, transcribe, catalog?.selection.providerId,
    catalog?.maxAudioBytes, catalog?.maxDurationSeconds])

  const expanded = phase !== 'idle'
  useLayoutEffect(() => { onActiveChange(expanded); return () => { onActiveChange(false) } }, [expanded, onActiveChange])

  const cancel = (): void => {
    generation.current++
    const active = current.current
    current.current = undefined
    if (active) { clearTimeout(active.timer); active.abort.abort(); void disposeRecording(active.capture) }
    setPending(''); setMessage(''); setPhase('idle'); setSetupOpen(false)
  }
  useEffect(() => {
    setPending(''); setMessage(''); setPhase('idle'); setSetupOpen(false)
    const blur = (): void => { if (current.current?.phase === 'recording') cancel() }
    const visibility = (): void => {
      if (document.hidden && current.current && current.current.phase !== 'transcribing') cancel()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && current.current) { event.preventDefault(); cancel() }
    }
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('keydown', escape)
      generation.current++
      const active = current.current
      current.current = undefined
      if (active) { clearTimeout(active.timer); active.abort.abort(); void disposeRecording(active.capture) }
    }
  }, [sessionId])

  const feedback = (text: string): void => { setMessage(text); setPhase('feedback') }
  const finish = async (): Promise<void> => {
    const active = current.current
    if (!active || active.phase !== 'recording') return
    active.phase = 'transcribing'
    const run = generation.current
    clearTimeout(active.timer); setPhase('transcribing')
    try {
      const audio = await active.capture.stop(active.maxDurationSeconds)
      if (run !== generation.current) return
      if (audio.byteLength > active.maxAudioBytes) { feedback(t('tooLarge')); return }
      const result = await transcribe({ audioBase64: audioBase64(audio), ...active.selection }, active.abort.signal)
      if (run !== generation.current) return
      if (!result.ok) { feedback(t('failed', { message: result.error.message })); return }
      if (result.value.text === '') { feedback(t('empty')); return }
      if (!inputActions.insertText(result.value.text, active.span)) { setPending(result.value.text); feedback(t('conflict')); return }
      setPhase('idle')
    } catch (failure) {
      await disposeRecording(active.capture)
      if (run === generation.current) feedback(failureText(failure, t))
    } finally { if (run === generation.current) current.current = undefined }
  }
  const start = async (): Promise<void> => {
    if (!catalog || !usable || locked || current.current) return
    const run = ++generation.current
    const active: ActiveRecording = { capture: createRecording(), abort: new AbortController(),
      span: inputActions.captureInsertion(), selection: catalog.selection,
      maxDurationSeconds: catalog.maxDurationSeconds, maxAudioBytes: catalog.maxAudioBytes, phase: 'requesting' }
    current.current = active
    setMessage(''); setPending(''); setPhase('requesting')
    try {
      await active.capture.start((failure) => {
        if (run !== generation.current || current.current !== active || active.phase === 'transcribing') return
        current.current = undefined
        clearTimeout(active.timer); active.abort.abort()
        feedback(failureText(failure, t))
      })
      if (run !== generation.current || current.current !== active) return
      active.phase = 'recording'
      setPhase('recording')
      active.timer = setTimeout(() => { void finish() }, active.maxDurationSeconds * 1000)
    } catch (failure) {
      await disposeRecording(active.capture)
      if (run === generation.current) { current.current = undefined; feedback(failureText(failure, t)) }
    }
  }
  if (!expanded) return <>
    {mouseMessage && <span className={css.activityMessage} role="status">{mouseMessage}</span>}
    <Tooltip label={t('dictate')} disabled={!usable} side="top" portal>
      <span className={css.triggerAnchor}><Button className={css.trigger} size="sm" disabled={locked}
        aria-label={t(usable ? 'start' : 'setupPrompt.trigger')} aria-haspopup={usable ? undefined : 'dialog'}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { if (usable) void start(); else setSetupOpen(true) }}><IconMicrophoneOutlineRegular size={18} /></Button></span>
    </Tooltip>
    <VoiceSetupDialog open={setupOpen && !usable}
      needsInstallation={readiness.connected && provider?.location === 'host-local' && provider.preparation.phase === 'unprepared'}
      onDismiss={() => { setSetupOpen(false) }} onOpenDetails={() => { setSetupOpen(false); openSettings() }} t={t} />
  </>
  return <div className={css.captureRow} data-voice-activity={phase}>
    <Button type="button" className={css.roundButton} size="sm" aria-label={t(pending ? 'discard' : 'cancel')}
      onClick={cancel}><IconCloseOutlineRegular size={14} /></Button>
    {phase === 'recording' ? <Waveform recording={current.current?.capture} label={t('recording')} />
      : <span className={css.activityMessage} role="status" title={pending || message}>
        {(phase === 'requesting' || phase === 'transcribing') && <StateDot state="ongoing" />}
        {phase === 'feedback' ? message : t(phase === 'requesting' ? 'requesting'
          : provider?.preparation.phase === 'waking' ? 'wakingShort' : 'transcribingShort')}</span>}
    {phase === 'recording' && <Button type="button" className={css.roundButton} size="sm" aria-label={t('stop')}
      onClick={() => { void finish() }}><IconStopFillRegular size={14} /></Button>}
    {phase === 'feedback' && (pending
      ? <Button className={css.inlineAction} size="sm" type="button" onClick={() => {
        if (inputActions.insertText(pending, inputActions.captureInsertion())) { setPending(''); setPhase('idle') }
      }}>{t('insert')}</Button>
      : <Button className={css.roundButton} size="sm" type="button" aria-label={t('retryRecording')} disabled={!usable || locked}
        onClick={() => { void start() }}><IconMicrophoneOutlineRegular size={18} /></Button>)}
  </div>
}
