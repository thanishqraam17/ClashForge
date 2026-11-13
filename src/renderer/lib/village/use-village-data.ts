import { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogueItemDto, MaxTownHallDto, VillageStateDto } from '../../../shared/ipc/contracts'
import { toUserMessage } from './ipc-errors'

export type VillageData = {
  /** null until a village has been set up. */
  state: VillageStateDto | null
  maxTownHall: MaxTownHallDto
  catalogueItems: CatalogueItemDto[]
}

export type VillageDataState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: VillageData }

/**
 * Loads everything the My Village page shows. After any successful edit the
 * page calls reload() and re-renders from the server's state; nothing is
 * patched locally. While reloading, the previous data stays on screen.
 */
export function useVillageData(): { data: VillageDataState; reload: () => Promise<void> } {
  const [data, setData] = useState<VillageDataState>({ status: 'loading' })
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const api = window.clashForge
    if (!api) {
      setData({ status: 'error', message: toUserMessage('no-bridge') })
      return
    }
    const request = ++latest.current
    try {
      const [state, max, items] = await Promise.all([
        api.villageState.get(),
        api.townHall.getMax(),
        api.catalogue.getItems({ gameMode: 'home-village' })
      ])
      if (request !== latest.current) return
      const failed = [state, max, items].find((r) => !r.ok)
      if (failed && !failed.ok) {
        setData({ status: 'error', message: toUserMessage(failed.error) })
        return
      }
      if (state.ok && max.ok && items.ok) {
        setData({ status: 'ready', data: { state: state.data, maxTownHall: max.data, catalogueItems: items.data } })
      }
    } catch (error) {
      if (request === latest.current) setData({ status: 'error', message: toUserMessage(error) })
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, reload }
}
