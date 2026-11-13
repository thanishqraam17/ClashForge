import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type ClashForgeApi,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type IpcResult
} from '../shared/ipc/contracts'

function invoke<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>
): Promise<IpcResult<IpcResponse<C>>> {
  return ipcRenderer.invoke(channel, payload)
}

/** Mirrors SAMPLE_DATA_ARGUMENT in main/sample-data/sample-mode.ts. */
const SAMPLE_DATA_ARGUMENT = '--clashforge-sample-data'

const api: ClashForgeApi = {
  platform: process.platform,
  // Constant false in production builds; only main adds this argument, in sample mode.
  sampleData: import.meta.env.DEV && process.argv.includes(SAMPLE_DATA_ARGUMENT),
  village: {
    getCurrent: () => invoke(IPC_CHANNELS.villageGetCurrent),
    save: (input) => invoke(IPC_CHANNELS.villageSave, input)
  },
  history: {
    getRecent: (input) => invoke(IPC_CHANNELS.historyGetRecent, input),
    record: (input) => invoke(IPC_CHANNELS.historyRecord, input)
  },
  catalogue: {
    getItems: (input) => invoke(IPC_CHANNELS.catalogueGetItems, input),
    getItem: (input) => invoke(IPC_CHANNELS.catalogueGetItem, input),
    getDatasetInfo: () => invoke(IPC_CHANNELS.catalogueGetDatasetInfo)
  },
  townHall: {
    getMax: () => invoke(IPC_CHANNELS.townHallGetMax),
    getItem: (input) => invoke(IPC_CHANNELS.townHallGetItem, input),
    getSummary: (input) => invoke(IPC_CHANNELS.townHallGetSummary, input),
    compare: (input) => invoke(IPC_CHANNELS.townHallCompare, input)
  },
  assets: {
    resolve: (input) => invoke(IPC_CHANNELS.assetsResolve, input),
    getAttributions: () => invoke(IPC_CHANNELS.assetsGetAttributions)
  },
  villageState: {
    get: () => invoke(IPC_CHANNELS.villageStateGet),
    getCoverage: () => invoke(IPC_CHANNELS.villageStateGetCoverage)
  },
  villageItems: {
    save: (input) => invoke(IPC_CHANNELS.villageItemsSave, input),
    remove: (input) => invoke(IPC_CHANNELS.villageItemsRemove, input),
    setLevels: (input) => invoke(IPC_CHANNELS.villageItemsSetLevels, input),
    setCount: (input) => invoke(IPC_CHANNELS.villageItemsSetCount, input)
  },
  builders: {
    setCount: (input) => invoke(IPC_CHANNELS.buildersSetCount, input),
    setOrdinaryCount: (input) => invoke(IPC_CHANNELS.buildersSetOrdinaryCount, input),
    setBob: (input) => invoke(IPC_CHANNELS.buildersSetBob, input),
    reclassifyLegacy: (input) => invoke(IPC_CHANNELS.buildersReclassifyLegacy, input),
    removeUnclassified: (input) => invoke(IPC_CHANNELS.buildersRemoveUnclassified, input)
  },
  research: {
    save: (input) => invoke(IPC_CHANNELS.researchSave, input),
    remove: (input) => invoke(IPC_CHANNELS.researchRemove, input)
  },
  snapshots: {
    capture: () => invoke(IPC_CHANNELS.snapshotsCapture),
    list: (input) => invoke(IPC_CHANNELS.snapshotsList, input),
    get: (input) => invoke(IPC_CHANNELS.snapshotsGet, input)
  },
  legacy: {
    list: (input) => invoke(IPC_CHANNELS.legacyList, input),
    map: (input) => invoke(IPC_CHANNELS.legacyMap, input),
    dismiss: (input) => invoke(IPC_CHANNELS.legacyDismiss, input),
    restore: (input) => invoke(IPC_CHANNELS.legacyRestore, input)
  },
  editLog: {
    list: (input) => invoke(IPC_CHANNELS.editLogList, input),
    getBatch: (input) => invoke(IPC_CHANNELS.editLogGetBatch, input)
  },
  imports: {
    previewText: (input) => invoke(IPC_CHANNELS.importPreviewText, input),
    previewClipboard: () => invoke(IPC_CHANNELS.importPreviewClipboard),
    previewFile: () => invoke(IPC_CHANNELS.importPreviewFile),
    apply: (input) => invoke(IPC_CHANNELS.importApply, input),
    discard: (input) => invoke(IPC_CHANNELS.importDiscard, input),
    list: (input) => invoke(IPC_CHANNELS.importList, input),
    getObservations: (input) => invoke(IPC_CHANNELS.importGetObservations, input)
  }
}

contextBridge.exposeInMainWorld('clashForge', api)
