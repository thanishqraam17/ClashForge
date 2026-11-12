import { createDatabase, type ClashForgeDatabase } from '../database/client/database'
import { resolveProductionDatabasePath } from '../database/client/database-path'
import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import { join } from 'path'
import { loadBundledGameData } from '../game-data'
import { createAssetService } from '../services/asset-service'
import { createCatalogueService } from '../services/catalogue-service'
import { createAssetFileStore } from './assets/asset-file-store'
import { handleAssetProtocol, registerAssetSchemePrivileges } from './assets/asset-protocol'
import { reconcileLegacyRecords } from '../services/legacy-reconciliation-service'
import { createTownHallService } from '../services/town-hall-service'
import { createVillageStateService } from '../services/village-state-service'
import { createIpcHandlers } from './ipc/handlers'
import { createAppSenderPolicy, registerIpcHandlers } from './ipc/register'

const isDev = !app.isPackaged

registerAssetSchemePrivileges(protocol)

let appDatabase: ClashForgeDatabase | null = null
let unregisterIpc: (() => void) | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1114',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const dbPath = resolveProductionDatabasePath(app.getPath('userData'))
  appDatabase = createDatabase({ dbPath })
  appDatabase.healthCheck()

  const gameData = loadBundledGameData()
  const assets = createAssetService(gameData.assets)
  const townHall = createTownHallService(gameData.catalogue, gameData.townHallRules)
  const villageState = createVillageStateService({
    database: appDatabase,
    catalogue: gameData.catalogue,
    townHall
  })

  // Convert archived pre-Phase-5 records where the catalogue mapping is reliable.
  // Never deletes anything; unconvertible records stay pending with a note.
  try {
    const report = reconcileLegacyRecords({
      database: appDatabase,
      catalogue: gameData.catalogue,
      villageState
    })
    if (isDev && report.results.length > 0) {
      console.info(
        `[ClashForge] Legacy records: ${report.converted} converted, ${report.pending} pending`
      )
    }
  } catch (error) {
    console.error('[ClashForge] Legacy reconciliation failed; records left untouched', error)
  }
  handleAssetProtocol(
    protocol,
    createAssetFileStore({
      // Bundled artwork directory. Packaging (Phase 16) must ship this folder alongside the app.
      directory: join(app.getAppPath(), 'src', 'game-data', 'assets'),
      assets
    })
  )

  unregisterIpc = registerIpcHandlers(
    ipcMain,
    createIpcHandlers({
      database: appDatabase,
      catalogue: createCatalogueService(gameData.catalogue),
      townHall,
      assets,
      villageState
    }),
    createAppSenderPolicy(isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined)
  )

  if (isDev) {
    console.info('[ClashForge] Database ready at', dbPath)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  unregisterIpc?.()
  unregisterIpc = null
  appDatabase?.close()
  appDatabase = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
