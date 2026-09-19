import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  type JevGateOverrides,
  JevGateOverridesSchema,
  type JevGateScope,
  type JevGateSnapshot,
  resolveJevGates,
} from '../shared/jev-gates'

const fileSchema = z
  .object({
    global: JevGateOverridesSchema.default({}),
    workspaces: z.record(z.string(), JevGateOverridesSchema).default({}),
  })
  .strict()

/** Jev gate settings persist global overrides and per-workspace overrides keyed by workspace root. */
export class JevGateSettings {
  public constructor(private readonly filename: string) {}

  public get(workspaceRoot: string | null): JevGateSnapshot {
    const file = this.read()
    const workspace = workspaceRoot
      ? (file.workspaces[path.resolve(workspaceRoot)] ?? {})
      : {}
    return {
      effective: resolveJevGates(file.global, workspace),
      global: file.global,
      workspace,
    }
  }

  /** Effective gates for one workspace, with an optional per-chat layer on top. */
  public resolve(
    workspaceRoot: string,
    chat?: JevGateOverrides,
  ): ReturnType<typeof resolveJevGates> {
    const file = this.read()
    return resolveJevGates(
      file.global,
      file.workspaces[path.resolve(workspaceRoot)],
      chat,
    )
  }

  public update(
    scope: JevGateScope,
    workspaceRoot: string | null,
    input: unknown,
  ): JevGateSnapshot {
    const overrides = JevGateOverridesSchema.safeParse(input)
    if (!overrides.success) throw new Error('Invalid Jev gate settings.')
    const file = this.read()
    if (scope === 'global') file.global = overrides.data
    else {
      if (!workspaceRoot)
        throw new Error('Workspace Jev gate settings need a workspace.')
      file.workspaces[path.resolve(workspaceRoot)] = overrides.data
    }
    mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 })
    writeFileSync(this.filename, JSON.stringify(fileSchema.parse(file)), {
      mode: 0o600,
    })
    return this.get(workspaceRoot)
  }

  private read(): z.infer<typeof fileSchema> {
    if (!existsSync(this.filename)) return { global: {}, workspaces: {} }
    try {
      return fileSchema.parse(JSON.parse(readFileSync(this.filename, 'utf8')))
    } catch {
      throw new Error(
        'Jev gate settings could not be read. Restore or remove the Jev gate settings file in Aide user data.',
      )
    }
  }
}
