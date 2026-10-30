export function formatThinkingDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000)

  if (!(seconds >= 1)) {
    return '<1s'
  }

  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
