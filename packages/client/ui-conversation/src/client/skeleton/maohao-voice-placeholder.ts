/** Maohao-only voice guidance presented inside the normal chat composer. */
export const MAOHAO_VOICE_PLACEHOLDER = '按住鼠标上的语音键开始说话，说完松手自动提交问题。'

/** Preserve ordinary DSH's localized placeholders and existing disabled reasons. */
export function maohaoVoicePlaceholder(): string | undefined {
  return typeof window !== 'undefined'
    && (window as Window & { dshMaohao?: boolean }).dshMaohao === true
    ? MAOHAO_VOICE_PLACEHOLDER
    : undefined
}
