// @vitest-environment jsdom
/** First-run setup must start before mouse recording and never require plugin navigation. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SpeechPreparationState, SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { afterEach, expect, it, vi } from 'vitest'
import type { SpeechReadiness } from '../src/client/readiness.ts'
import { VoiceStartupModelModal } from '../src/client/VoiceStartupModelModal.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  delete (window as Window & { dshDesktop?: unknown }).dshDesktop
})

function fixture(mouse = true) {
  if (mouse) {
    (window as Window & { dshDesktop?: unknown }).dshDesktop = { mouse: {} }
  }
  const id = 'sensevoice-local' as SpeechProviderId
  const readiness = createSnapshotStore<SpeechReadiness>({ catalog: null, connected: false, error: null })
  const prepare = vi.fn(async () => {})
  render(<VoiceStartupModelModal useSpeechReadiness={bindSnapshotSelector(readiness)}
    prepare={prepare} t={makeTranslate(zh)} />)
  const publish = (preparation: SpeechPreparationState, location: 'host-local' | 'cloud' = 'host-local') => {
    act(() => { readiness.set({ connected: true, error: null, catalog: {
      providers: [{ id, name: 'SenseVoice', location, languages: ['auto'], preparation }],
      selection: { providerId: id, language: 'auto' }, maxAudioBytes: 1_000_000, maxDurationSeconds: 120,
    } }) })
  }
  return { id, publish, prepare }
}

it('blocks the desktop with download progress when the selected offline model is missing', () => {
  const b = fixture()
  expect(screen.queryByRole('dialog')).toBeNull()
  b.publish({ phase: 'unprepared' })
  expect(screen.getByRole('dialog', { name: zh['modelStartup.title'] })).toBeTruthy()
  b.publish({ phase: 'downloading', resource: 'model', completedBytes: 3_000_000, totalBytes: 6_000_000 })
  expect(screen.getByRole<HTMLProgressElement>('progressbar').value).toBe(50)
  expect(screen.getByRole('status').textContent).toContain('50%')
  b.publish({ phase: 'ready' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('never interrupts already cached models, web clients or cloud providers', () => {
  const b = fixture(false)
  b.publish({ phase: 'unprepared' })
  expect(screen.queryByRole('dialog')).toBeNull()
  cleanup()
  const local = fixture()
  local.publish({ phase: 'ready' })
  expect(screen.queryByRole('dialog')).toBeNull()
  local.publish({ phase: 'unprepared' }, 'cloud')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('allows retry or deferral when an automatic model download fails', () => {
  const b = fixture()
  b.publish({ phase: 'unprepared' })
  b.publish({ phase: 'failed', message: 'network unavailable' })
  expect(screen.getByText(zh['modelStartup.failed'])).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['modelStartup.retry'] }))
  expect(b.prepare).toHaveBeenCalledWith(b.id)
  fireEvent.click(screen.getByRole('button', { name: zh['modelStartup.later'] }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
