import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BuilderPanel, type BuilderPanelProps } from '@/components/village/BuilderPanel'
import { BulkEditDialog } from '@/components/village/BulkEditDialog'
import { StatusToast } from '@/components/village/feedback'
import { ItemSection } from '@/components/village/ItemSection'
import type { ItemRowActions } from '@/components/village/ItemRow'
import { VillageForm } from '@/components/village/VillageForm'
import {
  addInstanceRequest,
  assignBuilderRequest,
  cancelUpgradeRequest,
  finishUpgradeRequest,
  removeInstanceRequest,
  setLevelRequest,
  startUpgradeRequest
} from '@/lib/village/edit-requests'
import { toUserMessage } from '@/lib/village/ipc-errors'
import { useVillageData, type VillageData } from '@/lib/village/use-village-data'
import { buildItemGroups, certainlyFreeBuilders, INSTANCE_ITEM_CATEGORIES, type ItemGroup, type ItemLimits } from '@/lib/village/village-view-model'
import type { IpcResult, VillageItemDto, VillageSaveInput } from '../../shared/ipc/contracts'

const TOAST_MS = 4000

/**
 * Runs one edit: marks it pending, sends it, and on success reloads the whole
 * village from the server and announces it. On failure the service's message
 * is returned for the control that caused it; nothing is retried.
 */
function useEditRunner(reload: () => Promise<void>) {
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const run = useCallback(
    async <T,>(key: string, send: () => Promise<IpcResult<T>>, success: string): Promise<string | null> => {
      setPending(key)
      try {
        const result = await send()
        if (!result.ok) return toUserMessage(result.error)
        await reload()
        setToast(success)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setToast(null), TOAST_MS)
        return null
      } catch (error) {
        return toUserMessage(error)
      } finally {
        setPending(null)
      }
    },
    [reload]
  )

  return { pending, toast, run }
}

export function MyVillagePage(): React.JSX.Element {
  const { data, reload } = useVillageData()
  const { pending, toast, run } = useEditRunner(reload)

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">My Village</p>
      <h1 className="mt-1 text-lg font-semibold text-foreground">
        {data.status === 'ready' && data.data.state ? `Town Hall ${data.data.state.village.townHallLevel}` : 'My Village'}
      </h1>

      {data.status === 'loading' && <MyVillageLoading />}
      {data.status === 'error' && <MyVillageError message={data.message} onRetry={() => void reload()} />}
      {data.status === 'ready' && <MyVillageContent data={data.data} pending={pending} run={run} />}

      <StatusToast message={toast} />
    </div>
  )
}

export function MyVillageLoading(): React.JSX.Element {
  return (
    <div className="mt-6 space-y-4" aria-busy="true" aria-label="Loading your village">
      <div className="h-40 animate-pulse rounded-md bg-surface-1" />
      <div className="h-32 animate-pulse rounded-md bg-surface-1" />
    </div>
  )
}

export function MyVillageError({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="mt-6 rounded-md border border-border-subtle bg-surface-1 p-4">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

type Run = <T>(key: string, send: () => Promise<IpcResult<T>>, success: string) => Promise<string | null>

function MyVillageContent({ data, pending, run }: { data: VillageData; pending: string | null; run: Run }): React.JSX.Element {
  const api = window.clashForge!
  const state = data.state
  const [villageError, setVillageError] = useState<string | null>(null)
  const [countError, setCountError] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<BuilderPanelProps['assignError']>(null)
  const [instanceErrors, setInstanceErrors] = useState<Readonly<Record<number, string>>>({})
  const [limits, setLimits] = useState<ItemLimits>({})
  const [bulkGroup, setBulkGroup] = useState<ItemGroup | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const names = new Map(data.catalogueItems.map((i) => [i.id, i.name]))
  const nameOf = (itemId: string) => names.get(itemId) ?? itemId
  const townHallLevel = state?.village.townHallLevel ?? null

  // Town Hall limits for every Home Village instance item, cached per Town
  // Hall level; a Town Hall change invalidates the cache and triggers a reload.
  const limitsTownHall = useRef<number | null>(null)
  useEffect(() => {
    if (townHallLevel === null || !state?.coverage.canRecordItems) return
    if (limitsTownHall.current === townHallLevel) return
    limitsTownHall.current = townHallLevel
    const relevant = data.catalogueItems.filter(
      (item) => item.gameMode === 'home-village' && INSTANCE_ITEM_CATEGORIES.includes(item.category)
    )
    let cancelled = false
    setLimits({})
    void Promise.all(
      relevant.map((item) =>
        api.townHall.getItem({ itemId: item.id, townHall: townHallLevel }).then((result) => [item.id, result] as const)
      )
    ).then((results) => {
      if (cancelled) return
      setLimits(
        Object.fromEntries(results.map(([id, result]) => [id, result.ok ? result.data : undefined]))
      )
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [townHallLevel, state?.coverage.canRecordItems])

  if (!state) {
    return (
      <div className="mt-6">
        <VillageForm
          village={null}
          maxTownHall={data.maxTownHall['home-village']}
          pending={pending === 'village'}
          error={villageError}
          onSubmit={(input) => void run('village', () => api.village.save(input), 'Village created').then(setVillageError)}
        />
      </div>
    )
  }

  const groups = buildItemGroups(state, data.catalogueItems, limits)
  const freeBuilders = certainlyFreeBuilders(state)

  const saveVillage = async (input: VillageSaveInput) => {
    setVillageError(await run('village', () => api.village.save(input), 'Village saved'))
  }
  const setCount = async (count: number) => {
    setCountError(await run('count', () => api.builders.setCount({ count }), 'Builder count saved'))
  }
  const assign = async (instance: VillageItemDto, builderId: number) => {
    const message = await run(
      `assign-${instance.id}`,
      () => api.villageItems.save(assignBuilderRequest(instance, builderId)),
      'Builder assigned'
    )
    setAssignError(message ? { instanceId: instance.id, message } : null)
  }

  const setInstanceError = (id: number, message: string | null) =>
    setInstanceErrors((errors) => {
      if (message === null) {
        if (!(id in errors)) return errors
        const { [id]: _removed, ...rest } = errors
        return rest
      }
      return { ...errors, [id]: message }
    })

  const itemActions: ItemRowActions = {
    onSetLevel: (instance, level) => {
      void run(`level-${instance.id}`, () => api.villageItems.save(setLevelRequest(instance, level)), 'Level saved').then(
        (message) => setInstanceError(instance.id, message)
      )
    },
    onAdd: (itemId, instanceNumber, level) => {
      void run(`add-${itemId}-${instanceNumber}`, () => api.villageItems.save(addInstanceRequest(itemId, instanceNumber, level)), 'Instance added')
    },
    onRemove: (instance) => {
      void run(`remove-${instance.id}`, () => api.villageItems.remove(removeInstanceRequest(instance)), 'Instance removed').then(
        (message) => setInstanceError(instance.id, message)
      )
    },
    onStartUpgrade: (instance, targetLevel, builderId, upgradeEndsAt) => {
      void run(
        `upgrade-${instance.id}`,
        () => api.villageItems.save(startUpgradeRequest(instance, { targetLevel, builderId, upgradeEndsAt })),
        'Upgrade started'
      ).then((message) => setInstanceError(instance.id, message))
    },
    onFinishUpgrade: (instance) => {
      void run(`finish-${instance.id}`, () => api.villageItems.save(finishUpgradeRequest(instance)), 'Upgrade finished').then(
        (message) => setInstanceError(instance.id, message)
      )
    },
    onCancelUpgrade: (instance) => {
      void run(`cancel-${instance.id}`, () => api.villageItems.save(cancelUpgradeRequest(instance)), 'Upgrade cancelled').then(
        (message) => setInstanceError(instance.id, message)
      )
    },
    onOpenBulkEdit: (group) => {
      setBulkGroup(group)
      setBulkError(null)
    }
  }

  const bulkKey = bulkGroup ? `bulk-${bulkGroup.item.id}` : null
  const runBulk = async <T,>(send: () => Promise<IpcResult<T>>) => {
    if (!bulkKey) return
    const message = await run(bulkKey, send, 'Bulk edit saved')
    if (message) setBulkError(message)
    else setBulkGroup(null)
  }

  const pendingInstanceIds = new Set(
    state.items.filter((i) => pending !== null && pending.endsWith(`-${i.id}`)).map((i) => i.id)
  )

  return (
    <div className="mt-6 space-y-4">
      <VillageForm
        key={state.village.updatedAt}
        village={state.village}
        maxTownHall={data.maxTownHall['home-village']}
        pending={pending === 'village'}
        error={villageError}
        onSubmit={(input) => void saveVillage(input)}
      />
      <BuilderPanel
        key={state.builders.map((b) => `${b.id}:${b.status}`).join(',')}
        state={state}
        nameOf={nameOf}
        pending={pending === 'count' || pending?.startsWith('assign-') ? (pending as BuilderPanelProps['pending']) : null}
        countError={countError}
        assignError={assignError}
        onSetCount={(count) => void setCount(count)}
        onAssign={(instance, builderId) => void assign(instance, builderId)}
      />
      <ItemSection
        groups={groups}
        coverage={state.coverage}
        freeBuilders={freeBuilders}
        pendingInstanceIds={pendingInstanceIds}
        instanceErrors={instanceErrors}
        actions={itemActions}
      />
      <BulkEditDialog
        open={bulkGroup !== null}
        group={bulkGroup}
        pending={bulkKey !== null && pending === bulkKey}
        error={bulkError}
        onCancel={() => setBulkGroup(null)}
        onSubmitLevels={(request) => void runBulk(() => api.villageItems.setLevels(request))}
        onSubmitCount={(request) => void runBulk(() => api.villageItems.setCount(request))}
      />
    </div>
  )
}
