import { Code2, Folder, Layers3, Sparkles } from 'lucide-react'
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
    default:
      return 'text-muted-foreground'
  }
}

export function ProjectIconView({ icon }: { readonly icon: ProjectIcon }) {
  const className = 'size-3.5 shrink-0'
  switch (icon) {
    case 'code':
      return <Code2 className={className} />
    case 'layers':
      return <Layers3 className={className} />
    case 'sparkles':
      return <Sparkles className={className} />
    default:
      return <Folder className={className} />
  }
}
