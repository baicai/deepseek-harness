/** Windows system tray: the always-present way back to a hidden window and the explicit quit entry. */

import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import type { MouseBridgeStatus } from './umouse-bridge.ts'
import type { DesktopLocale } from './locale.ts'

/** Main-process actions the tray triggers; both run the same paths as the window and application menu. */
export interface DesktopTrayOptions {
  /** Multi-size ICO rendered by `scripts/render-tray-icon.ts`; Windows picks the bitmap for the display scale. */
  readonly iconPath: string
  readonly locale: () => DesktopLocale
  /** Show and focus the primary window. */
  readonly open: () => void
  /** Request quit through the same confirmation as every other quit entry. */
  readonly quit: () => void
  /** Optional branded uMouse SDK state, hidden from upstream DSH. */
  readonly mouse?: () => MouseBridgeStatus
  readonly openMouse?: () => void
}

/** Tray icon present for the whole run, not only while the window is hidden. */
export class DesktopTray {
  private tray: Tray | undefined

  /** @param options - Icon path, locale reader, and the open and quit actions. */
  constructor(private readonly options: DesktopTrayOptions) {
    const tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray = tray
    tray.on('click', () => { options.open() })
    this.relabel()
  }

  /** Rebuild the tooltip and context menu in the current locale. */
  relabel(): void {
    const tray = this.tray
    if (tray === undefined) return
    const { messages } = this.options.locale()
    tray.setToolTip(messages.aboutProduct)
    const mouse = this.options.mouse?.()
    const mouseLabel = mouse === undefined ? undefined
      : mouse.phase === 'ready' ? `智能鼠标 · 已连接 ${mouse.connected} 台 · SDK ${mouse.version ?? '未知'}`
        : mouse.phase === 'starting' ? '智能鼠标 · 正在启动'
          : mouse.phase === 'error' ? '智能鼠标 · SDK 异常'
            : '智能鼠标 · 未连接'
    const template: MenuItemConstructorOptions[] = [
      { label: messages.openApplication, click: () => { this.options.open() } },
      ...(mouseLabel === undefined ? [] : [{ label: mouseLabel, enabled: false }]),
      ...(this.options.openMouse === undefined ? [] : [{ label: '声云智能鼠标 · 设备管理', click: () => { this.options.openMouse?.() } }]),
      { type: 'separator' },
      { label: messages.quitApplication, click: () => { this.options.quit() } },
    ]
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  /** Remove the icon; called once the quit is confirmed so no dead icon outlives the process. */
  dispose(): void {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}
