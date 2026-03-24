export interface PaneTrackStyle {
  transform: string
  width: string
}

export function getPaneTrackStyle(
  paneCount: number,
  activePaneIndex: number,
): PaneTrackStyle {
  const safePaneCount = Math.max(paneCount, 1)
  const safePaneIndex = Math.min(
    Math.max(activePaneIndex, 0),
    safePaneCount - 1,
  )

  return {
    transform: `translateX(calc(-${safePaneIndex} * (100% / ${safePaneCount})))`,
    width: `${safePaneCount * 100}%`,
  }
}

export function getPaneSlideWidth(paneCount: number): string {
  return `${100 / Math.max(paneCount, 1)}%`
}
