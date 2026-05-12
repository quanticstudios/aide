import { Button } from '@heroui/react'
import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AideApi, AvailableEditorDescriptor } from '../../../shared/ipc'

interface OpenInEditorButtonProps {
  readonly cwd: string
}

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

export default function OpenInEditorButton({ cwd }: OpenInEditorButtonProps) {
  const [editors, setEditors] = useState<AvailableEditorDescriptor[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const api = getAideApi()

    if (!api) {
      return
    }

    let cancelled = false

    void api
      .listAvailableEditors()
      .then((result) => {
        if (!cancelled) {
          setEditors(result)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (!containerRef.current) {
        return
      }

      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleDocumentClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const launch = useCallback(
    async (editorId: string) => {
      const api = getAideApi()

      if (!api || !cwd) {
        return
      }

      try {
        await api.launchEditor(editorId, cwd)
      } catch {
        // silently ignore; editor might be unavailable despite probe
      } finally {
        setIsOpen(false)
      }
    },
    [cwd],
  )

  if (editors.length === 0) {
    return null
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        aria-label="Open in editor"
        isDisabled={!cwd}
        onPress={() => setIsOpen((prev) => !prev)}
        size="sm"
        variant="ghost"
      >
        <ExternalLink className="size-3.5" />
      </Button>
      {isOpen ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Open in…
          </div>
          <ul className="p-1">
            {editors.map((editor) => (
              <li key={editor.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-secondary"
                  onClick={() => void launch(editor.id)}
                  type="button"
                >
                  <span className="flex-1 truncate">{editor.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {editor.command}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
