/** Narrow IPC bridge for the standalone demo identity form. */
import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('imaohaoDemo', {
  login: (username: string, password: string): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('imaohao:mock-login', username, password) as Promise<{ ok: boolean; message?: string }>,
})
