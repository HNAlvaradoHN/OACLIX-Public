import { useEffect, useRef, useState } from 'react'

type ManualRefreshState = 'idle' | 'refreshing' | 'done'

export function ManualRefreshButton({
  disabled = false,
  onRefresh,
}: {
  disabled?: boolean
  onRefresh: () => Promise<boolean>
}) {
  const [state, setState] = useState<ManualRefreshState>('idle')
  const resetTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current)
  }, [])

  const refresh = async () => {
    if (disabled || state === 'refreshing') return
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current)
    setState('refreshing')

    const refreshed = await onRefresh().catch(() => false)
    if (!refreshed) {
      setState('idle')
      return
    }

    setState('done')
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null
      setState('idle')
    }, 1600)
  }

  const label = state === 'refreshing'
    ? 'Actualizando…'
    : state === 'done'
      ? 'Listo ✓'
      : 'Actualizar'

  return (
    <button
      className="action-pill"
      type="button"
      disabled={disabled || state === 'refreshing'}
      onClick={() => void refresh()}
      aria-live="polite"
    >
      {label}
    </button>
  )
}
