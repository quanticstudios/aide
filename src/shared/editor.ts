export interface EditorSampleFile {
  label: string
  relativePath: string
}

export interface ProjectTextFile {
  absolutePath: string
  content: string
  relativePath: string
}

export const EDITOR_SAMPLE_FILES: EditorSampleFile[] = [
  {
    label: 'README',
    relativePath: 'README.md',
  },
  {
    label: 'Product decisions',
    relativePath: 'docs/01-product-decisions.md',
  },
  {
    label: 'Architecture',
    relativePath: 'docs/02-architecture.md',
  },
]
