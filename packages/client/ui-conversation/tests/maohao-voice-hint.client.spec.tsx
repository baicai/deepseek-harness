// @vitest-environment jsdom
/** The mouse instruction belongs only in Maohao's input placeholder. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { HeroShell, type HeroShellProps } from '../src/client/skeleton/EmptyHero.tsx'
import { MAOHAO_VOICE_PLACEHOLDER, maohaoVoicePlaceholder } from '../src/client/skeleton/maohao-voice-placeholder.ts'

const props = { t: (key: string) => key, renderSlot: () => null } as unknown as HeroShellProps

afterEach(() => {
  cleanup()
  delete (window as Window & { dshMaohao?: boolean }).dshMaohao
})

it('uses the exact mouse-key copy in Maohao input placeholders, not a hero paragraph', () => {
  Object.defineProperty(window, 'dshMaohao', { configurable: true, value: true })
  expect(maohaoVoicePlaceholder()).toBe('按住鼠标上的语音键开始说话，说完松手自动提交问题。')
  render(<HeroShell {...props} />)
  expect(screen.queryByText(MAOHAO_VOICE_PLACEHOLDER)).toBeNull()
})

it('preserves the standard DSH composer placeholder and hero without the Maohao marker', () => {
  expect(maohaoVoicePlaceholder()).toBeUndefined()
  render(<HeroShell {...props} />)
  expect(screen.queryByText(MAOHAO_VOICE_PLACEHOLDER)).toBeNull()
})
