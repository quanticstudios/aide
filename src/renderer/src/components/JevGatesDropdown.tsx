import { ChevronDown, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  anyJevGateEnabled,
  type JevGateOverrides,
  type JevGateSnapshot,
  resolveJevGates,
} from '../../../shared/jev-gates'
import JevGateControls from './JevGateControls'

interface JevGatesDropdownProps {
  readonly isDisabled?: boolean
  readonly onChange: (next: JevGateOverrides | null) => void
  readonly value: JevGateOverrides | undefined
  readonly workspaceId: string
}

/** Chat-level Jev gate overrides, shown as a composer tool beside the permission mode. */
export default function JevGatesDropdown({
  isDisabled = false,
  onChange,
  value,
  workspaceId,
}: JevGatesDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<JevGateSnapshot | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void window.aide
      .getJevGates(workspaceId)
      .then((next) => {
        if (!cancelled) setSnapshot(next)
      })
      .catch(() => undefined)
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node))
        setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', handler)
    }
  }, [isOpen, workspaceId])

  const effective = resolveJevGates(
    snapshot?.global,
    snapshot?.workspace,
    value,
  )
  const active = anyJevGateEnabled(effective)

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        className="composer-tool"
        data-active={active ? 'true' : undefined}
        disabled={isDisabled}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <ShieldCheck className="size-4" />
        Jev gates{value ? ' (chat)' : ''}
        <ChevronDown className="size-3.5 opacity-50" />
      </button>
      {isOpen ? (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-[440px] rounded-lg floating-surface p-3">
          <p className="mb-2 text-[12px] text-muted-foreground">
            Overrides for this chat only. Blank fields inherit the workspace and
            global settings.
          </p>
          <JevGateControls
            effective={resolveJevGates(snapshot?.global, snapshot?.workspace)}
            inheritLabel="Inherit"
            isDisabled={isDisabled || snapshot === null}
            onChange={(next) =>
              onChange(Object.keys(next).length ? next : null)
            }
            value={value ?? {}}
          />
        </div>
      ) : null}
    </div>
  )
}
