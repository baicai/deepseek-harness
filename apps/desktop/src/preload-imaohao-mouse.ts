/** Native-controlled, zero-credential preload for the iMaoHao mouse device panel. */
import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type MouseBridgeEvent, type MouseBridgeStatus } from './ipc.ts'

contextBridge.exposeInMainWorld('imaohaoMouse', {
  status: () => ipcRenderer.invoke('imaohao:mouse-panel-status') as Promise<MouseBridgeStatus>,
  onStatus: (listener: (status: MouseBridgeStatus) => void): void => {
    ipcRenderer.on(DESKTOP_IPC.mouseStatusChanged, (_event, status: MouseBridgeStatus) => { listener(status) })
  },
  onEvent: (listener: (message: MouseBridgeEvent) => void): void => {
    ipcRenderer.on(DESKTOP_IPC.mouseEvent, (_event, message: MouseBridgeEvent) => { listener(message) })
  },
})
