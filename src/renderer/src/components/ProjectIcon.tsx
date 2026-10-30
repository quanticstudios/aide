import { DynamicIcon, iconNames } from 'lucide-react/dynamic'
import type { ProjectColor, ProjectIcon } from '../../../shared/persistence'

export function getProjectColorClassName(color: ProjectColor): string {
  switch (color) {
    case 'blue':
      return 'text-accent-blue'
    case 'violet':
      return 'text-project-violet'
    case 'green':
      return 'text-accent-green'
    case 'amber':
      return 'text-accent-yellow'
    case 'red':
      return 'text-project-red'
    case 'orange':
      return 'text-project-orange'
    case 'yellow':
      return 'text-project-yellow'
    case 'lime':
      return 'text-project-lime'
    case 'emerald':
      return 'text-project-emerald'
    case 'teal':
      return 'text-project-teal'
    case 'cyan':
      return 'text-project-cyan'
    case 'sky':
      return 'text-project-sky'
    case 'indigo':
      return 'text-project-indigo'
    case 'purple':
      return 'text-project-purple'
    case 'fuchsia':
      return 'text-project-fuchsia'
    case 'pink':
      return 'text-project-pink'
    case 'rose':
      return 'text-project-rose'
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
