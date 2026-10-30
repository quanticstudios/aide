import { useEffect, useState } from 'react'
import { formatThinkingDuration } from './format-thinking-duration'

// why: the ticking clock lives in this leaf so each second re-renders it alone, not the transcript row.
export default function ElapsedTime({ since }: { readonly since: string }) {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  return formatThinkingDuration(now - Date.parse(since))
}
