const MAX_PROMPT_EXCERPT_LENGTH = 480

type WorkspaceNameSource = 'default' | 'generated' | 'manual'

interface TitleWorkspace {
  readonly id: string
  readonly name: string
  readonly nameSource?: WorkspaceNameSource
  readonly updatedAt: string
}

interface WorkspaceTitleStore {
  getWorkspace(workspaceId: string): TitleWorkspace | null
  renameWorkspaceIfUnchanged(
    workspaceId: string,
    input: {
      expectedUpdatedAt: string
      name: string
      nameSource: 'generated'
    },
  ): TitleWorkspace | null
}

interface WorkspaceTitleServiceOptions {
  readonly store: WorkspaceTitleStore
}

function promptExcerpt(text: string): string | null {
  const excerpt = text.trim().replace(/\s+/g, ' ')
  return excerpt ? excerpt.slice(0, MAX_PROMPT_EXCERPT_LENGTH) : null
}

function fallbackTitle(excerpt: string): string {
  return excerpt.split(/\s+/).slice(0, 8).join(' ').slice(0, 80)
}

/** Names a workspace after the first prompt sent in it, until someone renames it. */
export class WorkspaceTitleService {
  private readonly titledWorkspaceIds = new Set<string>()

  public constructor(private readonly options: WorkspaceTitleServiceOptions) {}

  public titleWorkspace(workspaceId: string, prompt: string): void {
    if (this.titledWorkspaceIds.has(workspaceId)) return
    const workspace = this.options.store.getWorkspace(workspaceId)
    const excerpt = promptExcerpt(prompt)
    if (!workspace || !excerpt) return
    if ((workspace.nameSource ?? 'default') !== 'default') return

    const updatedWorkspace = this.options.store.renameWorkspaceIfUnchanged(
      workspaceId,
      {
        expectedUpdatedAt: workspace.updatedAt,
        name: fallbackTitle(excerpt),
        nameSource: 'generated',
      },
    )
    if (updatedWorkspace) this.titledWorkspaceIds.add(workspaceId)
  }
}
