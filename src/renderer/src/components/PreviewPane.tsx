import { Button, Chip, Input } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { isAllowedPreviewUrl, normalizePreviewUrl } from '@/lib/preview-target'
import type { PreviewTarget } from '../../../shared/domain'

interface PreviewPaneProps {
  readonly activeTarget: PreviewTarget | null
  readonly onLoadTarget: (url: string) => void
  readonly onSelectTarget: (targetId: string) => void
  readonly targets: readonly PreviewTarget[]
}

export default function PreviewPane({
  activeTarget,
  onLoadTarget,
  onSelectTarget,
  targets,
}: PreviewPaneProps) {
  const [draftTarget, setDraftTarget] = useState(activeTarget?.url ?? '')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setDraftTarget(activeTarget?.url ?? '')
  }, [activeTarget?.url])

  const normalizedDraftTarget = useMemo(
    () => normalizePreviewUrl(draftTarget),
    [draftTarget],
  )
  const isAllowedTarget = isAllowedPreviewUrl(normalizedDraftTarget)

  function handleLoad(): void {
    if (!isAllowedTarget) {
      return
    }

    onLoadTarget(normalizedDraftTarget)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Local preview spike
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Only localhost targets are allowed. The preview runs inside a
            sandboxed iframe rather than a general browser surface.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="secondary">
            localhost only
          </Chip>
          <Chip size="sm" variant="secondary">
            sandboxed iframe
          </Chip>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input
          aria-label="Preview target"
          className="min-w-[18rem] flex-1"
          onChange={(event) => setDraftTarget(event.target.value)}
          placeholder="localhost:3000"
          value={draftTarget}
          variant="secondary"
        />
        <Button
          className="rounded-pill px-[22px] py-[11px]"
          isDisabled={!isAllowedTarget}
          onPress={handleLoad}
          variant="primary"
        >
          Load preview
        </Button>
        <Button
          isIconOnly
          onPress={() => setReloadKey((value) => value + 1)}
          variant="ghost"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {targets.map((target) => (
          <Button
            data-testid={`preview-target-${target.id}`}
            key={target.id}
            onPress={() => onSelectTarget(target.id)}
            size="sm"
            variant={target.isActive ? 'secondary' : 'ghost'}
          >
            {target.label}
          </Button>
        ))}
      </div>

      <div
        className="mb-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
        data-testid="preview-active-target"
      >
        {activeTarget?.url ?? 'No active preview target'}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background">
        <iframe
          className="h-full w-full bg-white"
          key={`${activeTarget?.url ?? 'empty'}:${reloadKey}`}
          sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          src={activeTarget?.url ?? 'about:blank'}
          title="Local preview"
        />
      </div>
    </div>
  )
}
