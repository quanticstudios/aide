import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProviderCapabilitiesSnapshot } from '../shared/provider-capabilities'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import { CodexManagedSessionBackend } from './managed-session-manager'

const MAX_PROMPT_EXCERPT_LENGTH = 480
const TITLE_TIMEOUT_MS = 10_000

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
  readonly generateTitle?: (input: {
    model: string
    prompt: string
    workspace: TitleWorkspace
  }) => Promise<string>
  readonly getCapabilities: () => Promise<ProviderCapabilitiesSnapshot>
  readonly store: WorkspaceTitleStore
}

function promptExcerpt(text: string): string | null {
  const excerpt = text.trim().replace(/\s+/g, ' ')
  return excerpt ? excerpt.slice(0, MAX_PROMPT_EXCERPT_LENGTH) : null
}

function fallbackTitle(excerpt: string): string {
  return excerpt.split(/\s+/).slice(0, 8).join(' ').slice(0, 80)
}

function normalizeGeneratedTitle(value: string): string | null {
  const title = value
    .split(/\r?\n/, 1)[0]
    ?.replace(/^title:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ')

  if (!title || title.length > 80 || title.split(' ').length > 8) {
    return null
  }

  return title
}

function lunaModelId(
  capabilities: ProviderCapabilitiesSnapshot,
): string | null {
  const model = capabilities.providers.codex.models.find((candidate) =>
    /\bluna\b/i.test(`${candidate.id} ${candidate.label}`),
  )

  return model?.id ?? null
}

function workspaceTitlePrompt(excerpt: string): string {
  return [
    'Return only a concise workspace title of two to eight words for this user prompt.',
    'Use no tools, commands, files, or outside context.',
    `User prompt: ${excerpt}`,
  ].join('\n')
}

export async function generateWorkspaceTitleWithCodex(input: {
  model: string
  prompt: string
  workspace: TitleWorkspace
}): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'aide-workspace-title-'))
  let closeBackend: (() => Promise<void>) | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null
  const chunks: string[] = []

  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (result: string | Error) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        if (result instanceof Error) reject(result)
        else resolve(result)
      }
      const handleEvent = (event: ManagedProviderRuntimeEvent) => {
        if (event.type === 'content.delta' && event.kind === 'assistant-text') {
          chunks.push(event.text)
          return
        }
        if (event.type === 'runtime.error') {
          finish(new Error(event.message))
          return
        }
        if (event.type === 'turn.completed') {
          finish(
            event.state === 'completed'
              ? chunks.join('')
              : new Error(event.errorMessage ?? 'Title generation failed.'),
          )
        }
      }

      const backend = new CodexManagedSessionBackend(
        {
          cwd,
          mode: 'codex',
          model: input.model,
          paneId: `workspace-title:${randomUUID()}`,
          permissionMode: 'plan',
          readOnly: true,
          sessionId: `workspace-title:${randomUUID()}`,
          workspaceId: input.workspace.id,
        },
        handleEvent,
        () => new Date().toISOString(),
      )
      closeBackend = () => backend.close()
      timeout = setTimeout(
        () => finish(new Error('Workspace title generation timed out.')),
        TITLE_TIMEOUT_MS,
      )
      void backend
        .start()
        .then(() => backend.sendInput(input.prompt))
        .catch((error: unknown) =>
          finish(
            error instanceof Error
              ? error
              : new Error('Workspace title generation failed.'),
          ),
        )
    })
  } finally {
    if (timeout) clearTimeout(timeout)
    await (closeBackend ?? (() => Promise.resolve()))().catch(() => undefined)
    rmSync(cwd, { force: true, recursive: true })
  }
}

export class WorkspaceTitleService {
  private readonly namingWorkspaceIds = new Set<string>()
  private readonly titledWorkspaceIds = new Set<string>()
  private readonly generateTitle: NonNullable<
    WorkspaceTitleServiceOptions['generateTitle']
  >

  public constructor(private readonly options: WorkspaceTitleServiceOptions) {
    this.generateTitle =
      options.generateTitle ?? generateWorkspaceTitleWithCodex
  }

  public requestTitle(workspaceId: string, prompt: string): void {
    if (
      this.namingWorkspaceIds.has(workspaceId) ||
      this.titledWorkspaceIds.has(workspaceId)
    ) {
      return
    }
    this.namingWorkspaceIds.add(workspaceId)
    queueMicrotask(() => {
      void this.titleWorkspace(workspaceId, prompt).catch(() => undefined)
    })
  }

  public async titleWorkspace(
    workspaceId: string,
    prompt: string,
  ): Promise<void> {
    try {
      if (this.titledWorkspaceIds.has(workspaceId)) return
      const workspace = this.options.store.getWorkspace(workspaceId)
      const excerpt = promptExcerpt(prompt)
      if (!workspace) return
      if ((workspace.nameSource ?? 'default') !== 'default' || !excerpt) {
        return
      }

      let title = fallbackTitle(excerpt)
      try {
        const capabilities = await this.options.getCapabilities()
        const model = lunaModelId(capabilities)
        if (model && process.env.AIDE_FAKE_MANAGED_PROVIDERS !== '1') {
          title =
            normalizeGeneratedTitle(
              await this.generateTitle({
                model,
                prompt: workspaceTitlePrompt(excerpt),
                workspace,
              }),
            ) ?? title
        }
      } catch {}

      const updatedWorkspace = this.options.store.renameWorkspaceIfUnchanged(
        workspaceId,
        {
          expectedUpdatedAt: workspace.updatedAt,
          name: title,
          nameSource: 'generated',
        },
      )
      if (updatedWorkspace) this.titledWorkspaceIds.add(workspaceId)
    } finally {
      this.namingWorkspaceIds.delete(workspaceId)
    }
  }
}
