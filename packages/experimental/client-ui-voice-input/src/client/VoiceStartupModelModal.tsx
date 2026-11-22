/** Maohao first-run offline speech model preparation, independent of conversation screens. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VoiceInputInjected } from './VoiceInput.tsx'
import { NS } from './locales.ts'
import css from './VoiceInput.module.css'

type Props = Pick<InjectFace<VoiceInputInjected>, 'useSpeechReadiness' | 'prepare'>
  & PropsLocale<typeof NS>

function inMaohaoDesktop(): boolean {
  // The native mouse API exists only in the trusted Windows desktop preload.
  return typeof window !== 'undefined'
    && (window as Window & { dshDesktop?: { mouse?: unknown } }).dshDesktop?.mouse !== undefined
}

/** Modal blocks initial interaction while the selected offline provider is being prepared.
 * Missing models start downloading in mount.ts, not in this render component.
 */
export function VoiceStartupModelModal({ useSpeechReadiness, prepare, t }: Props) {
  const readiness = useSpeechReadiness(value => value)
  const provider = readiness.catalog?.providers.find(item => item.id === readiness.catalog?.selection.providerId)
  const state = provider?.preparation
  const phase = state?.phase
  const [observedMissing, setObservedMissing] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (provider?.location !== 'host-local' || phase === 'ready' || phase === 'standby' || phase === 'waking') {
      setObservedMissing(false)
      return
    }
    if (phase === 'unprepared' || phase === 'downloading' || phase === 'failed') setObservedMissing(true)
  }, [provider?.location, provider?.id, phase])

  if (!inMaohaoDesktop() || dismissed || !observedMissing || !readiness.connected
    || provider?.location !== 'host-local' || state === undefined) return null

  const downloading = state.phase === 'downloading'
  const percent = downloading && state.totalBytes !== undefined && state.totalBytes > 0
    ? Math.min(100, Math.floor(state.completedBytes / state.totalBytes * 100)) : undefined
  const busy = state.phase !== 'failed' && state.phase !== 'cancelled'
  const detail = downloading
    ? percent === undefined
      ? t('downloadUnknown', { completed: (state.completedBytes / 1_000_000).toFixed(1) })
      : t('downloadBytes', {
        completed: (state.completedBytes / 1_000_000).toFixed(1),
        total: ((state.totalBytes ?? 0) / 1_000_000).toFixed(1),
        percent: String(percent),
      })
    : state.phase === 'checking' ? t('preparation.checking')
      : state.phase === 'loading' ? t('preparation.loading', { name: provider.name })
        : state.phase === 'failed' ? t('preparationFailed', { message: state.message })
          : state.phase === 'cancelled' ? t('preparation.cancelled')
            : t('modelStartup.checking')

  return <Modal open title={t('modelStartup.title')} headless onClose={() => { /* Model setup stays visible until ready or explicit defer on failure. */ }}>
    <section className={css.modelStartup} aria-live="polite">
      <div className={css.modelStartupHeading}>
        {busy && <span className={css.modelStartupSpinner} aria-hidden="true" />}
        <h2>{busy ? t('modelStartup.title') : t('modelStartup.failed')}</h2>
      </div>
      <p className={css.modelStartupDetail} role="status">{detail}</p>
      {downloading && <progress className={css.modelStartupProgress}
        aria-label={t('downloadProgress')}
        {...percent === undefined ? {} : { value: percent, max: 100 }} />}
      {!busy && <div className={css.modelStartupActions}>
        <Button variant="ghost" onClick={() => { setDismissed(true) }}>{t('modelStartup.later')}</Button>
        <Button variant="primary" disabled={retrying} onClick={() => {
          setRetrying(true)
          void prepare(provider.id).catch(() => undefined).finally(() => { setRetrying(false) })
        }}>{t('modelStartup.retry')}</Button>
      </div>}
    </section>
  </Modal>
}
