import { Button } from '@heroui/react'
import { Clipboard, ClipboardCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import IconTooltip from '../ui/icon-tooltip'

/** Writes text to the clipboard and reports `copied` for 1.5 s afterwards. */
export function useCopyText(): readonly [
  boolean,
  (text: string) => Promise<void>,
] {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current)
    },
    [],
  )
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be unavailable in the shell.
    }
  }
  return [copied, copy]
}

export default function MessageCopyButton({
  text,
  kind,
}: {
  readonly text: string
  readonly kind: 'message' | 'plan' | 'response' | 'code'
}) {
  const [copied, copy] = useCopyText()
  const label = `${copied ? 'Copied' : 'Copy'} ${kind}`
  return (
    <IconTooltip label={label}>
      <Button
        aria-label={label}
        className="size-7 rounded-md text-muted-foreground"
        isIconOnly
        onPress={() => void copy(text)}
        size="sm"
        variant="ghost"
      >
        {copied ? (
          <ClipboardCheck className="size-3.5" />
        ) : (
          <Clipboard className="size-3.5" />
        )}
      </Button>
    </IconTooltip>
  )
}
