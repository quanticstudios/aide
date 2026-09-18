import { DynamicIcon, iconNames } from 'lucide-react/dynamic'
import type { ProjectColor, ProjectIcon } from '../../../shared/persistence'

export function getProjectColorClassName(color: ProjectColor): string {
  switch (color) {
    case 'blue':
      return 'text-accent-blue'
    case 'violet':
      return 'text-violet-400'
    case 'green':
      return 'text-accent-green'
    case 'amber':
      return 'text-accent-yellow'
    case 'red':
      return 'text-red-500'
    case 'orange':
      return 'text-orange-500'
    case 'yellow':
      return 'text-yellow-400'
    case 'lime':
      return 'text-lime-500'
    case 'emerald':
      return 'text-emerald-500'
    case 'teal':
      return 'text-teal-500'
    case 'cyan':
      return 'text-cyan-500'
    case 'sky':
      return 'text-sky-500'
    case 'indigo':
      return 'text-indigo-500'
    case 'purple':
      return 'text-purple-500'
    case 'fuchsia':
      return 'text-fuchsia-500'
    case 'pink':
      return 'text-pink-500'
    case 'rose':
      return 'text-rose-500'
    default:
      return 'text-muted-foreground'
  }
}

const availableIcons = new Set<string>(iconNames)

function ProjectIconPlaceholder() {
  return <span aria-hidden="true" className="size-3.5 shrink-0" />
}

export function ProjectIconView({ icon }: { readonly icon: ProjectIcon }) {
  const name = availableIcons.has(icon) ? icon : 'folder'
  return (
    <DynamicIcon
      fallback={ProjectIconPlaceholder}
      key={name}
      name={name}
      className={`size-3.5 shrink-0 lucide-${name}`}
    />
  )
}
