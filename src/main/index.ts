import { createDatabase, type ClashForgeDatabase } from '../database/client/database'
import { resolveProductionDatabasePath } from '../database/client/database-path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { loadBundledGameData } from '../game-data'
import { createCatalogueService } from '../services/catalogue-service'
import { createTownHallService } from '../services/town-hall-service'
import { createIpcHandlers } from './ipc/handlers'
import { createAppSenderPolicy, registerIpcHandlers } from './ipc/register'

const isDev = !app.isPackaged

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

  unregisterIpc = registerIpcHandlers(
    ipcMain,
    createIpcHandlers({
      database: appDatabase,
      catalogue: createCatalogueService(gameData.catalogue),
      townHall: createTownHallService(gameData.catalogue, gameData.townHallRules)
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
