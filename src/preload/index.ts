import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('clashForge', {
  platform: process.platform
})
