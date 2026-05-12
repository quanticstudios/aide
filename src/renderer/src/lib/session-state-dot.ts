export function getSessionStateDotClass(state: string | null): string {
  switch (state) {
    case 'running':
      return 'bg-accent-blue animate-pulse'
    case 'connecting':
      return 'bg-accent-blue animate-pulse'
    case 'waiting':
      return 'bg-accent-yellow'
    case 'ready':
      return 'bg-accent-green'
    case 'error':
      return 'bg-accent-red'
    case 'stopped':
      return 'bg-ash'
    default:
      return 'bg-stone'
  }
}
