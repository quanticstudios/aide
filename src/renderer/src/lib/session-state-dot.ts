export function getSessionStateDotClass(state: string | null): string {
  switch (state) {
    case 'running':
      return 'bg-sky-400 animate-pulse'
    case 'connecting':
      return 'bg-sky-300 animate-pulse'
    case 'waiting':
      return 'bg-amber-400'
    case 'ready':
      return 'bg-muted-foreground/50'
    case 'error':
      return 'bg-red-400'
    case 'stopped':
      return 'bg-muted-foreground/50'
    default:
      return 'bg-muted-foreground/30'
  }
}
