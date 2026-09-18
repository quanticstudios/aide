export type ProviderSkillProvider = 'claude' | 'codex'

export interface ProviderSkillSelection {
  provider: ProviderSkillProvider
  id: string
}

export interface ProviderSkill extends ProviderSkillSelection {
  name: string
  description: string
  owner: 'Claude' | 'Codex'
}

export interface ProviderSkillsSnapshot {
  skills: ProviderSkill[]
  errors: Partial<Record<ProviderSkillProvider, string>>
}

/** Resolved provider skills retain native details in the main process. */
export interface ResolvedProviderSkill extends ProviderSkillSelection {
  nativeName: string
  nativePath?: string
}
