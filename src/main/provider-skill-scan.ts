import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type {
  ProviderSkill,
  ProviderSkillProvider,
  ProviderSkillsSnapshot,
  ResolvedProviderSkill,
} from '../shared/provider-skills'

/** A listed skill and the SKILL.md it came from. */
export interface SkillFile {
  readonly skill: ProviderSkill
  readonly path?: string
}

function frontmatterValue(text: string, key: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const value = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]
  return value?.trim().replace(/^(['"])(.*)\1$/, '$2') || null
}

async function scanDirectory(
  provider: ProviderSkillProvider,
  directory: string,
): Promise<SkillFile[]> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }
  const skills = await Promise.all(
    entries.map(async (entry): Promise<SkillFile | null> => {
      const skillPath = path.join(directory, entry, 'SKILL.md')
      let text: string
      try {
        text = await readFile(skillPath, 'utf8')
      } catch {
        return null
      }
      const name = frontmatterValue(text, 'name') ?? entry
      return {
        path: skillPath,
        skill: {
          description: frontmatterValue(text, 'description') ?? name,
          // The ids the provider probes used, so a saved selection still matches.
          id:
            provider === 'claude'
              ? `claude:skill:${name}`
              : `codex:skill:${createHash('sha256').update(skillPath).digest('hex').slice(0, 16)}`,
          name,
          owner: provider === 'claude' ? 'Claude' : 'Codex',
          provider,
        },
      }
    }),
  )
  return skills.filter((skill) => skill !== null)
}

/**
 * Finds the skills on disk: the user's and the workspace's Claude skills, and the user's Codex skills, workspace skills overriding the user's.
 * @remarks shortcut: plugin and bundled skills are not on these paths, so they are missing; read the list from pitwall once it has a command for it.
 */
export async function scanSkillFiles(
  cwd: string,
  home = homedir(),
  codexHome = process.env.CODEX_HOME || path.join(home, '.codex'),
): Promise<SkillFile[]> {
  const found = await Promise.all([
    scanDirectory('claude', path.join(home, '.claude', 'skills')),
    scanDirectory('claude', path.join(cwd, '.claude', 'skills')),
    scanDirectory('codex', path.join(codexHome, 'skills')),
  ])
  return [
    ...new Map(
      found
        .flat()
        .map(
          (file) => [`${file.skill.provider}:${file.skill.id}`, file] as const,
        ),
    ).values(),
  ]
}

/** The composer's skill picker list. */
export async function scanProviderSkills(
  ...args: Parameters<typeof scanSkillFiles>
): Promise<ProviderSkillsSnapshot> {
  return {
    errors: {},
    skills: (await scanSkillFiles(...args)).map((file) => file.skill),
  }
}

/** The native name, and for Codex the SKILL.md path, of the listed skill a renderer selected; pitwall runs the skill from them. */
export function resolveProviderSkill(
  files: readonly SkillFile[],
  input: unknown,
): ResolvedProviderSkill {
  const selection = input as Partial<ResolvedProviderSkill> | null
  const file = files.find(
    ({ skill }) =>
      skill.provider === selection?.provider && skill.id === selection?.id,
  )
  if (!file) throw new Error('Selected provider skill is unavailable.')
  return {
    id: file.skill.id,
    nativeName: file.skill.name,
    nativePath: file.skill.provider === 'codex' ? file.path : undefined,
    provider: file.skill.provider,
  }
}
