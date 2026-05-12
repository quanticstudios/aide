import { getIconForFilePath } from 'vscode-material-icons'

const iconUrlByName: Record<string, string> = (() => {
  const modules = import.meta.glob(
    '../../../../node_modules/vscode-material-icons/generated/icons/*.svg',
    { eager: true, query: '?url', import: 'default' },
  ) as Record<string, string>

  const map: Record<string, string> = {}
  for (const [path, url] of Object.entries(modules)) {
    const file = path.split('/').pop()
    if (!file) {
      continue
    }
    map[file.replace(/\.svg$/, '')] = url
  }
  return map
})()

export function materialIconUrlForFile(filePath: string): string | null {
  const iconName = getIconForFilePath(filePath)
  return iconUrlByName[iconName] ?? null
}
