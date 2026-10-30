// @vitest-environment jsdom
/** The Maohao welcome instruction never leaks into ordinary DSH or existing chats. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { HeroShell, type HeroShellProps } from '../src/client/skeleton/EmptyHero.tsx'

const hint = '按住鼠标上的语音键开始说话，说完松手自动提交问题。'
const props = { t: (key: string) => key, renderSlot: () => null } as unknown as HeroShellProps

afterEach(() => {
  cleanup()
  delete (window as Window & { dshMaohao?: boolean }).dshMaohao
})

it('shows the exact microphone-key instruction on the Maohao blank-chat hero', () => {
  Object.defineProperty(window, 'dshMaohao', { configurable: true, value: true })
  render(<HeroShell {...props} />)
  expect(screen.getByText(hint)).toBeTruthy()
})

it('does not change the ordinary DSH welcome view', () => {
  render(<HeroShell {...props} />)
  expect(screen.queryByText(hint)).toBeNull()
})
