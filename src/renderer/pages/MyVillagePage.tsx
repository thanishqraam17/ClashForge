import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BuilderPanel, type BuilderPanelProps } from '@/components/village/BuilderPanel'
import { StatusToast } from '@/components/village/feedback'
import { VillageForm } from '@/components/village/VillageForm'
import { assignBuilderRequest } from '@/lib/village/edit-requests'
import { toUserMessage } from '@/lib/village/ipc-errors'
import { useVillageData, type VillageData } from '@/lib/village/use-village-data'
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
  const [villageError, setVillageError] = useState<string | null>(null)
  const [countError, setCountError] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<BuilderPanelProps['assignError']>(null)
  const state = data.state
  const names = new Map(data.catalogueItems.map((i) => [i.id, i.name]))
  const nameOf = (itemId: string) => names.get(itemId) ?? itemId

  const saveVillage = async (input: VillageSaveInput) => {
    setVillageError(await run('village', () => api.village.save(input), state ? 'Village saved' : 'Village created'))
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

  return (
    <div className="mt-6 space-y-4">
      <VillageForm
        key={state ? state.village.updatedAt : 'new'}
        village={state?.village ?? null}
        maxTownHall={data.maxTownHall['home-village']}
        pending={pending === 'village'}
        error={villageError}
        onSubmit={(input) => void saveVillage(input)}
      />
      {state && (
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
      )}
    </div>
  )
}
