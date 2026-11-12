import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ALL_IPC_CHANNELS } from '../../shared/ipc/contracts'
import type { IpcHandlerMap } from './handlers'
import { createAppSenderPolicy, registerIpcHandlers } from './register'

function eventFrom(url: string | undefined): IpcMainInvokeEvent {
  return { senderFrame: url === undefined ? null : { url } } as unknown as IpcMainInvokeEvent
}

describe('createAppSenderPolicy', () => {
  it('accepts the packaged file:// renderer', () => {
    const policy = createAppSenderPolicy(undefined)
    expect(policy(eventFrom('file:///C:/app/out/renderer/index.html'))).toBe(true)
  })

  it('accepts the dev server origin only when configured', () => {
    expect(createAppSenderPolicy(undefined)(eventFrom('http://localhost:5173/'))).toBe(false)
    const policy = createAppSenderPolicy('http://localhost:5173')
    expect(policy(eventFrom('http://localhost:5173/#/village'))).toBe(true)
    expect(policy(eventFrom('http://localhost:5174/'))).toBe(false)
  })

  it('rejects remote pages and missing frames', () => {
    const policy = createAppSenderPolicy('http://localhost:5173')
    expect(policy(eventFrom('https://example.com/'))).toBe(false)
    expect(policy(eventFrom(undefined))).toBe(false)
    expect(policy(eventFrom('not a url'))).toBe(false)
  })
})

describe('registerIpcHandlers', () => {
  it('registers every channel, enforces the sender policy, and unregisters', async () => {
    const registered = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, listener) => {
        registered.set(channel, listener)
      }),
      removeHandler: vi.fn((channel: string) => {
        registered.delete(channel)
      })
    }
    const handlers = Object.fromEntries(
      ALL_IPC_CHANNELS.map((channel) => [channel, vi.fn(() => ({ ok: true, data: channel }))])
    ) as unknown as IpcHandlerMap

    const unregister = registerIpcHandlers(
      ipcMain,
      handlers,
      (event) => event.senderFrame?.url === 'file:///index.html'
    )
    expect([...registered.keys()].sort()).toEqual([...ALL_IPC_CHANNELS].sort())

    const listener = registered.get('village:get-current')!
    expect(await listener(eventFrom('file:///index.html'), undefined)).toEqual({
      ok: true,
      data: 'village:get-current'
    })
    expect(await listener(eventFrom('https://evil.example/'), undefined)).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Request rejected.' }
    })
    expect(handlers['village:get-current']).toHaveBeenCalledOnce()

    unregister()
    expect(registered.size).toBe(0)
  })
})
