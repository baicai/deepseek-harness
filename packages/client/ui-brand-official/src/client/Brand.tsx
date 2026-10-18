import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  const branded = (globalThis as typeof globalThis & { dshDesktop?: { protocolVersion?: number } }).dshDesktop?.protocolVersion === 1
  return branded ? <img src="/imaohao-brand.svg" width={size} height={size} alt="" /> : <FishLogo size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  const branded = (globalThis as typeof globalThis & { dshDesktop?: { protocolVersion?: number } }).dshDesktop?.protocolVersion === 1
  return branded ? <strong style={{ fontSize: 18, letterSpacing: '0.04em' }}>贸号</strong> : <BrandWordmark includeMark={false} />
}
