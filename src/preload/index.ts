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
  buildings: {
    list: () => invoke(IPC_CHANNELS.buildingsList),
    save: (input) => invoke(IPC_CHANNELS.buildingsSave, input)
  },
  heroes: {
    list: () => invoke(IPC_CHANNELS.heroesList),
    save: (input) => invoke(IPC_CHANNELS.heroesSave, input)
  },
  research: {
    list: () => invoke(IPC_CHANNELS.researchList),
    save: (input) => invoke(IPC_CHANNELS.researchSave, input)
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
  }
}

contextBridge.exposeInMainWorld('clashForge', api)
