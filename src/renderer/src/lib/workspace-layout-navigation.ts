import type { WorkspaceLayoutRecord } from '../../../shared/persistence'
import { resolveWorkspaceLayoutRoot } from './workspace-layout'

interface PaneRect {
  bottom: number
  id: string
  left: number
  order: number
  right: number
  top: number
}

const EPSILON = 0.0001

function normalizeWeights(weights: number[], childCount: number): number[] {
  if (childCount === 0) {
    return []
  }

  if (weights.length !== childCount || weights.some((weight) => weight <= 0)) {
    return Array.from({ length: childCount }, () => 1)
  }

  return weights
}

function collectPaneRects(layout: WorkspaceLayoutRecord): PaneRect[] {
  const rootNode = resolveWorkspaceLayoutRoot(layout)

  if (!rootNode) {
    return []
  }

  const nodeLookup = new Map(layout.nodes.map((node) => [node.id, node]))
  const paneRects: PaneRect[] = []
  let order = 0

  function walk(
    nodeId: string,
    bounds: { bottom: number; left: number; right: number; top: number },
  ): void {
    const node = nodeLookup.get(nodeId)

    if (!node) {
      return
    }

    if (node.type === 'pane') {
      paneRects.push({
        ...bounds,
        id: node.paneId,
        order,
      })
      order += 1
      return
    }

    const weights = normalizeWeights(node.sizeWeights, node.children.length)
    const totalWeight = weights.reduce((total, weight) => total + weight, 0)
    let cursor = node.type === 'split-horizontal' ? bounds.left : bounds.top

    node.children.forEach((childId, index) => {
      const share = (weights[index] ?? 1) / totalWeight

      if (node.type === 'split-horizontal') {
        const nextCursor =
          index === node.children.length - 1
            ? bounds.right
            : cursor + (bounds.right - bounds.left) * share

        walk(childId, {
          bottom: bounds.bottom,
          left: cursor,
          right: nextCursor,
          top: bounds.top,
        })
        cursor = nextCursor
        return
      }

      const nextCursor =
        index === node.children.length - 1
          ? bounds.bottom
          : cursor + (bounds.bottom - bounds.top) * share

      walk(childId, {
        bottom: nextCursor,
        left: bounds.left,
        right: bounds.right,
        top: cursor,
      })
      cursor = nextCursor
    })
  }

  walk(rootNode.id, { bottom: 1, left: 0, right: 1, top: 0 })

  return paneRects
}

function getVerticalOverlap(left: PaneRect, right: PaneRect): number {
  return Math.max(
    0,
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  )
}

function getVerticalCenterDistance(left: PaneRect, right: PaneRect): number {
  const leftCenter = (left.top + left.bottom) / 2
  const rightCenter = (right.top + right.bottom) / 2

  return Math.abs(leftCenter - rightCenter)
}

function getPrimaryGap(
  activePane: PaneRect,
  candidatePane: PaneRect,
  direction: -1 | 1,
): number {
  return direction === 1
    ? candidatePane.left - activePane.right
    : activePane.left - candidatePane.right
}

function getWrapGap(
  activePane: PaneRect,
  candidatePane: PaneRect,
  direction: -1 | 1,
): number {
  return direction === 1
    ? 1 - activePane.right + candidatePane.left
    : activePane.left + (1 - candidatePane.right)
}

function rankCandidate(
  activePane: PaneRect,
  direction: -1 | 1,
  paneRects: PaneRect[],
): PaneRect | null {
  const primaryCandidates = paneRects.filter((candidatePane) =>
    direction === 1
      ? candidatePane.left >= activePane.right - EPSILON
      : candidatePane.right <= activePane.left + EPSILON,
  )
  const wrapCandidates = paneRects.filter((candidatePane) =>
    direction === 1
      ? candidatePane.left < activePane.right - EPSILON
      : candidatePane.right > activePane.left + EPSILON,
  )
  const candidateSet =
    primaryCandidates.length > 0 ? primaryCandidates : wrapCandidates

  if (candidateSet.length === 0) {
    return null
  }

  const scoreCandidate = (candidatePane: PaneRect) => ({
    centerDistance: getVerticalCenterDistance(activePane, candidatePane),
    gap:
      primaryCandidates.length > 0
        ? getPrimaryGap(activePane, candidatePane, direction)
        : getWrapGap(activePane, candidatePane, direction),
    overlap: getVerticalOverlap(activePane, candidatePane),
    order: candidatePane.order,
  })

  return (
    [...candidateSet].sort((leftPane, rightPane) => {
      const leftScore = scoreCandidate(leftPane)
      const rightScore = scoreCandidate(rightPane)

      if (leftScore.gap !== rightScore.gap) {
        return leftScore.gap - rightScore.gap
      }

      if (leftScore.overlap !== rightScore.overlap) {
        return rightScore.overlap - leftScore.overlap
      }

      if (leftScore.centerDistance !== rightScore.centerDistance) {
        return leftScore.centerDistance - rightScore.centerDistance
      }

      return leftScore.order - rightScore.order
    })[0] ?? null
  )
}

export function resolveHorizontalPaneNeighbor(
  layout: WorkspaceLayoutRecord,
  paneId: string | null,
  direction: -1 | 1,
): string | null {
  const paneRects = collectPaneRects(layout)

  if (paneRects.length === 0) {
    return null
  }

  const activePane =
    paneRects.find((candidatePane) => candidatePane.id === paneId) ??
    paneRects[0]
  const candidatePanes = paneRects.filter(
    (candidatePane) => candidatePane.id !== activePane.id,
  )
  const nextPane = rankCandidate(activePane, direction, candidatePanes)

  return nextPane?.id ?? activePane.id
}
