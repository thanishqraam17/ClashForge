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

const api: ClashForgeApi = {
  platform: process.platform,
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
    remove: (input) => invoke(IPC_CHANNELS.villageItemsRemove, input)
  },
  builders: {
    setCount: (input) => invoke(IPC_CHANNELS.buildersSetCount, input)
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
    list: (input) => invoke(IPC_CHANNELS.legacyList, input)
  }
}

contextBridge.exposeInMainWorld('clashForge', api)
