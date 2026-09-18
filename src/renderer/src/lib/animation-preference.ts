export type AnimationPreference = 'system' | 'on' | 'reduced'

const STORAGE_KEY = 'aide.animations'

export function getAnimationPreference(): AnimationPreference {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'on' || stored === 'reduced' ? stored : 'system'
}

function applyAnimationPreference(): void {
  const preference = getAnimationPreference()
  const isReduced =
    preference === 'reduced' ||
    (preference === 'system' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  document.documentElement.dataset.motion = isReduced ? 'reduced' : 'full'
}

export function setAnimationPreference(preference: AnimationPreference): void {
  window.localStorage.setItem(STORAGE_KEY, preference)
  applyAnimationPreference()
}

export function initializeAnimationPreference(): void {
  applyAnimationPreference()
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', applyAnimationPreference)
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null)
      applyAnimationPreference()
  })
}
