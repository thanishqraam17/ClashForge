/// <reference types="vite/client" />

interface Window {
  /** Typed bridge exposed by the preload script. Undefined outside Electron. */
  clashForge?: import('../shared/ipc/contracts').ClashForgeApi
}
