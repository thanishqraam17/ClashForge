import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ALL_IPC_CHANNELS, type IpcResult } from '../../shared/ipc/contracts'
import type { IpcHandlerMap } from './handlers'

export type SenderPolicy = (event: IpcMainInvokeEvent) => boolean

/**
 * Only accept calls from the app's own renderer: the packaged file:// page, or
 * the dev server origin when running `electron-vite dev`.
 */
export function createAppSenderPolicy(devServerUrl: string | undefined): SenderPolicy {
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null
  return (event) => {
    const url = event.senderFrame?.url
    if (!url) {
      return false
    }
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'file:' || (devOrigin !== null && parsed.origin === devOrigin)
    } catch {
      return false
    }
  }
}

const FORBIDDEN: IpcResult<never> = {
  ok: false,
  error: { code: 'FORBIDDEN', message: 'Request rejected.' }
}

/** Registers every channel in the contract. Returns a function that unregisters them. */
export function registerIpcHandlers(
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>,
  handlers: IpcHandlerMap,
  isTrustedSender: SenderPolicy
): () => void {
  for (const channel of ALL_IPC_CHANNELS) {
    const handler = handlers[channel] as (payload: unknown) => IpcResult<unknown>
    ipcMain.handle(channel, (event, payload: unknown) =>
      isTrustedSender(event) ? handler(payload) : FORBIDDEN
    )
  }
  return () => {
    for (const channel of ALL_IPC_CHANNELS) {
      ipcMain.removeHandler(channel)
    }
  }
}
